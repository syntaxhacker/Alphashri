import { test, expect, type Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, setupOptionDockMocks } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

/** Multi-leg paper-order bridge. Every backend surface is spec-local. */
const DOCK_PATH = "/?tab=market";
const UNDERLYING = "RELIANCE";
const EXPIRY = "2026-11-26";
const POSITION_ID = 90;

interface RawLeg {
  action: "BUY" | "SELL";
  opt: "CE" | "PE";
  strike: number;
  premium: number;
  lots: number;
  instrumentKey?: string;
}

interface RawOrder {
  underlying: string;
  expiry: string;
  source: "live" | "replay";
  dryRun?: boolean;
  entryTs?: string;
  legs: RawLeg[];
}

type MockPosition = Record<string, unknown>;

function positionFrom(body: RawOrder): MockPosition {
  return {
    id: POSITION_ID,
    uuid: `pos-${POSITION_ID}`,
    user_id: 3,
    source: body.source,
    status: "open",
    underlying: body.underlying,
    expiry: body.expiry,
    name: `${body.legs.length}-leg structure`,
    entry_ts: body.entryTs ?? "2026-11-22T09:15:00+05:30",
    entry_spot: 1417.4,
    lots: 1,
    net_debit: 472.5,
    costs_est: 120,
    max_profit: 1600,
    max_loss: 472.5,
    breakevens: [1426],
    realized_pnl: 0,
    close_reason: null,
    closed_at: null,
    notes: "",
    legs: body.legs.map((leg, index) => ({
      id: index + 1,
      position_id: POSITION_ID,
      action: leg.action,
      opt_type: leg.opt,
      strike: leg.strike,
      lots: leg.lots,
      qty: leg.lots * 75,
      instrument_key: leg.instrumentKey ?? null,
      entry_premium: leg.premium,
      mark_premium: leg.premium,
      mark_ts: null,
      exit_premium: null,
    })),
    unrealized_pnl: 120,
    total_pnl: 120,
    mark_spot: 1419,
    mark_ts: null,
    dte: 4,
    created_at: "2026-11-22T09:15:00+05:30",
    updated_at: "2026-11-22T09:15:00+05:30",
  };
}

interface ReplayLeg {
  action: string;
  opt: string;
  strike: number;
  lots: number;
  qty: number;
  entry_premium: number;
}

function payoffAt(spot: number, legs: ReplayLeg[]): number {
  const pnl = legs.reduce((sum, leg) => {
    const intrinsic = leg.opt === "CE"
      ? Math.max(0, spot - leg.strike)
      : Math.max(0, leg.strike - spot);
    return sum + (leg.action === "BUY" ? 1 : -1) * leg.qty * (intrinsic - leg.entry_premium);
  }, 0);
  return Math.round(pnl * 100) / 100;
}

/** A preview with real frames and a real payoff curve, built from the order itself. */
function replayFrom(body: RawOrder): MockPosition {
  const legs: ReplayLeg[] = body.legs.map((leg) => ({
    action: leg.action,
    opt: leg.opt,
    strike: leg.strike,
    lots: leg.lots,
    qty: leg.lots * 75,
    entry_premium: leg.premium,
  }));
  const times = [
    "2026-11-17T09:30:00+05:30",
    "2026-11-17T11:00:00+05:30",
    "2026-11-17T14:30:00+05:30",
  ];
  const marksAt = (spot: number) => Object.fromEntries(
    legs.map((leg) => [
      `${leg.strike}-${leg.opt}`,
      Math.max(0.5, leg.entry_premium + (spot - 1417.4) / 75),
    ]),
  );
  const frames = times.map((t, index) => {
    const spot = 1417.4 + index * 1.4;
    return {
      t,
      spot,
      marks: marksAt(spot),
      priced: true,
      gross_pnl: index * 40,
      net_pnl: index * 20,
      net_debit: 500,
      equity: index * 20,
    };
  });
  const spots = [1380, 1400, 1420, 1440, 1460, 1480, 1500];
  if (!frames.some((row) => Number.isFinite(row.spot) && Number.isFinite(row.net_pnl))) {
    throw new Error("replayFrom must include a frame with finite values");
  }
  return {
    position_id: null,
    underlying: body.underlying,
    expiry: body.expiry,
    source: "replay",
    frames,
    legs,
    net_debit: 500,
    summary: { realized: 0, unrealized: 40, total: 40, max_drawdown: 0, costs: 120 },
    coverage: { frames: frames.length, first: times[0], last: times[times.length - 1], gaps: 0 },
    payoff: { spots, expiry: spots.map((spot) => payoffAt(spot, legs)) },
    breakevens: [1400, 1460],
    max_profit: 500,
    max_loss: -500,
    skipped: null,
  };
}

