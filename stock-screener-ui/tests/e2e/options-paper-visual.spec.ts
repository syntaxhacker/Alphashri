import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  loginAsTestUser,
  setupApiMocks,
  setupOptionDockMocks,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

/**
 * Visual-evidence harness for the options paper dock, positions modal and
 * replay page. Everything is spec-local: no shared fixture file is edited.
 *
 * Screenshots are test OUTPUT under /tmp (not repo source); the main agent runs
 * this spec and reads each PNG back. Soft assertions keep a broken state in the
 * evidence set instead of aborting before the shot is taken.
 */
const SHOT_DIR = "/tmp/opencode/options-paper-shots";
const SNAPSHOT_PATH = "/?tab=market";

const VIEWPORTS = [
  { label: "1600", width: 1600, height: 900 },
  { label: "390", width: 390, height: 844 },
] as const;

type Viewport = (typeof VIEWPORTS)[number];
type Raw = Record<string, unknown>;

const MOCK_ROWS = [
  {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    sector: "Energy",
    close: 1417.4,
    change: 0.8,
    relative_volume: 1.4,
    market_cap_cr: 1900000,
    cap_tier: "large",
    rsi: 58,
    adx: 24,
    pos_52w: 0.72,
    fno: true,
    etf: false,
    exchange: "NSE",
  },
];

function shotPath(name: string): string {
  mkdirSync(SHOT_DIR, { recursive: true });
  return resolve(SHOT_DIR, name);
}

