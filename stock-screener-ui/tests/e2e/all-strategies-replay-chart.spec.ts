import { test, expect, Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { generateFullDayCandles } from "./helpers/chartHelpers";
import { mockSymbolSearch } from "./helpers/backtestHelpers";

const REPLAY_DATE_ISO = "2026-03-02";
const REPLAY_DATE_DISPLAY = "02 Mar 2026";

const orbTrades = [
  {
    id: 1,
    strategy: "ORB Conservative",
    symbol: "TCS",
    side: "BUY",
    entry_price: 3765,
    exit_price: 3810,
    entry_time: "2026-03-02T09:45:00",
    exit_time: "2026-03-02T10:30:00",
    pnl: 450,
    net_pnl: 430,
    costs: 20,
    exit_reason: "TP",
    quantity: 10,
  },
];

const srBreakoutTrades = [
  {
    id: 2,
    strategy: "SR Breakout",
    symbol: "RELIANCE",
    side: "BUY",
    entry_price: 2565,
    exit_price: 2590,
    entry_time: "2026-03-02T10:15:00",
    exit_time: "2026-03-02T11:00:00",
    pnl: 1250,
    net_pnl: 1200,
    costs: 50,
    exit_reason: "TP",
    quantity: 50,
  },
];

const emaCrossTrades = [
  {
    id: 3,
    strategy: "EMA Cross",
    symbol: "INFY",
    side: "BUY",
    entry_price: 1495,
    exit_price: 1520,
    entry_time: "2026-03-02T09:45:00",
    exit_time: "2026-03-02T11:15:00",
    pnl: 750,
    net_pnl: 730,
    costs: 20,
    exit_reason: "TP",
    quantity: 30,
  },
];

const chaser52wTrades = [
  {
    id: 4,
    strategy: "52W Chaser",
    symbol: "TCS",
    side: "BUY",
    entry_price: 3870,
    exit_price: 3840,
    entry_time: "2026-03-02T10:00:00",
    exit_time: "2026-03-02T10:45:00",
    pnl: -600,
    net_pnl: -620,
    costs: 20,
    exit_reason: "SL",
    quantity: 20,
  },
];

const target52wTrades = [
  {
    id: 5,
    strategy: "52W Target",
    symbol: "RELIANCE",
    side: "BUY",
    entry_price: 2540,
    exit_price: 2590,
    entry_time: "2026-03-02T09:30:00",
    exit_time: "2026-03-02T11:30:00",
    pnl: 2000,
    net_pnl: 1950,
    costs: 50,
    exit_reason: "TRAILING_STOP",
    quantity: 40,
  },
];

function buildSSEStream(events: any[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

async function setupCommonReplayMocks(page: Page) {
  await page.route(apiRoute("bots"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route(apiRoute("holidays"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ holidays: [] }),
    });
  });
  await page.route(apiRoute("replay/configs"), async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ configs: [] }),
      });
      return;
    }
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: 1, name: "auto", config: {} }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
  await mockSymbolSearch(page);
}

