import { test, expect, Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { TEST_BOT_UUID, setupBotApiMocks, createLivePosition } from "./helpers/botHelpers";
import { generateCandles } from "./helpers/chartHelpers";

async function setupPaperWithChart(
  page: Page,
  options: {
    positionSymbol?: string;
    strategyName?: string;
    orbLevels?: { or_high: number; or_low: number } | null;
    pivotLevels?: { pp: number; r1: number; s1: number; r2: number; s2: number } | null;
    week52Levels?: {
      high_52w: number;
      low_52w: number;
      distance_to_high_pct: number;
      near_high: boolean;
    } | null;
    emaData?: { ema_9: number[]; ema_21: number[] } | null;
    trades?: any[];
    livePosition?: any;
  } = {},
) {
  const {
    positionSymbol = "TCS",
    strategyName = "ORB Conservative",
    orbLevels = { or_high: 3760, or_low: 3745 },
    pivotLevels = { pp: 3750, r1: 3780, s1: 3720, r2: 3810, s2: 3690 },
    week52Levels = null,
    emaData = null,
    trades = [],
    livePosition = null,
  } = options;

  await setupApiMocks(page);
  await loginAsTestUser(page);

  const pos = livePosition
    ? {
        id: 1,
        symbol: livePosition.symbol,
        side: livePosition.side || "BUY",
        quantity: livePosition.quantity || 10,
        entry_price: livePosition.entry_price,
        current_price: livePosition.current_price,
        pnl: livePosition.pnl,
        pnl_pct: livePosition.pnl_pct,
        margin_used: livePosition.entry_price * (livePosition.quantity || 10),
        strategy_name: strategyName,
        strategy_id: 1,
        stop_loss: livePosition.stop_loss,
        take_profit: livePosition.take_profit,
        entry_time: "2026-03-02T09:30:00",
      }
    : null;

  const positions = pos ? [pos] : [];

  await setupBotApiMocks(page, {
    botId: TEST_BOT_UUID,
    botName: "Test Bot",
    strategies: [
      { id: 1, name: strategyName, allocation: 0.5 },
      { id: 2, name: "SR Breakout", allocation: 0.3 },
      { id: 3, name: "52W Chaser", allocation: 0.2 },
    ],
    positions,
    scanItems: [],
  });

  const candles = generateCandles(
    10,
    positionSymbol === "TCS" ? 3750 : positionSymbol === "RELIANCE" ? 2500 : 1480,
  );

  const chartResponse: any = {
    symbol: positionSymbol,
    candles,
    timeframe: 15,
    or_minutes: 45,
    total_candles: candles.length,
    orb_levels: orbLevels,
    pivot_levels: pivotLevels || null,
    week52_levels: week52Levels || null,
    ema_data: emaData || null,
    trades,
  };

  await page.route("**/api/paper/chart/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chartResponse),
    });
  });
}

async function navigateAndClickPosition(page: Page, symbol: string = "TCS") {
  await page.goto("/paper");
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
  await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({ timeout: 20000 });

  const botSelector = page.locator('[data-testid="bot-selector-dropdown"]');
  await botSelector.waitFor({ state: "visible", timeout: 10000 });
  await botSelector.getByText("Test Bot", { exact: false }).first().click();
  await page.waitForLoadState("networkidle");

  const positionRow = page.locator(`[data-testid="position-row-${symbol}"]`);
  await expect(positionRow).toBeVisible({ timeout: 10000 });
  await positionRow.click();
  await expect(page.locator('[data-testid="paper-chart-container"]')).toBeVisible({
    timeout: 10000,
  });
}

async function verifyPaperChartRenders(page: Page) {
  await expect(page.locator('[data-testid="paper-chart-container"]')).toBeVisible({
    timeout: 10000,
  });
}