async function capture(page: Page, state: string, viewport: Viewport): Promise<string> {
  const file = shotPath(`${state}-${viewport.label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  expect(statSync(file).size).toBeGreaterThan(4 * 1024);
  return file;
}

async function visible(page: Page, testId: string): Promise<void> {
  await expect.soft(page.getByTestId(testId), `${testId} must be visible in this state`).toBeVisible();
}

async function clean(page: Page, testId: string): Promise<void> {
  await expect
    .soft(page.getByTestId(testId), `no undefined/NaN in ${testId}`)
    .not.toContainText(/undefined|NaN/);
}

const MATRIX_KPI_IDS = [
  "replay-matrix-kpi-debit",
  "replay-matrix-kpi-max-loss",
  "replay-matrix-kpi-max-profit",
  "replay-matrix-kpi-pop",
  "replay-matrix-kpi-breakevens",
] as const;

const TABLE_VIEW_IDS = [
  "table", "graph", "pnl-usd", "pnl-pct", "contract-value", "pct-max-risk",
] as const;

/** The single KPI strip must render finite, non-empty values in every data state. */
async function kpiStripHealthy(page: Page): Promise<void> {
  await expect
    .soft(page.getByTestId("replay-matrix-kpis"), "exactly one KPI strip")
    .toHaveCount(1);
  await visible(page, "replay-matrix-kpis");
  for (const id of MATRIX_KPI_IDS) {
    const el = page.getByTestId(id);
    await expect.soft(el, `${id} visible`).toBeVisible();
    const text = (await el.textContent() ?? "").trim();
    expect.soft(text.length, `${id} non-empty`).toBeGreaterThan(0);
    expect.soft(text, `${id} no undefined/NaN`).not.toMatch(/undefined|NaN/);
  }
}

/**
 * PAYOFF is the default workstation view: one dock-style PayoffWorkbench with
 * a single payoff chart canvas and one KPI strip. Assertions run before any tab
 * is touched, so a table-first regression fails the evidence set.
 */
async function workbenchDefaultVisible(page: Page): Promise<void> {
  const tab = page.getByTestId("replay-view-tab-payoff");
  await expect.soft(tab, "PAYOFF tab visible").toBeVisible();
  await expect.soft(tab, "PAYOFF tab selected by default").toHaveAttribute("aria-selected", "true");

  await visible(page, "replay-payoff-workbench");
  await visible(page, "replay-payoff-chart");
  await expect
    .soft(page.getByTestId("replay-payoff-chart").locator("canvas").first(), "payoff canvas renders")
    .toBeVisible();
  await kpiStripHealthy(page);
  await clean(page, "replay-payoff-workbench");
  await clean(page, "options-replay-panel");
}

/**
 * Advanced view: the dense strike × dated-expiry TABLE. The tab is opened
 * explicitly; its two-tier header, first strike column, row/column counts and
 * every cell are asserted once the TABLE panel is active.
 */
async function denseTableVisible(page: Page): Promise<void> {
  const tab = page.getByTestId("replay-view-tab-table");
  await expect.soft(tab, "TABLE tab visible").toBeVisible();
  await tab.click();
  await expect.soft(tab, "TABLE tab selected after click").toHaveAttribute("aria-selected", "true");
  await visible(page, "replay-table-panel");
  const table = page.getByTestId("replay-table-table");
  await expect.soft(table, "dense payoff table visible").toBeVisible();

  const datedHeads = page.locator('[data-testid^="replay-table-col-head-"]');
  const columnCount = await datedHeads.count();
  expect.soft(columnCount, "at least 12 dated columns").toBeGreaterThanOrEqual(12);
  const headText = (await datedHeads.first().innerText()).trim();
  expect.soft(headText.length, "first dated header is non-empty").toBeGreaterThan(0);
  expect.soft(headText, "dated header must not be undefined/NaN").not.toMatch(/undefined|NaN/);
  expect.soft(
    await datedHeads.first().locator("span").count(),
    "nested two-tier header (month over date)",
  ).toBeGreaterThanOrEqual(2);

  await expect
    .soft(page.locator('[data-testid="replay-table-table"] thead th').first(), "first column is STRIKE")
    .toContainText("STRIKE");
  const strike = page.getByTestId("replay-table-strike-0");
  await expect.soft(strike, "first strike column visible").toBeVisible();
  const strikeText = (await strike.innerText()).trim();
  expect.soft(strikeText.length, "first strike column non-empty").toBeGreaterThan(0);
  expect.soft(strikeText, "first strike column no undefined/NaN").not.toMatch(/undefined|NaN/);

  const rowCount = await page.locator('[data-testid^="replay-table-row-"]').count();
  expect.soft(rowCount, "at least 15 strike rows").toBeGreaterThanOrEqual(15);
  const cellCount = await page.locator('[data-testid^="replay-table-cell-"]').count();
  expect.soft(cellCount, "one cell per strike × expiry").toBeGreaterThanOrEqual(rowCount * 12);
  const tableText = (await table.textContent()) ?? "";
  expect.soft(tableText, "no undefined/NaN in table cells").not.toMatch(/undefined|NaN/);

  for (const id of ["replay-range-controls", "replay-range-slider", "replay-iv-readout", "replay-table-controls", "replay-table-table-range", "replay-table-table-iv"]) {
    await visible(page, id);
  }
  for (const id of TABLE_VIEW_IDS) {
    await visible(page, `replay-table-view-tab-${id}`);
  }
  await clean(page, "options-replay-panel");
}

/** The intrinsic-only badge appears exactly when the recorded chain has no IV quote. */
async function intrinsicOnlyBadge(page: Page, expected: boolean): Promise<void> {
  const badge = page.getByTestId("replay-table-intrinsic-badge");
  const banner = page.getByTestId("replay-iv-banner");
  const readout = (await page.getByTestId("replay-iv-readout").innerText()).trim();
  if (expected) {
    await expect.soft(readout, "IV readout discloses the missing quote").toBe("IV unavailable");
    await expect.soft(badge, "intrinsic-only badge visible").toBeVisible();
    await expect.soft(badge, "intrinsic-only badge copy").toContainText("INTRINSIC ONLY");
    await expect.soft(banner, "IV banner explains the fallback").toContainText("intrinsic P&L only");
    await expect.soft(page.getByTestId("replay-table-intrinsic-note"), "sr-only intrinsic note").toHaveCount(1);
  } else {
    expect.soft(readout, "IV readout is a finite percentage").toMatch(/\d+\.\d+% IV/);
    await expect.soft(badge, "no intrinsic badge when IV is recorded").toHaveCount(0);
    await expect.soft(banner, "no IV banner when IV is recorded").toHaveCount(0);
  }
}

/**
 * The replay order carries a single expiry, so the workstation always projects
 * the additional monthly expiries for the matrix and shows the disclosure note.
 */
async function projectedNote(page: Page, expected: boolean): Promise<void> {
  const note = page.getByTestId("replay-projected-note");
  if (expected) {
    await expect.soft(note, "projected-expiry note present").toBeVisible();
    await expect.soft(note, "projected note explains no inference").toContainText(
      "no prices are inferred",
    );
  } else {
    await expect.soft(note, "no projected note when dock chain supplies expiries").toHaveCount(0);
  }
}

/** The replay desk names its structure in the header meta row. */
async function replayHeader(page: Page, symbol: string, expiry?: string): Promise<void> {
  await visible(page, "options-replay-title");
  await visible(page, "replay-meta");
  await expect(page.getByTestId("replay-symbol-chip"), "header names the underlying").toContainText(
    symbol,
  );
  if (expiry) {
    await expect(page.getByTestId("replay-expiry-chip"), "header names the expiry").toContainText(
      expiry,
    );
  }
}

/** Empty replay states keep one in-flow CTA back to the dock. */
async function replayDockCta(page: Page): Promise<void> {
  await visible(page, "replay-open-dock");
  await expect(page.getByTestId("replay-open-dock")).toHaveText("Open Options Dock");
}

/**
 * The paper-book modal overrides the shared table's dense metrics at the wrap:
 * 12px numbers / 11px column headers, with the 8/12px cell padding contract.
 */
async function positionsTableTypography(page: Page): Promise<void> {
  const wrap = page.getByTestId("option-positions-table-wrap");
  const metrics = await wrap.evaluate((el) => {
    const cell = el.querySelector("td");
    const head = el.querySelector("th");
    return {
      cell: cell ? getComputedStyle(cell).fontSize : null,
      head: head ? getComputedStyle(head).fontSize : null,
    };
  });
  expect(metrics.cell, "paper-book numbers use the 12px table floor").toBe("12px");
  expect(metrics.head, "paper-book column headers stay at 11px").toBe("11px");
}

async function noHorizontalOverflow(page: Page, viewport: Viewport): Promise<void> {
  if (viewport.label !== "390") return;
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect.soft(metrics.scrollWidth, "page must not scroll sideways at 390").toBe(metrics.clientWidth);
}

// ---------------------------------------------------------------------------
// Spec-local API mocks
// ---------------------------------------------------------------------------

async function mockMarketAndPatterns(page: Page): Promise<void> {
  await page.route(apiRoute("market/snapshot"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        as_of: new Date().toISOString(),
        universe: "all_equity",
        total: MOCK_ROWS.length,
        update_mode: "streaming",
        rows: MOCK_ROWS,
      }),
    });
  });
  await page.route(apiRoute("chart-patterns/patterns/lookup"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timeframe: "1D",
        session: "2026-11-16",
        source: "stored",
        data_through: "2026-11-14",
        items: [],
      }),
    });
  });
}

function paperPosition(overrides: Raw = {}): Raw {
  return {
    id: 7,
    uuid: "pos-7",
    user_id: 3,
    source: "live",
    status: "open",
    underlying: "RELIANCE",
    expiry: "2026-11-26",
    name: "Bull call spread",
    entry_ts: "2026-11-22T09:15:00+05:30",
    entry_spot: 1417.4,
    lots: 1,
    net_debit: 337.5,
    costs_est: 90,
    max_profit: 412.5,
    max_loss: 337.5,
    breakevens: [1432.5],
    realized_pnl: 0,
    close_reason: null,
    closed_at: null,
    notes: "",
    legs: [
      {
        id: 1,
        position_id: 7,
        action: "BUY",
        opt_type: "CE",
        strike: 1420,
        lots: 1,
        qty: 75,
        instrument_key: "NSE_FO|1420CE",
        entry_premium: 12.5,
        mark_premium: 13.6,
        mark_ts: null,
        exit_premium: null,
      },
      {
        id: 2,
        position_id: 7,
        action: "SELL",
        opt_type: "CE",
        strike: 1470,
        lots: 1,
        qty: 75,
        instrument_key: "NSE_FO|1470CE",
        entry_premium: 8.0,
        mark_premium: 9.4,
        mark_ts: null,
        exit_premium: null,
      },
    ],
    unrealized_pnl: 165,
    total_pnl: 165,
    mark_spot: 1421.6,
    mark_ts: null,
    dte: 4,
    created_at: "2026-11-22T09:15:00+05:30",
    updated_at: "2026-11-22T09:15:00+05:30",
    ...overrides,
  };
}

function frame(t: string, spot: number, netPnl: number, ce1420: number, ce1470: number): Raw {
  return {
    t,
    spot,
    marks: { "1420-CE": ce1420, "1470-CE": ce1470 },
    priced: true,
    gross_pnl: netPnl + 90,
    net_pnl: netPnl,
    net_debit: 337.5,
    equity: netPnl,
  };
}

/**
 * Normalizes through `normalizeOptionReplayResult`: snake_case keys and numeric
 * strings are deliberate so the shot covers the real wire shape, not a hand-
 * built TS object. `marks` keys match `${strike}-${opt}` in ReplayPanel.
 */
function replayResultRaw(overrides: Raw = {}): Raw {
  const frames = [
    frame("2026-11-17T09:15:00+05:30", 1417.4, 0, 12.5, 8.0),
    frame("2026-11-17T09:30:00+05:30", 1419.2, 85, 12.8, 9.4),
    frame("2026-11-17T10:00:00+05:30", 1421.6, 210, 13.6, 10.2),
    frame("2026-11-17T10:30:00+05:30", 1423.1, 340, 14.1, 11.0),
  ];
  const result: Raw = {
    position_id: null,
    underlying: "RELIANCE",
    expiry: "2026-11-26",
    source: "replay",
    frames,
    legs: [
      { action: "BUY", opt: "CE", strike: 1420, lots: 1, qty: 75, entry_premium: 12.5 },
      { action: "SELL", opt: "CE", strike: 1470, lots: 1, qty: 75, entry_premium: 8.0 },
    ],
    net_debit: 337.5,
    summary: { realized: 0, unrealized: 340, total: 340, max_drawdown: 0, costs: 90 },
    coverage: {
      frames: frames.length,
      first: frames[0].t,
      last: frames[frames.length - 1].t,
      gaps: 0,
    },
    payoff: {
      spots: [1380, 1400, 1420, 1440, 1460, 1480, 1500],
      expiry: [-337.5, -337.5, -187.5, 162.5, 412.5, 412.5, 412.5],
    },
    breakevens: [1432.5],
    max_profit: 412.5,
    max_loss: 337.5,
    skipped: null,
    ...overrides,
  };
  const rows = result.frames as Raw[];
  const finiteFrame = rows.some(
    (row) => Number.isFinite(row.spot as number) && Number.isFinite(row.net_pnl as number),
  );
  if (rows.length > 0 && !finiteFrame) {
    throw new Error("replayResultRaw frames must be finite (zero-frame states override frames: [])");
  }
  return result;
}

interface PaperMocks {
  setPositions: (rows: Raw[]) => void;
  orderBodies: Raw[];
}

async function mockOptionsPaper(page: Page, preview: Raw): Promise<PaperMocks> {
  const orderBodies: Raw[] = [];
  let positionRows: Raw[] = [paperPosition()];

  await page.route(apiRoute("options-paper/replay/sessions"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessions: [{
        underlying: "RELIANCE", expiry: "2026-11-26", date: "2026-11-18",
        source: "snapshot", frames: 10,
      }] }),
    });
  });

  await page.route(apiRoute("options-paper/orders"), async (route) => {
    const body = route.request().postDataJSON() as Raw;
    orderBodies.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        body.dryRun === true
          ? { dry_run: true, replay: preview, position: null }
          : { dry_run: false, position: paperPosition(), replay: null },
      ),
    });
  });

  await page.route(apiRoute("options-paper/positions"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(positionRows),
    });
  });

  return {
    orderBodies,
    setPositions: (rows: Raw[]) => { positionRows = rows; },
  };
}

/** Sets the pendingOrder via the real dock → "REPLAY THIS STRUCTURE" bridge. */
async function enterDockWithPreview(page: Page): Promise<PaperMocks> {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await mockMarketAndPatterns(page);
  await setupOptionDockMocks(page, { marketState: "closed" });
  const paper = await mockOptionsPaper(page, replayResultRaw());

  await page.goto(SNAPSHOT_PATH);
  await expect(page.getByTestId("market-row-RELIANCE")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("symbol-options-RELIANCE").first().click();
  await expect(page.getByTestId("options-dock")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("options-ce-1420").click();
  await expect(page.getByTestId("paper-order-band")).toBeVisible();
  return paper;
}

async function mockReplayFrames(
  page: Page,
  payload: Raw,
  status = 200,
): Promise<void> {
  await page.route(apiRoute("options-paper/replay/*"), async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(status === 200 ? payload : { detail: "Replay frames unavailable" }),
    });
  });
}

async function openReplayRoute(
  page: Page,
  path: string,
  mock?: (target: Page) => Promise<void>,
): Promise<void> {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  if (mock) await mock(page);
  await page.goto(path);
  await expect(page.getByTestId("options-replay-panel")).toBeVisible({ timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Captures — 9 states × 2 viewports
// ---------------------------------------------------------------------------

for (const viewport of VIEWPORTS) {
  test.describe(`options paper / replay visual evidence — ${viewport.label}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
    });

    test("dock with legs + PAPER ORDER band", async ({ page }) => {
      await enterDockWithPreview(page);
      await page.getByTestId("paper-order-band").scrollIntoViewIfNeeded();

      await visible(page, "paper-order-band");
      await visible(page, "paper-order-type");
      await visible(page, "paper-order-lots");
      await visible(page, "paper-order-slippage");
      await visible(page, "paper-order-place");
      await visible(page, "paper-order-replay");
      await visible(page, "options-ce-1420");
      await clean(page, "paper-order-band");
      await capture(page, "dock-with-legs", viewport);
      await noHorizontalOverflow(page, viewport);
    });

    test("positions modal with 2 rows", async ({ page }) => {
      const paper = await enterDockWithPreview(page);
      paper.setPositions([
        paperPosition({ id: 7, source: "live", status: "open" }),
        paperPosition({
          id: 8,
          uuid: "pos-8",
          source: "replay",
          status: "expired",
          underlying: "NIFTY",
          expiry: "2026-11-20",
          mark_spot: 24120.5,
          net_debit: 1850.5,
          total_pnl: -420.75,
          dte: 0,
        }),
      ]);

      await page.getByTestId("options-positions-chip").click();
      await expect(page.getByTestId("option-positions-modal")).toBeVisible();
      await expect(page.getByTestId("option-positions-row-7")).toBeVisible();
      await expect(page.getByTestId("option-positions-row-8")).toBeVisible();

      await visible(page, "option-positions-modal");
      await visible(page, "option-positions-panel");
      await visible(page, "option-positions-table");
      await visible(page, "option-positions-header");
      await expect(page.getByTestId("option-positions-header")).toContainText("PAPER BOOK");
      await expect(page.getByTestId("option-positions-scroll-hint")).toHaveCount(1);
      await expect(page.getByTestId("option-positions-scroll-hint")).toContainText(
        "Scroll horizontally",
      );
      await positionsTableTypography(page);
      await clean(page, "option-positions-panel");
      await clean(page, "option-positions-header");
      await capture(page, "positions-modal-2-rows", viewport);
      await noHorizontalOverflow(page, viewport);
    });

    test("replay preview — payoff workbench default, then advanced table/matrix/path tabs", async ({
      page,
    }) => {
      await enterDockWithPreview(page);
      await page.getByTestId("paper-order-replay").click();
      await expect(page.getByTestId("replay-playback")).toBeVisible({ timeout: 15000 });

      await expect(page.getByTestId("replay-commit-badge")).toContainText("PREVIEW");
      await expect(page.getByTestId("replay-clock")).toContainText("2026-11-17");
      await replayHeader(page, "RELIANCE", "2026-11-26");
      await clean(page, "replay-meta");
      await workbenchDefaultVisible(page);
      await intrinsicOnlyBadge(page, false); // dock chain supplies a recorded ATM IV
      await projectedNote(page, true);
      await visible(page, "replay-commit");
      await capture(page, "replay-workbench-preview", viewport);
      await noHorizontalOverflow(page, viewport);

      await denseTableVisible(page);
      await capture(page, "replay-table-preview", viewport);
      await noHorizontalOverflow(page, viewport);

      await page.getByTestId("replay-view-tab-matrix").click();
      await visible(page, "replay-matrix-heatmap");
      await capture(page, "replay-matrix-preview", viewport);
      await noHorizontalOverflow(page, viewport);

      await page.getByTestId("replay-view-tab-path").click();
      await visible(page, "replay-path-chart");
      await expect
        .soft(page.getByTestId("replay-path-chart").locator("canvas").first())
        .toBeVisible();
      await clean(page, "replay-path-panel");
      await capture(page, "replay-path-tab", viewport);
    });

    test("replay mid-scrub (playhead moved off the last frame)", async ({ page }) => {
      await enterDockWithPreview(page);
      await page.getByTestId("paper-order-replay").click();
      await expect(page.getByTestId("replay-clock")).toContainText("2026-11-17", { timeout: 15000 });

      const clockBefore = await page.getByTestId("replay-clock").textContent();
      await page.getByTestId("replay-scrubber").focus();
      await page.keyboard.press("ArrowLeft");
      await expect(page.getByTestId("replay-clock")).not.toHaveText(clockBefore ?? "");

      await visible(page, "replay-playback");
      await visible(page, "replay-scrubber");
      await visible(page, "replay-legs");
      await replayHeader(page, "RELIANCE", "2026-11-26");
      await workbenchDefaultVisible(page);
      await intrinsicOnlyBadge(page, false);
      await projectedNote(page, true);
      await capture(page, "replay-workbench-mid-scrub", viewport);
      await noHorizontalOverflow(page, viewport);

      await denseTableVisible(page);
      await capture(page, "replay-table-mid-scrub", viewport);
      await noHorizontalOverflow(page, viewport);

      await page.getByTestId("replay-view-tab-matrix").click();
      await visible(page, "replay-matrix-heatmap");
      await capture(page, "replay-matrix-mid-scrub", viewport);
      await noHorizontalOverflow(page, viewport);
    });

    test("replay committed (positionId on the route)", async ({ page }) => {
      await openReplayRoute(page, "/options/replay/9", (target) =>
        mockReplayFrames(target, replayResultRaw({ position_id: 9, source: "replay" })));

      await expect(page.getByTestId("replay-commit-badge")).toContainText("COMMITTED");
      await expect(page.getByTestId("replay-committed-note")).toContainText("Position #9");
      await expect(page.getByTestId("replay-commit")).toHaveCount(0);

      await visible(page, "replay-playback");
      await visible(page, "replay-controls");
      await replayHeader(page, "RELIANCE", "2026-11-26");
      await workbenchDefaultVisible(page);
      await intrinsicOnlyBadge(page, true); // bare replay route has no dock chain IV
      await projectedNote(page, true);
      await capture(page, "replay-workbench-committed", viewport);
      await noHorizontalOverflow(page, viewport);

      await denseTableVisible(page);
      await capture(page, "replay-table-committed", viewport);
      await noHorizontalOverflow(page, viewport);

      await page.getByTestId("replay-view-tab-matrix").click();
      await visible(page, "replay-matrix-heatmap");
      await capture(page, "replay-matrix-committed", viewport);
      await noHorizontalOverflow(page, viewport);
    });

    test("replay dense payoff table — advanced TABLE tab, no IV, intrinsic badge", async ({ page }) => {
      await openReplayRoute(page, "/options/replay/9", (target) =>
        mockReplayFrames(target, replayResultRaw({ position_id: 9, source: "replay" })));

      await expect(page.getByTestId("replay-commit-badge")).toContainText("COMMITTED");
      await replayHeader(page, "RELIANCE", "2026-11-26");
      await expect(page.getByTestId("replay-view-tab-payoff")).toHaveAttribute("aria-selected", "true");
      await denseTableVisible(page);
      await intrinsicOnlyBadge(page, true);
      await projectedNote(page, true);
      await capture(page, "replay-dense-table", viewport);
      await noHorizontalOverflow(page, viewport);
    });

    test("replay expired (skipped result, zero frames)", async ({ page }) => {
      await openReplayRoute(page, "/options/replay/9", (target) =>
        mockReplayFrames(target, replayResultRaw({
          position_id: 9,
          source: "replay",
          frames: [],
          coverage: { frames: 0, first: null, last: null, gaps: 0 },
          skipped: "Expired — chain snapshots stopped at 2026-11-20",
        })));

      await expect(page.getByTestId("replay-empty")).toBeVisible();
      await expect(page.getByTestId("replay-skipped")).toContainText("Expired");
      await expect(page.getByTestId("replay-commit-badge")).toContainText("COMMITTED");
      await replayHeader(page, "RELIANCE", "2026-11-26");

      await visible(page, "options-replay-panel");
      await clean(page, "options-replay-panel");
      await capture(page, "replay-expired", viewport);
      await noHorizontalOverflow(page, viewport);
    });

    test("replay empty (no pending structure, no positionId)", async ({ page }) => {
      await openReplayRoute(page, "/options/replay");

      await expect(page.getByTestId("replay-empty")).toBeVisible();
      await expect(page.getByTestId("replay-error")).toHaveCount(0);
      await visible(page, "options-replay-title");
      await visible(page, "replay-meta");
      await expect(page.getByTestId("replay-symbol-chip")).toContainText("NO STRUCTURE SELECTED");
      await expect(page.getByTestId("replay-expiry-chip")).toHaveCount(0);
      await replayDockCta(page);

      await visible(page, "options-replay-panel");
      await clean(page, "options-replay-panel");
      await clean(page, "replay-meta");
      await capture(page, "replay-empty", viewport);
      await noHorizontalOverflow(page, viewport);
    });

    test("replay API error (HTTP 500 from frames endpoint)", async ({ page }) => {
      await openReplayRoute(page, "/options/replay/9", (target) =>
        mockReplayFrames(target, {}, 500));

      await expect(page.getByTestId("replay-error")).toContainText("HTTP 500");
      await expect(page.getByTestId("replay-empty")).toBeVisible();
      await visible(page, "options-replay-title");
      await expect(page.getByTestId("replay-symbol-chip")).toContainText("NO STRUCTURE SELECTED");
      await replayDockCta(page);

      await visible(page, "options-replay-panel");
      await clean(page, "options-replay-panel");
      await clean(page, "replay-meta");
      await capture(page, "replay-api-error", viewport);
      await noHorizontalOverflow(page, viewport);
    });
  });
}