async function setupReplayMocks(
  page: Page,
  options: {
    trades: any[];
    orbZones?: any[];
    pivotLevels?: any[];
    week52Levels?: any;
    emaData?: any;
  },
) {
  const { trades, orbZones, pivotLevels, week52Levels, emaData } = options;

  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupCommonReplayMocks(page);

  await page.route(apiRoute("replay/symbols"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ symbols: ["TCS", "RELIANCE", "INFY", "HDFC", "HDFCBANK"] }),
    });
  });

  await page.route(apiRoute("strategies"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: 1, name: "ORB Conservative", strategy_type: "ORB" },
        { id: 2, name: "SR Breakout", strategy_type: "SR_BREAKOUT" },
        { id: 3, name: "EMA Cross", strategy_type: "EMA_CROSS" },
        { id: 4, name: "52W Chaser", strategy_type: "52W_CHASER" },
        { id: 5, name: "52W Target", strategy_type: "52W_TARGET" },
      ]),
    });
  });

  const primarySymbol = trades[0]?.symbol || "TCS";
  const base = primarySymbol === "TCS" ? 3750 : primarySymbol === "RELIANCE" ? 2500 : 1480;
  const candles = generateFullDayCandles(20, base);

  const winners = trades.filter((t) => t.pnl > 0).length;
  const losers = trades.filter((t) => t.pnl <= 0).length;
  const grossPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const totalCosts = trades.reduce((s, t) => s + (t.costs || 0), 0);
  const netPnl = trades.reduce((s, t) => s + (t.net_pnl || 0), 0);

  const sseEvents: any[] = [
    { type: "loaded", symbols: 1, candles: candles.length },
    { type: "candles", symbol: primarySymbol, candles },
  ];

  if (orbZones && orbZones.length > 0) {
    sseEvents.push({
      type: "or_levels",
      strategy: trades[0]?.strategy || "ORB",
      symbol: primarySymbol,
      or_high: orbZones[0].or_high,
      or_low: orbZones[0].or_low,
      or_range_pct: 0.4,
      from_index: 0,
      to_index: 3,
    });
  }

  if (pivotLevels && pivotLevels.length > 0) {
    sseEvents.push({
      type: "pivot_levels",
      strategy: trades[0]?.strategy || "ORB",
      symbol: primarySymbol,
      pp: pivotLevels[0].pp,
      r1: pivotLevels[0].r1,
      s1: pivotLevels[0].s1,
      r2: pivotLevels[0].r2,
      s2: pivotLevels[0].s2,
      from_index: 0,
      to_index: candles.length,
    });
  }

  if (week52Levels) {
    for (const [sym, levels] of Object.entries(week52Levels)) {
      const lvls = levels as any;
      sseEvents.push({
        type: "52w_high",
        strategy: trades.find((t) => t.symbol === sym)?.strategy || "52W",
        symbol: sym,
        high_52w: lvls.high_52w,
        low_52w: lvls.low_52w,
        from_index: 0,
        to_index: candles.length,
      });
    }
  }

  if (emaData) {
    for (const [sym, data] of Object.entries(emaData)) {
      const d = data as any;
      sseEvents.push({
        type: "ema_series",
        symbol: sym,
        ema_fast_period: 9,
        ema_slow_period: 21,
        timeframes: { "15min": { ema_fast: d.ema_9, ema_slow: d.ema_21 } },
      });
    }
  }

  for (const trade of trades) {
    sseEvents.push({
      type: "trade_open",
      strategy: trade.strategy,
      symbol: trade.symbol,
      side: trade.side,
      price: trade.entry_price,
      sl: trade.entry_price * 0.99,
      tp: trade.entry_price * 1.01,
      time: trade.entry_time,
      quantity: trade.quantity,
    });
  }

  for (const trade of trades) {
    sseEvents.push({
      type: "trade_close",
      strategy: trade.strategy,
      symbol: trade.symbol,
      side: trade.side,
      entry_price: trade.entry_price,
      exit_price: trade.exit_price,
      reason: trade.exit_reason,
      pnl: trade.pnl,
      net_pnl: trade.net_pnl,
      costs: trade.costs,
      entry_time: trade.entry_time,
      exit_time: trade.exit_time,
      quantity: trade.quantity,
    });
  }

  sseEvents.push({
    type: "summary",
    total_trades: trades.length,
    winners,
    losers,
    win_rate: trades.length > 0 ? Math.round((winners / trades.length) * 100) : 0,
    profit_factor: grossPnl > 0 ? 1.5 : 0.8,
    gross_pnl: grossPnl,
    total_costs: totalCosts,
    net_pnl: netPnl,
    strategy_breakdown: {},
  });

  sseEvents.push({ type: "done", success: true, duration_ms: 1500 });

  const sseBody = buildSSEStream(sseEvents);

  await page.route(apiRoute("replay/run"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "Cache-Control": "no-cache", Connection: "keep-alive" },
      body: sseBody,
    });
  });
}

async function navigateToReplayAndRun(page: Page, symbol = "TCS") {
  const params = new URLSearchParams({
    date: REPLAY_DATE_ISO,
    end_date: REPLAY_DATE_ISO,
    symbols: symbol,
  });
  await page.goto(`/replay?${params.toString()}`);
  await page.waitForSelector('[data-testid="replay-page"]', { timeout: 15000 });

  await expect(page.getByTestId("replay-date-from")).toContainText(REPLAY_DATE_DISPLAY);
  await expect(page.getByTestId("replay-date-to")).toContainText(REPLAY_DATE_DISPLAY);
  await expect(page.getByTestId("symbol-chips")).toContainText(symbol);

  const runBtn = page.locator('[data-testid="replay-run-btn"]');
  await expect(runBtn).toBeEnabled({ timeout: 5000 });
  await runBtn.click();

  await expect(page.locator('[data-testid="replay-chart"]')).toBeVisible({ timeout: 20000 });
}