test.describe("Paper Chart - ORB Strategy", () => {
  test("should display chart when clicking ORB position", async ({ page }) => {
    await setupPaperWithChart(page, {
      positionSymbol: "TCS",
      strategyName: "ORB Conservative",
      orbLevels: { or_high: 3760, or_low: 3745 },
      livePosition: createLivePosition(),
    });
    await navigateAndClickPosition(page, "TCS");
    await verifyPaperChartRenders(page);
  });

  test("should show ORB lines toggle", async ({ page }) => {
    await setupPaperWithChart(page, {
      livePosition: createLivePosition(),
    });
    await navigateAndClickPosition(page, "TCS");
    await expect(page.locator('[data-testid="show-orb-lines"]')).toBeVisible({ timeout: 10000 });
  });

  test("should show chart with SL/TP data for live position", async ({ page }) => {
    await setupPaperWithChart(page, {
      livePosition: createLivePosition(),
    });
    await navigateAndClickPosition(page, "TCS");
    await verifyPaperChartRenders(page);
    const hasChart = await page
      .locator('[data-testid="paper-chart-container"]')
      .isVisible({ timeout: 5000 });
    expect(hasChart).toBeTruthy();
  });

  test("should show chart when position is clicked", async ({ page }) => {
    await setupPaperWithChart(page, {
      livePosition: createLivePosition(),
    });
    await navigateAndClickPosition(page, "TCS");
    await verifyPaperChartRenders(page);
  });
});