interface PaperMocks {
  orderBodies: RawOrder[];
  setOrderStatus: (status: number) => void;
  persisted: () => MockPosition[];
}

async function mockPaperApi(page: Page): Promise<PaperMocks> {
  const orderBodies: RawOrder[] = [];
  const persisted = new Map<number, MockPosition>();
  let orderStatus = 200;

  // Broad catch-all first; the two specific routes below are registered later
  // and therefore win (Playwright matches the most recent route first).
  await page.route(apiRoute("options-paper/**"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

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
    const body = route.request().postDataJSON() as RawOrder;
    orderBodies.push(body);
    if (orderStatus !== 200) {
      await route.fulfill({
        status: orderStatus,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Strike is unpriced" }),
      });
      return;
    }
    if (body.dryRun === true) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ dry_run: true, position: null, replay: replayFrom(body) }),
      });
      return;
    }
    const placed = positionFrom(body);
    persisted.set(placed.id as number, placed);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ dry_run: false, position: placed, replay: null }),
    });
  });

  await page.route(apiRoute("options-paper/positions"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([...persisted.values()]),
    });
  });

  return {
    orderBodies,
    setOrderStatus: (status) => { orderStatus = status; },
    persisted: () => [...persisted.values()],
  };
}

async function mockMarketAndPatterns(page: Page) {
  await page.route(apiRoute("market/snapshot"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        as_of: new Date().toISOString(),
        universe: "all_equity",
        total: 1,
        update_mode: "streaming",
        rows: [{
          symbol: UNDERLYING,
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
        }],
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

async function enterDock(page: Page): Promise<PaperMocks> {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await mockMarketAndPatterns(page);
  await setupOptionDockMocks(page);
  const paper = await mockPaperApi(page);
  await page.goto(DOCK_PATH);
  await expect(page.locator('[data-testid="market-row-RELIANCE"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="symbol-options-RELIANCE"]').first().click();
  await expect(page.locator('[data-testid="options-dock"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="options-ce-1420"]').click();
  await expect(page.locator('[data-testid="paper-order-band"]')).toBeVisible();
  return paper;
}

async function chooseStrategy(page: Page, id: "bull_call_spread" | "iron_condor") {
  await page.locator('[data-testid="options-strategy"]').click();
  await page.locator(`[data-testid="options-strategy-${id}"]`).click();
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

test.describe("Options paper — multi-leg structures", () => {
  test("a 2-leg bull call spread placed from the dock appears in the positions table with 2 legs", async ({
    page,
  }) => {
    const paper = await enterDock(page);
    await chooseStrategy(page, "bull_call_spread");
    await expect(page.locator('[data-testid="options-leg-count"]')).toHaveText("2/4");

    await page.locator('[data-testid="paper-order-place"]').click();

    await expect.poll(() => paper.orderBodies.length).toBe(1);
    const order = paper.orderBodies[0];
    expect(order).toMatchObject({ underlying: UNDERLYING, expiry: EXPIRY, source: "live" });
    expect(order.legs).toHaveLength(2);
    expect(order.legs.map((leg) => leg.action).sort()).toEqual(["BUY", "SELL"]);
    expect(order.legs.every((leg) => leg.opt === "CE")).toBe(true);

    await expect(page.locator('[data-testid="options-positions-chip"]')).toContainText("POSITIONS 1");
    await page.locator('[data-testid="options-positions-chip"]').click();
    const row = page.locator(`[data-testid="option-positions-row-${POSITION_ID}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("RELIANCE");
    await expect(row).toContainText("2 legs");
  });

  test("a 4-leg iron condor round-trips through the order payload", async ({ page }) => {
    const paper = await enterDock(page);
    await chooseStrategy(page, "iron_condor");
    await expect(page.locator('[data-testid="options-leg-count"]')).toHaveText("4/4");

    await page.locator('[data-testid="paper-order-place"]').click();

    await expect.poll(() => paper.orderBodies.length).toBe(1);
    const order = paper.orderBodies[0];
    expect(order).toMatchObject({ underlying: UNDERLYING, expiry: EXPIRY, source: "live" });
    expect(order.legs).toHaveLength(4);
    expect(order.legs.filter((leg) => leg.action === "SELL")).toHaveLength(2);
    expect(order.legs.filter((leg) => leg.action === "BUY")).toHaveLength(2);
    const types = new Set(order.legs.map((leg) => leg.opt));
    expect(types.has("CE")).toBe(true);
    expect(types.has("PE")).toBe(true);
    expect(order.legs.every((leg) => Number.isFinite(leg.strike) && leg.strike > 0)).toBe(true);

    await page.locator('[data-testid="options-positions-chip"]').click();
    const row = page.locator(`[data-testid="option-positions-row-${POSITION_ID}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("4 legs");
  });

  test("REPLAY THIS STRUCTURE navigates to /options/replay with query params and the replay page shows all legs and a non-empty payoff chart", async ({
    page,
  }) => {
    const paper = await enterDock(page);
    await chooseStrategy(page, "iron_condor");
    await page.locator('[data-testid="paper-order-replay"]').click();

    await expect(page).toHaveURL(/\/options\/replay\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("underlying")).toBe(UNDERLYING);
    expect(url.searchParams.get("expiry")).toBe(EXPIRY);

    await expect.poll(() => paper.orderBodies.some((body) => body.dryRun === true)).toBe(true);
    const preview = paper.orderBodies.find((body) => body.dryRun === true)!;
    expect(preview).toMatchObject({ source: "replay" });
    expect(preview.entryTs).toBeTruthy();
    expect(preview.legs).toHaveLength(4);

    await expect(page.locator('[data-testid="options-replay-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-replay-title"]')).toBeVisible();
    await expect(page.locator('[data-testid="replay-symbol-chip"]')).toContainText(UNDERLYING);
    await expect(page.locator('[data-testid="replay-expiry-chip"]')).toContainText(EXPIRY);
    await expect(page.locator('[data-testid="replay-loading"]')).toBeHidden();
    const legsPanel = page.locator('[data-testid="replay-legs"]');
    await expect(legsPanel).toBeVisible();
    const legText = await legsPanel.innerText();
    for (const strike of new Set(preview.legs.map((leg) => String(leg.strike)))) {
      expect(legText).toContain(strike);
    }
    expect((legText.match(/×/g) ?? []).length).toBe(4);

    await assertWorkstation(page);
    await page.getByTestId("replay-view-tab-payoff").click();
    const payoffChart = page.locator('[data-testid="replay-payoff-chart"]');
    await expect(payoffChart).toBeVisible();
    await expect(payoffChart.locator("canvas").first()).toBeVisible({ timeout: 15000 });
    await expect.poll(() => payoffChart.evaluate((el) => {
      const canvas = el.querySelector("canvas");
      return canvas ? canvas.width * canvas.height : 0;
    })).toBeGreaterThan(0);
    await expect(page.locator('[data-testid="replay-payoff-at-spot"]')).toContainText("₹");
    await page.getByTestId("replay-view-tab-path").click();
    await expect(page.locator('[data-testid="replay-path-chart"] canvas').first()).toBeVisible();
    await page.getByTestId("replay-view-tab-matrix").click();
    await expect(page.getByTestId("replay-matrix-heatmap")).toBeVisible();
  });

  test("COMMIT TO PAPER BOOK persists and shows the hold-to-expiry badge", async ({ page }) => {
    const paper = await enterDock(page);
    await chooseStrategy(page, "bull_call_spread");
    await page.locator('[data-testid="paper-order-replay"]').click();

    await expect(page).toHaveURL(/\/options\/replay\?/);
    await expect(page.locator('[data-testid="replay-symbol-chip"]')).toContainText(UNDERLYING);
    await expect(page.locator('[data-testid="replay-expiry-chip"]')).toContainText(EXPIRY);
    await expect(page.locator('[data-testid="replay-commit"]')).toBeVisible();
    await expect(page.locator('[data-testid="replay-commit-badge"]')).toContainText("PREVIEW");

    await page.locator('[data-testid="replay-commit"]').click();

    await expect.poll(() => paper.orderBodies.filter((body) => !body.dryRun)).toHaveLength(1);
    const commit = paper.orderBodies.find((body) => !body.dryRun)!;
    expect(commit).toMatchObject({ source: "replay" });
    expect(commit.legs).toHaveLength(2);
    expect(commit.entryTs).toBeTruthy();
    await expect.poll(() => paper.persisted()).toHaveLength(1);
    expect(paper.persisted()[0].source).toBe("replay");

    await expect(page.locator('[data-testid="replay-commit-badge"]')).toContainText("HOLD TO EXPIRY");
    await expect(page.locator('[data-testid="replay-committed-note"]')).toContainText("until expiry");
    await expect(page.locator('[data-testid="replay-commit"]')).toHaveCount(0);
  });

  test("an API 422 renders an inline error and leaves no position", async ({ page }) => {
    const paper = await enterDock(page);
    await chooseStrategy(page, "bull_call_spread");
    paper.setOrderStatus(422);

    await page.locator('[data-testid="paper-order-place"]').click();

    await expect(page.locator('[data-testid="paper-order-error"]')).toContainText("Strike is unpriced");
    await expect.poll(() => paper.orderBodies.length).toBe(1);
    await expect(paper.persisted()).toHaveLength(0);
    await expect(page.locator('[data-testid="options-positions-chip"]')).toContainText("POSITIONS 0");
    await page.locator('[data-testid="options-positions-chip"]').click();
    await expect(page.locator('[data-testid="option-positions-empty"]')).toContainText("No option positions");
  });
});