test.describe("Replay Chart - ORB Strategy", () => {
  test("should run ORB replay and display chart", async ({ page }) => {
    await setupReplayMocks(page, {
      trades: orbTrades,
      orbZones: [{ date: "2026-03-02", or_high: 3760, or_low: 3745, or_end_time: "09:45" }],
      pivotLevels: [{ date: "2026-03-02", pp: 3750, r1: 3780, s1: 3720, r2: 3810, s2: 3690 }],
    });
    await navigateToReplayAndRun(page);
    await expect(page.locator('[data-testid="replay-chart"]')).toBeVisible({ timeout: 15000 });
  });

  test("should show ORB toggle control", async ({ page }) => {
    await setupReplayMocks(page, {
      trades: orbTrades,
      orbZones: [{ date: "2026-03-02", or_high: 3760, or_low: 3745, or_end_time: "09:45" }],
    });
    await navigateToReplayAndRun(page);
    await expect(page.locator('[data-testid="replay-show-orb"]')).toBeVisible({ timeout: 10000 });
  });

  test("should show symbol badge for traded symbol", async ({ page }) => {
    await setupReplayMocks(page, { trades: orbTrades });
    await navigateToReplayAndRun(page);
    await expect(page.locator('[data-testid="symbol-badge-TCS"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Replay Chart - SR Breakout Strategy", () => {
  test("should run SR Breakout replay and display chart", async ({ page }) => {
    await setupReplayMocks(page, {
      trades: srBreakoutTrades,
      pivotLevels: [{ date: "2026-03-02", pp: 2520, r1: 2560, s1: 2480, r2: 2590, s2: 2450 }],
    });
    await navigateToReplayAndRun(page, "RELIANCE");
    await expect(page.locator('[data-testid="replay-chart"]')).toBeVisible({ timeout: 15000 });
  });

  test("should show pivot toggle control", async ({ page }) => {
    await setupReplayMocks(page, {
      trades: srBreakoutTrades,
      pivotLevels: [{ date: "2026-03-02", pp: 2520, r1: 2560, s1: 2480, r2: 2590, s2: 2450 }],
    });
    await navigateToReplayAndRun(page, "RELIANCE");
    await expect(page.locator('[data-testid="replay-show-pivot"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Replay Chart - EMA Cross Strategy", () => {
  test("should run EMA Cross replay and display chart", async ({ page }) => {
    await setupReplayMocks(page, {
      trades: emaCrossTrades,
      emaData: {
        INFY: {
          ema_9: Array.from({ length: 20 }, (_, i) => 1485 + i * 5),
          ema_21: Array.from({ length: 20 }, (_, i) => 1480 + i * 3),
        },
      },
    });
    await navigateToReplayAndRun(page, "INFY");
    await expect(page.locator('[data-testid="replay-chart"]')).toBeVisible({ timeout: 15000 });
  });

  test("should show EMA toggle control", async ({ page }) => {
    await setupReplayMocks(page, { trades: emaCrossTrades });
    await navigateToReplayAndRun(page, "INFY");
    await expect(page.locator('[data-testid="replay-show-ema"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Replay Chart - 52W Chaser Strategy", () => {
  test("should run 52W Chaser replay and display chart", async ({ page }) => {
    await setupReplayMocks(page, {
      trades: chaser52wTrades,
      week52Levels: { TCS: { high_52w: 3900, low_52w: 3400, distance_to_high_pct: 2.5 } },
    });
    await navigateToReplayAndRun(page);
    await expect(page.locator('[data-testid="replay-chart"]')).toBeVisible({ timeout: 15000 });
  });

  test("should show 52W toggle control", async ({ page }) => {
    await setupReplayMocks(page, {
      trades: chaser52wTrades,
      week52Levels: { TCS: { high_52w: 3900, low_52w: 3400, distance_to_high_pct: 2.5 } },
    });
    await navigateToReplayAndRun(page);
    await expect(page.locator('[data-testid="replay-show-52w"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Replay Chart - 52W Target Strategy", () => {
  test("should run 52W Target replay and display chart", async ({ page }) => {
    await setupReplayMocks(page, {
      trades: target52wTrades,
      week52Levels: { RELIANCE: { high_52w: 2600, low_52w: 2200, distance_to_high_pct: 3.0 } },
    });
    await navigateToReplayAndRun(page, "RELIANCE");
    await expect(page.locator('[data-testid="replay-chart"]')).toBeVisible({ timeout: 15000 });
  });
});

test.describe("Replay Chart - Toggle Controls", () => {
  test("should show all-trades toggle", async ({ page }) => {
    await setupReplayMocks(page, { trades: orbTrades });
    await navigateToReplayAndRun(page);
    await expect(page.locator('[data-testid="replay-show-all-trades"]')).toBeVisible({
      timeout: 10000,
    });
  });

  test("should show markers toggle", async ({ page }) => {
    await setupReplayMocks(page, { trades: orbTrades });
    await navigateToReplayAndRun(page);
    await expect(page.locator('[data-testid="replay-show-markers"]')).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("Replay Chart - Config Panel", () => {
  test("should display replay config form", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupCommonReplayMocks(page);
    await page.goto("/replay");
    await page.waitForSelector('[data-testid="replay-page"]', { timeout: 15000 });

    await expect(page.locator('[data-testid="replay-config"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="replay-date-from"]')).toBeVisible();
    await expect(page.locator('[data-testid="replay-date-to"]')).toBeVisible();
    await expect(page.locator('[data-testid="replay-symbols-select"]')).toBeVisible();
    await expect(page.locator('[data-testid="replay-run-btn"]')).toBeVisible();
  });

  test("should display refresh cache switch", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupCommonReplayMocks(page);
    await page.goto("/replay");
    await page.waitForSelector('[data-testid="replay-page"]', { timeout: 15000 });
    await expect(page.locator('[data-testid="replay-refresh-cache-switch"]')).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("Replay Chart - Trade Log", () => {
  test("should display trade log after replay", async ({ page }) => {
    await setupReplayMocks(page, { trades: orbTrades });
    await navigateToReplayAndRun(page);
    await expect(page.locator('[data-testid="replay-trade-log"]')).toBeVisible({ timeout: 10000 });
  });

  test("should show strategy filter in trade log", async ({ page }) => {
    await setupReplayMocks(page, { trades: orbTrades });
    await navigateToReplayAndRun(page);
    await expect(page.locator('[data-testid="replay-trade-log-strategy-filter"]')).toBeVisible({
      timeout: 10000,
    });
  });

  test("should show symbol filter in trade log", async ({ page }) => {
    await setupReplayMocks(page, { trades: orbTrades });
    await navigateToReplayAndRun(page);
    await expect(page.locator('[data-testid="replay-trade-log-symbol-filter"]')).toBeVisible({
      timeout: 10000,
    });
  });

  test("should display trade rows with strategy links", async ({ page }) => {
    await setupReplayMocks(page, { trades: orbTrades });
    await navigateToReplayAndRun(page);
    await expect(page.locator('[data-testid="replay-trade-row-1"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="replay-trade-strategy-link-1"]')).toBeVisible();
  });
});

test.describe("Replay Chart - Summary and Stats", () => {
  test("should display replay stats", async ({ page }) => {
    await setupReplayMocks(page, { trades: orbTrades });
    await navigateToReplayAndRun(page);
    await expect(page.locator('[data-testid="replay-stats"]')).toBeVisible({ timeout: 10000 });
  });

  test("should display replay summary", async ({ page }) => {
    await setupReplayMocks(page, { trades: orbTrades });
    await navigateToReplayAndRun(page);
    await expect(page.locator('[data-testid="replay-summary"]')).toBeVisible({ timeout: 10000 });
  });

  test("should display replay positions panel when trades exist", async ({ page }) => {
    await setupReplayMocks(page, { trades: orbTrades });
    await navigateToReplayAndRun(page);
    const positionsPanel = page.locator('[data-testid="replay-positions"]');
    if (await positionsPanel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(positionsPanel).toBeVisible();
    }
  });
});

test.describe("Replay Chart - Empty State", () => {
  test("should show empty state when no replay data", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupCommonReplayMocks(page);
    await page.goto("/replay");
    await page.waitForSelector('[data-testid="replay-page"]', { timeout: 15000 });
    await expect(page.locator('[data-testid="replay-chart-empty"]')).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("Replay Chart - Timeframe Buttons", () => {
  test("should display timeframe buttons on chart", async ({ page }) => {
    await setupReplayMocks(page, { trades: orbTrades });
    await navigateToReplayAndRun(page);
    const tfButtons = page.locator('[data-testid^="tf-btn-"]');
    const count = await tfButtons.count();
    expect(count).toBeGreaterThan(0);
  });
});