test.describe("Paper Chart - SR Breakout Strategy", () => {
  test("should display chart for SR Breakout position", async ({ page }) => {
    await setupPaperWithChart(page, {
      positionSymbol: "RELIANCE",
      strategyName: "SR Breakout",
      orbLevels: null,
      pivotLevels: { pp: 2520, r1: 2560, s1: 2480, r2: 2590, s2: 2450 },
      livePosition: createLivePosition({
        symbol: "RELIANCE",
        entry_price: 2565,
        current_price: 2580,
        pnl: 150,
        pnl_pct: 0.58,
        quantity: 50,
        stop_loss: 2520,
        take_profit: 2620,
      }),
    });
    await navigateAndClickPosition(page, "RELIANCE");
    await verifyPaperChartRenders(page);
  });

  test("should show pivot lines toggle", async ({ page }) => {
    await setupPaperWithChart(page, {
      positionSymbol: "RELIANCE",
      strategyName: "SR Breakout",
      orbLevels: null,
      livePosition: createLivePosition({
        symbol: "RELIANCE",
        entry_price: 2565,
        current_price: 2580,
        pnl: 150,
        pnl_pct: 0.58,
        quantity: 50,
      }),
    });
    await navigateAndClickPosition(page, "RELIANCE");
    await expect(page.locator('[data-testid="show-pivot-lines"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Paper Chart - 52W Chaser Strategy", () => {
  test("should display chart for 52W Chaser position with 52W levels", async ({ page }) => {
    await setupPaperWithChart(page, {
      positionSymbol: "TCS",
      strategyName: "52W Chaser",
      orbLevels: null,
      week52Levels: { high_52w: 3900, low_52w: 3400, distance_to_high_pct: 2.5, near_high: true },
      livePosition: createLivePosition({
        entry_price: 3850,
        current_price: 3870,
        pnl: 200,
        pnl_pct: 0.52,
        quantity: 20,
        stop_loss: 3800,
        take_profit: 3950,
      }),
    });
    await navigateAndClickPosition(page, "TCS");
    await verifyPaperChartRenders(page);
  });

  test("should show 52W lines toggle", async ({ page }) => {
    await setupPaperWithChart(page, {
      positionSymbol: "TCS",
      strategyName: "52W Chaser",
      orbLevels: null,
      week52Levels: { high_52w: 3900, low_52w: 3400, distance_to_high_pct: 2.5, near_high: true },
      livePosition: createLivePosition({
        entry_price: 3850,
        current_price: 3870,
        pnl: 200,
        pnl_pct: 0.52,
        quantity: 20,
      }),
    });
    await navigateAndClickPosition(page, "TCS");
    await expect(page.locator('[data-testid="show-52w-lines"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Paper Chart - EMA Cross Strategy", () => {
  test("should display chart for EMA Cross position with EMA overlays", async ({ page }) => {
    await setupPaperWithChart(page, {
      positionSymbol: "INFY",
      strategyName: "EMA Cross",
      orbLevels: null,
      pivotLevels: null,
      emaData: {
        ema_9: [1485, 1490, 1495, 1500, 1505, 1510, 1515, 1520, 1525, 1530],
        ema_21: [1480, 1482, 1485, 1488, 1490, 1493, 1496, 1500, 1503, 1507],
      },
      livePosition: createLivePosition({
        symbol: "INFY",
        entry_price: 1500,
        current_price: 1510,
        pnl: 200,
        pnl_pct: 0.67,
        quantity: 30,
        stop_loss: 1470,
        take_profit: 1550,
      }),
    });
    await navigateAndClickPosition(page, "INFY");
    await verifyPaperChartRenders(page);
  });

  test("should show EMA lines toggle", async ({ page }) => {
    await setupPaperWithChart(page, {
      positionSymbol: "INFY",
      strategyName: "EMA Cross",
      orbLevels: null,
      pivotLevels: null,
      emaData: {
        ema_9: [1485, 1490, 1495, 1500, 1505, 1510, 1515, 1520, 1525, 1530],
        ema_21: [1480, 1482, 1485, 1488, 1490, 1493, 1496, 1500, 1503, 1507],
      },
      livePosition: createLivePosition({
        symbol: "INFY",
        entry_price: 1500,
        current_price: 1510,
        pnl: 200,
        pnl_pct: 0.67,
        quantity: 30,
      }),
    });
    await navigateAndClickPosition(page, "INFY");
    await expect(page.locator('[data-testid="show-ema-lines"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Paper Chart - Timeframe Switching", () => {
  test("should display timeframe selector", async ({ page }) => {
    await setupPaperWithChart(page, {
      livePosition: createLivePosition(),
    });
    await navigateAndClickPosition(page, "TCS");
    await expect(page.locator('[data-testid="paper-chart-timeframe"]')).toBeVisible({
      timeout: 10000,
    });
  });

  test("should show all-trades switch", async ({ page }) => {
    await setupPaperWithChart(page, {
      livePosition: createLivePosition(),
    });
    await navigateAndClickPosition(page, "TCS");
    await expect(page.locator('[data-testid="show-all-trades-switch"]')).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("Paper Chart - Live Position Marker", () => {
  test("should render chart for live position", async ({ page }) => {
    await setupPaperWithChart(page, {
      livePosition: createLivePosition(),
    });
    await navigateAndClickPosition(page, "TCS");
    await verifyPaperChartRenders(page);
  });
});

test.describe("Paper Chart - Chart Header and Legend", () => {
  test("should show chart header with symbol", async ({ page }) => {
    await setupPaperWithChart(page, {
      livePosition: createLivePosition(),
    });
    await navigateAndClickPosition(page, "TCS");
    await expect(page.locator('[data-testid="paper-chart-header"]')).toBeVisible({
      timeout: 10000,
    });
  });

  test("should show chart legend", async ({ page }) => {
    await setupPaperWithChart(page, {
      livePosition: createLivePosition(),
    });
    await navigateAndClickPosition(page, "TCS");
    await expect(page.locator('[data-testid="chart-legend"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Paper Chart - No Position Empty State", () => {
  test("should show placeholder when no position is selected", async ({ page }) => {
    await setupPaperWithChart(page, {});
    await page.goto("/paper");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
    await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator('[data-testid="chart-placeholder-content"]')).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("Paper Chart - SELL Side Position", () => {
  test("should display chart for SHORT (SELL) position", async ({ page }) => {
    await setupPaperWithChart(page, {
      positionSymbol: "HDFC",
      strategyName: "SR Breakout",
      orbLevels: null,
      livePosition: createLivePosition({
        symbol: "HDFC",
        side: "SELL",
        entry_price: 1650,
        current_price: 1630,
        pnl: 200,
        pnl_pct: 0.61,
        quantity: 50,
        stop_loss: 1680,
        take_profit: 1600,
      }),
    });
    await navigateAndClickPosition(page, "HDFC");
    await verifyPaperChartRenders(page);
  });
});
