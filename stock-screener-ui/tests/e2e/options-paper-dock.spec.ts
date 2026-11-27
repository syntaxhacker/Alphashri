import { test, expect, type Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, setupOptionDockMocks } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

/** Dock → options-paper bridge. Every backend surface is spec-local. */
const SNAPSHOT_PATH = "/?tab=market";

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

function paperPosition(overrides: Record<string, unknown> = {}) {
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
    net_debit: 472.5,
    costs_est: 90,
    max_profit: 1600,
    max_loss: 472.5,
    breakevens: [1426],
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
        mark_premium: 13,
        mark_ts: null,
        exit_premium: null,
      },
    ],
    unrealized_pnl: 120,
    total_pnl: 120,
    mark_spot: 1419,
    mark_ts: null,
    dte: 4,
    created_at: "2026-11-22T09:15:00+05:30",
    updated_at: "2026-11-22T09:15:00+05:30",
    ...overrides,
  };
}

/**
 * A preview with two finite frames and a real 2-leg payoff curve. The matrix
 * derives its KPIs from `legs`, so an empty `legs`/`payoff` would hide the very
 * workstation states these assertions cover.
 */
function replayResult(requestedLegs?: Array<Record<string, unknown>>) {
  const sourceLegs = requestedLegs?.length
    ? requestedLegs
    : [
        { action: "BUY", opt: "CE", strike: 1420, lots: 1, premium: 12.5 },
        { action: "SELL", opt: "CE", strike: 1470, lots: 1, premium: 8.0 },
      ];
  const legs = sourceLegs.map((leg) => ({
    action: leg.action,
    opt: leg.opt,
    strike: Number(leg.strike),
    lots: Number(leg.lots ?? 1),
    qty: Number(leg.lots ?? 1) * 75,
    entry_premium: Number(leg.premium ?? 0),
  }));
  const marks = Object.fromEntries(
    legs.map((leg, index) => [`${leg.strike}-${leg.opt}`, leg.entry_premium + index * 0.1]),
  );
  const active = Object.fromEntries(legs.map((leg) => [`${leg.strike}-${leg.opt}`, true]));
  const nextMarks = Object.fromEntries(
    legs.map((leg, index) => [`${leg.strike}-${leg.opt}`, leg.entry_premium + 1.1 + index * 0.1]),
  );
  const first = "2026-11-18T09:47:00+05:30";
  const last = "2026-11-18T10:15:00+05:30";
  const frames = [
    {
      t: first,
      spot: 1417.4,
      marks,
      active,
      priced: true,
      gross_pnl: 0,
      net_pnl: -60,
      net_debit: 337.5,
      equity: -60,
    },
    {
      t: last,
      spot: 1421.6,
      marks: nextMarks,
      active,
      priced: true,
      gross_pnl: 255,
      net_pnl: 165,
      net_debit: 337.5,
      equity: 165,
    },
  ];
  if (!frames.some((row) => Number.isFinite(row.spot) && Number.isFinite(row.net_pnl))) {
    throw new Error("replayResult must include a frame with finite values");
  }
  return {
    dry_run: true,
    replay: {
      position_id: null,
      underlying: "RELIANCE",
      expiry: "2026-11-26",
      source: "replay",
      legs,
      frames,
      summary: { realized: 0, unrealized: 165, total: 165, max_drawdown: 0, costs: 60 },
      coverage: { frames: 2, first, last, gaps: 0 },
      payoff: {
        spots: [1380, 1420, 1440, 1460, 1480, 1500],
        expiry: [-337.5, -337.5, 1162.5, 2662.5, 3412.5, 3412.5],
      },
      breakevens: [1424.5],
      net_debit: 337.5,
      max_profit: 3412.5,
      max_loss: 337.5,
      skipped: null,
    },
  };
}

interface PaperMocks {
  orderBodies: Array<Record<string, unknown>>;
  setOrderStatus: (status: number) => void;
  setPositions: (rows: Array<Record<string, unknown>>) => void;
}

async function mockMarketAndPatterns(page: Page) {
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

async function mockOptionsPaper(page: Page): Promise<PaperMocks> {
  const orderBodies: Array<Record<string, unknown>> = [];
  let orderStatus = 200;
  let positionRows: Array<Record<string, unknown>> = [paperPosition()];

  // Registered first so the two specific routes below win: Playwright matches
  // the most recently registered route first.
  await page.route(apiRoute("options-paper/**"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route(apiRoute("options-paper/replay/sessions"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sessions: [{
          underlying: "RELIANCE",
          expiry: "2026-11-26",
          date: "2026-11-18",
          source: "snapshot",
          frames: 10,
        }],
      }),
    });
  });

  await page.route(apiRoute("options-paper/orders"), async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    orderBodies.push(body);
    if (orderStatus !== 200) {
      await route.fulfill({
        status: orderStatus,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Strike is unpriced" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        body.dryRun === true
          ? replayResult(body.legs as Array<Record<string, unknown>> | undefined)
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
    setOrderStatus: (status: number) => { orderStatus = status; },
    setPositions: (rows: Array<Record<string, unknown>>) => { positionRows = rows; },
  };
}

async function enterDock(page: Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await mockMarketAndPatterns(page);
  await setupOptionDockMocks(page);
  const paper = await mockOptionsPaper(page);
  await page.goto(SNAPSHOT_PATH);
  await expect(page.locator('[data-testid="market-row-RELIANCE"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="symbol-options-RELIANCE"]').first().click();
  await expect(page.locator('[data-testid="options-dock"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="options-ce-1420"]').click();
  await expect(page.locator('[data-testid="paper-order-band"]')).toBeVisible();
  return paper;
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

/** Advanced view: the dense strike × dated-expiry TABLE. Opens the tab explicitly. */
async function assertDenseTable(page: Page) {
  const tab = page.locator('[data-testid="replay-view-tab-table"]');
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-testid="replay-table-panel"]')).toBeVisible();
  const table = page.locator('[data-testid="replay-table-table"]');
  await expect(table).toBeVisible();

  const datedHeads = page.locator('[data-testid^="replay-table-col-head-"]');
  const columnCount = await datedHeads.count();
  expect(columnCount, "at least 12 dated columns").toBeGreaterThanOrEqual(12);
  const headText = (await datedHeads.first().innerText()).trim();
  expect(headText.length, "first dated header is non-empty").toBeGreaterThan(0);
  expect(headText, "dated header must not be undefined/NaN").not.toMatch(/undefined|NaN/);
  expect(
    await datedHeads.first().locator("span").count(),
    "nested two-tier header (month over date)",
  ).toBeGreaterThanOrEqual(2);

  await expect(
    page.locator('[data-testid="replay-table-table"] thead th').first(),
  ).toContainText("STRIKE");
  const strike = page.locator('[data-testid="replay-table-strike-0"]');
  await expect(strike).toBeVisible();
  expect((await strike.innerText()).trim(), "first strike column carries a value").not.toMatch(
    /undefined|NaN/,
  );

  const rowCount = await page.locator('[data-testid^="replay-table-row-"]').count();
  expect(rowCount, "at least 15 strike rows").toBeGreaterThanOrEqual(15);
  const cellCount = await page.locator('[data-testid^="replay-table-cell-"]').count();
  expect(cellCount, "one cell per strike × expiry intersection").toBeGreaterThanOrEqual(
    rowCount * 12,
  );
  const tableText = (await table.textContent()) ?? "";
  expect(tableText, "no undefined/NaN in table cells").not.toMatch(/undefined|NaN/);

  await expect(page.locator('[data-testid="replay-range-controls"]')).toBeVisible();
  await expect(page.locator('[data-testid="replay-range-slider"]')).toBeVisible();
  await expect(page.locator('[data-testid="replay-iv-readout"]')).toBeVisible();
  await expect(page.locator('[data-testid="replay-table-controls"]')).toBeVisible();
  await expect(page.locator('[data-testid="replay-table-table-range"]')).toBeVisible();
  await expect(page.locator('[data-testid="replay-table-table-iv"]')).toBeVisible();
  for (const id of TABLE_VIEW_IDS) {
    await expect(page.locator(`[data-testid="replay-table-view-tab-${id}"]`)).toBeVisible();
  }
}

/** The intrinsic-only badge is present exactly when the recorded chain has no IV quote. */
async function assertIvBadge(page: Page) {
  const readout = (await page.locator('[data-testid="replay-iv-readout"]').innerText()).trim();
  const badge = page.locator('[data-testid="replay-table-intrinsic-badge"]');
  if (/IV unavailable/.test(readout)) {
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("INTRINSIC ONLY");
    await expect(page.locator('[data-testid="replay-iv-banner"]')).toBeVisible();
    await expect(page.locator('[data-testid="replay-table-intrinsic-note"]')).toHaveCount(1);
  } else {
    expect(readout, "IV readout is a finite percentage").toMatch(/\d+\.\d+% IV/);
    await expect(badge).toHaveCount(0);
    await expect(page.locator('[data-testid="replay-iv-banner"]')).toHaveCount(0);
  }
}

/**
 * PAYOFF is the default workstation view: one dock-style workbench with a
 * single payoff line, one KPI strip and finite values throughout.
 */
async function assertWorkbenchDefault(page: Page) {
  const tab = page.locator('[data-testid="replay-view-tab-payoff"]');
  await expect(tab).toBeVisible();
  await expect(tab, "PAYOFF is the default view").toHaveAttribute("aria-selected", "true");

  await expect(page.locator('[data-testid="replay-payoff-workbench"]')).toBeVisible();
  const payoff = page.locator('[data-testid="replay-payoff-chart"]');
  await expect(payoff).toBeVisible();
  await expect(payoff.locator("canvas").first()).toBeVisible({ timeout: 15000 });

  const strips = page.locator('[data-testid="replay-matrix-kpis"]');
  await expect(strips, "exactly one KPI strip in the default view").toHaveCount(1);
  await expect(strips).toBeVisible();
  for (const id of MATRIX_KPI_IDS) {
    const el = page.locator(`[data-testid="${id}"]`);
    await expect(el).toBeVisible();
    const text = (await el.textContent() ?? "").trim();
    expect(text.length, `${id} must not be empty`).toBeGreaterThan(0);
    expect(text, `${id} must not contain undefined/NaN`).not.toMatch(/undefined|NaN/);
  }
  await expect(page.locator('[data-testid="replay-payoff-at-spot"]')).toContainText("₹");
  await expect(page.locator('[data-testid="options-replay-panel"]')).not.toContainText(
    /undefined|NaN/,
  );
}

/** PAYOFF is the default; TABLE/MATRIX/PATH stay reachable as advanced tabs. */
async function assertWorkstation(page: Page) {
  await assertWorkbenchDefault(page);
  await assertIvBadge(page);

  await expect(page.locator('[data-testid="replay-view-tab-matrix"]')).toBeVisible();
  await assertDenseTable(page);

  await page.locator('[data-testid="replay-view-tab-matrix"]').click();
  await expect(page.locator('[data-testid="replay-matrix-heatmap"]')).toBeVisible();
  await expect(
    page.locator('[data-testid="replay-matrix-heatmap-chart"] canvas').first(),
  ).toBeVisible({ timeout: 15000 });

  await page.locator('[data-testid="replay-view-tab-path"]').click();
  const path = page.locator('[data-testid="replay-path-chart"]');
  await expect(path).toBeVisible();
  await expect(path.locator("canvas").first()).toBeVisible({ timeout: 15000 });

  await page.locator('[data-testid="replay-view-tab-payoff"]').click();
  await expect(page.locator('[data-testid="replay-payoff-workbench"]')).toBeVisible();
}

test.describe("Options dock — paper order band", () => {
  test("a dock with legs shows the order ticket", async ({ page }) => {
    await enterDock(page);
    await expect(page.locator('[data-testid="paper-order-type"]')).toBeVisible();
    await expect(page.locator('[data-testid="paper-order-lots"]')).toBeVisible();
    await expect(page.locator('[data-testid="paper-order-slippage"]')).toBeVisible();
    await expect(page.locator('[data-testid="paper-order-debit"]')).toContainText("NET");
    await expect(page.locator('[data-testid="paper-order-place"]')).toBeVisible();
    await expect(page.locator('[data-testid="paper-order-replay"]')).toBeVisible();
  });

  test("PLACE PAPER TRADE posts the structure and shows the position", async ({ page }) => {
    const paper = await enterDock(page);
    await page.locator('[data-testid="paper-order-place"]').click();

    await expect.poll(() => paper.orderBodies.length).toBe(1);
    expect(paper.orderBodies[0]).toMatchObject({
      underlying: "RELIANCE",
      expiry: "2026-11-26",
      source: "live",
    });
    expect((paper.orderBodies[0].legs as Array<Record<string, unknown>>)[0]).toMatchObject({
      action: "BUY",
      opt: "CE",
      strike: 1420,
    });

    await expect(page.locator('[data-testid="options-positions-chip"]')).toContainText("POSITIONS 1");
    await page.locator('[data-testid="options-positions-chip"]').click();
    await expect(page.locator('[data-testid="option-positions-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="option-positions-header"]')).toContainText("PAPER BOOK");
    await expect(page.locator('[data-testid="option-positions-scroll-hint"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="option-positions-row-7"]')).toContainText("RELIANCE");
  });

  test("an API 422 renders the error inline", async ({ page }) => {
    const paper = await enterDock(page);
    paper.setOrderStatus(422);
    await page.locator('[data-testid="paper-order-place"]').click();

    await expect(page.locator('[data-testid="paper-order-error"]')).toContainText("Strike is unpriced");
  });

  test("REPLAY THIS STRUCTURE previews and navigates with the identity params", async ({ page }) => {
    const paper = await enterDock(page);
    await page.locator('[data-testid="paper-order-replay"]').click();

    await expect.poll(() => page.url()).toContain("/options/replay");
    const url = new URL(page.url());
    expect(url.searchParams.get("underlying")).toBe("RELIANCE");
    expect(url.searchParams.get("expiry")).toBe("2026-11-26");
    await expect(page.locator('[data-testid="replay-symbol-chip"]')).toContainText("RELIANCE");
    await expect(page.locator('[data-testid="replay-expiry-chip"]')).toContainText("2026-11-26");
    await assertWorkstation(page);
    await expect.poll(() => paper.orderBodies.length).toBe(1);
    expect(paper.orderBodies[0]).toMatchObject({ source: "replay", dryRun: true });
    expect(paper.orderBodies[0].entryTs).toBeTruthy();
  });

  test("an empty book renders the positions empty state", async ({ page }) => {
    const paper = await enterDock(page);
    paper.setPositions([]);
    await page.locator('[data-testid="options-positions-chip"]').click();

    await expect(page.locator('[data-testid="option-positions-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="option-positions-empty"]')).toContainText(
      "No option positions",
    );
  });
});
