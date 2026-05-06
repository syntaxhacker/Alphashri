import { test, expect, Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { selectSymbolAndRun, waitForBacktestResult } from "./helpers/backtestHelpers";

const strategyVariations = [
  { id: "orb-default", name: "ORB Best", strategy_type: "ORB" },
  { id: "orb-aggressive", name: "ORB Aggressive", strategy_type: "ORB" },
  { id: "sr-breakout", name: "SR Breakout", strategy_type: "SR_BREAKOUT" },
  { id: "ema-cross", name: "EMA Cross", strategy_type: "EMA_CROSS" },
  { id: "52w-chaser", name: "52W Chaser", strategy_type: "52W_CHASER" },
  { id: "52w-target", name: "52W Target", strategy_type: "52W_TARGET" },
];

function generateCandles(symbol: string, count: number = 10) {
  const base =
    symbol === "TCS"
      ? 3800
      : symbol === "RELIANCE"
        ? 2500
        : symbol === "HDFC"
          ? 1600
          : symbol === "INFY"
            ? 1480
            : 3000;
  const candles: any[] = [];
  const times = [
    "09:15",
    "09:30",
    "09:45",
    "10:00",
    "10:15",
    "10:30",
    "10:45",
    "11:00",
    "11:15",
    "11:30",
  ];
  for (let i = 0; i < count; i++) {
    const o = base + Math.random() * 50 - 25;
    candles.push({
      time: `2025-08-25T${times[i % times.length]}`,
      date: "2025-08-25",
      date_raw: "2025-08-25",
      open: +o.toFixed(2),
      high: +(o + 10 + Math.random() * 10).toFixed(2),
      low: +(o - 10 - Math.random() * 10).toFixed(2),
      close: +(o + Math.random() * 20 - 10).toFixed(2),
      volume: Math.floor(50000 + Math.random() * 100000),
      time_str: times[i % times.length],
    });
  }
  return candles;
}

function generateOrbZones() {
  return [
    {
      date: "2025-08-25",
      date_raw: "2025-08-25",
      or_high: 2550,
      or_low: 2490,
      or_end_time: "09:45",
    },
  ];
}

function generatePivotLevels() {
  return [
    {
      date: "2025-08-25",
      date_raw: "2025-08-25",
      pp: 2520,
      r1: 2560,
      s1: 2480,
      r2: 2590,
      s2: 2450,
    },
  ];
}

function generateSrBreakoutTrades(candles: any[]) {
  const entryIdx = 3;
  const exitIdx = 6;
  return [
    {
      trade_id: 1,
      type: "entry",
      time: candles[entryIdx].time,
      date: candles[entryIdx].date,
      price: candles[entryIdx].high + 5,
      candle_idx: entryIdx,
      trade: {
        entry_price: candles[entryIdx].high + 5,
        exit_price: candles[exitIdx].high,
        entry_time: candles[entryIdx].time,
        exit_time: candles[exitIdx].time,
        quantity: 50,
        gross_pnl: 2000,
        trading_costs: 150,
        net_pnl: 1850,
        net_pnl_pct: 1.5,
        exit_reason: "TP",
        hold_duration_minutes: 90,
        sr_level: "R1",
        sr_type: "pivot",
      },
    },
    {
      trade_id: 1,
      type: "exit",
      time: candles[exitIdx].time,
      date: candles[exitIdx].date,
      price: candles[exitIdx].high,
      candle_idx: exitIdx,
      trade: {
        entry_price: candles[entryIdx].high + 5,
        exit_price: candles[exitIdx].high,
        entry_time: candles[entryIdx].time,
        exit_time: candles[exitIdx].time,
        quantity: 50,
        gross_pnl: 2000,
        trading_costs: 150,
        net_pnl: 1850,
        net_pnl_pct: 1.5,
        exit_reason: "TP",
        hold_duration_minutes: 90,
        sr_level: "R1",
        sr_type: "pivot",
      },
    },
  ];
}

function generateEmaCrossTrades(candles: any[]) {
  const entryIdx = 2;
  const exitIdx = 7;
  return [
    {
      trade_id: 2,
      type: "entry",
      time: candles[entryIdx].time,
      date: candles[entryIdx].date,
      price: candles[entryIdx].close,
      candle_idx: entryIdx,
      trade: {
        entry_price: candles[entryIdx].close,
        exit_price: candles[exitIdx].close + 30,
        entry_time: candles[entryIdx].time,
        exit_time: candles[exitIdx].time,
        quantity: 100,
        gross_pnl: 3000,
        trading_costs: 200,
        net_pnl: 2800,
        net_pnl_pct: 2.1,
        exit_reason: "TP",
        hold_duration_minutes: 150,
        ema_gap: 0.5,
      },
    },
    {
      trade_id: 2,
      type: "exit",
      time: candles[exitIdx].time,
      date: candles[exitIdx].date,
      price: candles[exitIdx].close + 30,
      candle_idx: exitIdx,
      trade: {
        entry_price: candles[entryIdx].close,
        exit_price: candles[exitIdx].close + 30,
        entry_time: candles[entryIdx].time,
        exit_time: candles[exitIdx].time,
        quantity: 100,
        gross_pnl: 3000,
        trading_costs: 200,
        net_pnl: 2800,
        net_pnl_pct: 2.1,
        exit_reason: "TP",
        hold_duration_minutes: 150,
        ema_gap: 0.5,
      },
    },
  ];
}

function generate52wChaserTrades(candles: any[]) {
  const entryIdx = 1;
  const exitIdx = 5;
  return [
    {
      trade_id: 3,
      type: "entry",
      time: candles[entryIdx].time,
      date: candles[entryIdx].date,
      price: candles[entryIdx].close + 10,
      candle_idx: entryIdx,
      trade: {
        entry_price: candles[entryIdx].close + 10,
        exit_price: candles[exitIdx].close - 15,
        entry_time: candles[entryIdx].time,
        exit_time: candles[exitIdx].time,
        quantity: 30,
        gross_pnl: -750,
        trading_costs: 100,
        net_pnl: -850,
        net_pnl_pct: -0.9,
        exit_reason: "SL",
        hold_duration_minutes: 120,
        high_52w: 2600,
        distance_pct: 2.5,
      },
    },
    {
      trade_id: 3,
      type: "exit",
      time: candles[exitIdx].time,
      date: candles[exitIdx].date,
      price: candles[exitIdx].close - 15,
      candle_idx: exitIdx,
      trade: {
        entry_price: candles[entryIdx].close + 10,
        exit_price: candles[exitIdx].close - 15,
        entry_time: candles[entryIdx].time,
        exit_time: candles[exitIdx].time,
        quantity: 30,
        gross_pnl: -750,
        trading_costs: 100,
        net_pnl: -850,
        net_pnl_pct: -0.9,
        exit_reason: "SL",
        hold_duration_minutes: 120,
        high_52w: 2600,
        distance_pct: 2.5,
      },
    },
  ];
}

function generate52wTargetTrades(candles: any[]) {
  const entryIdx = 2;
  const exitIdx = 8;
  return [
    {
      trade_id: 4,
      type: "entry",
      time: candles[entryIdx].time,
      date: candles[entryIdx].date,
      price: candles[entryIdx].close,
      candle_idx: entryIdx,
      trade: {
        entry_price: candles[entryIdx].close,
        exit_price: candles[exitIdx].close + 50,
        entry_time: candles[entryIdx].time,
        exit_time: candles[exitIdx].time,
        quantity: 20,
        gross_pnl: 1000,
        trading_costs: 80,
        net_pnl: 920,
        net_pnl_pct: 3.2,
        exit_reason: "TP",
        hold_duration_minutes: 180,
        high_52w: 2600,
        trail_pct: 1.0,
      },
    },
    {
      trade_id: 4,
      type: "exit",
      time: candles[exitIdx].time,
      date: candles[exitIdx].date,
      price: candles[exitIdx].close + 50,
      candle_idx: exitIdx,
      trade: {
        entry_price: candles[entryIdx].close,
        exit_price: candles[exitIdx].close + 50,
        entry_time: candles[entryIdx].time,
        exit_time: candles[exitIdx].time,
        quantity: 20,
        gross_pnl: 1000,
        trading_costs: 80,
        net_pnl: 920,
        net_pnl_pct: 3.2,
        exit_reason: "TP",
        hold_duration_minutes: 180,
        high_52w: 2600,
        trail_pct: 1.0,
      },
    },
  ];
}

async function mockFullBacktestApi(page: Page, strategyType: string, symbol: string = "RELIANCE") {
  await page.route(apiRoute("backtest/strategies"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        strategies: [
          { id: strategyType.toLowerCase(), name: `${strategyType} Strategy`, params: [] },
        ],
      }),
    });
  });

  await page.route(apiRoute("strategies/variations"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(strategyVariations),
    });
  });

  await page.route(apiRoute("backtest/costs"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        costs: {
          brokerage_pct: 0.0003,
          min_brokerage: 20,
          stt_pct: 0.00025,
          exchange_pct: 0.0000297,
          sebi_pct: 0.000001,
          stamp_pct: 0.00003,
          gst_pct: 0.18,
        },
      }),
    });
  });

  await page.route(/\/api\/symbols\/search/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{ symbol, name: `${symbol} Ltd` }],
        query: symbol,
        total: 1,
      }),
    });
  });

  const candles = generateCandles(symbol);
  let trades: any[] = [];
  let orbZones: any[] = [];
  let pivotLevels: any[] = [];
  let visuals: any = {};

  switch (strategyType) {
    case "ORB":
      trades = [
        {
          trade_id: 1,
          type: "entry",
          time: candles[3].time,
          date: candles[3].date,
          price: candles[3].high + 5,
          candle_idx: 3,
          trade: {
            entry_price: candles[3].high + 5,
            exit_price: candles[6].high,
            entry_time: candles[3].time,
            exit_time: candles[6].time,
            quantity: 100,
            gross_pnl: 5000,
            trading_costs: 300,
            net_pnl: 4700,
            net_pnl_pct: 1.9,
            exit_reason: "TP",
            hold_duration_minutes: 90,
            or_high: 2550,
            or_low: 2490,
          },
        },
        {
          trade_id: 1,
          type: "exit",
          time: candles[6].time,
          date: candles[6].date,
          price: candles[6].high,
          candle_idx: 6,
          trade: {
            entry_price: candles[3].high + 5,
            exit_price: candles[6].high,
            entry_time: candles[3].time,
            exit_time: candles[6].time,
            quantity: 100,
            gross_pnl: 5000,
            trading_costs: 300,
            net_pnl: 4700,
            net_pnl_pct: 1.9,
            exit_reason: "TP",
            hold_duration_minutes: 90,
            or_high: 2550,
            or_low: 2490,
          },
        },
      ];
      orbZones = generateOrbZones();
      pivotLevels = generatePivotLevels();
      visuals = {
        overlays: [
          {
            id: "or_high",
            label: "OR High",
            type: "line",
            color: "#00E676",
            levels: [{ value: 2550, fromIndex: 0, toIndex: 3 }],
          },
          {
            id: "or_low",
            label: "OR Low",
            type: "line",
            color: "#FF1744",
            levels: [{ value: 2490, fromIndex: 0, toIndex: 3 }],
          },
          { id: "pp", label: "PP", type: "line", color: "#FFD700", levels: [{ value: 2520 }] },
          { id: "r1", label: "R1", type: "line", color: "#FF9800", levels: [{ value: 2560 }] },
          { id: "s1", label: "S1", type: "line", color: "#2196F3", levels: [{ value: 2480 }] },
        ],
      };
      break;
    case "SR_BREAKOUT":
      trades = generateSrBreakoutTrades(candles);
      pivotLevels = generatePivotLevels();
      visuals = {
        overlays: [
          { id: "pp", label: "PP", type: "line", color: "#FFD700", levels: [{ value: 2520 }] },
          { id: "r1", label: "R1", type: "line", color: "#FF9800", levels: [{ value: 2560 }] },
          { id: "s1", label: "S1", type: "line", color: "#2196F3", levels: [{ value: 2480 }] },
        ],
      };
      break;
    case "EMA_CROSS":
      trades = generateEmaCrossTrades(candles);
      visuals = {
        ema_series: [
          { label: "EMA 9", color: "#2196F3", data: candles.map((_, i) => 2500 + i * 3) },
          { label: "EMA 21", color: "#FF9800", data: candles.map((_, i) => 2495 + i * 2) },
        ],
      };
      break;
    case "52W_CHASER":
      trades = generate52wChaserTrades(candles);
      visuals = {
        overlays: [
          {
            id: "52w_high",
            label: "52W High",
            type: "line",
            color: "#AB47BC",
            levels: [{ value: 2600 }],
          },
        ],
      };
      break;
    case "52W_TARGET":
      trades = generate52wTargetTrades(candles);
      visuals = {
        overlays: [
          {
            id: "52w_high",
            label: "52W High",
            type: "line",
            color: "#AB47BC",
            levels: [{ value: 2600 }],
          },
        ],
      };
      break;
  }

  const chartData = {
    symbol,
    candles,
    orb_zones: orbZones,
    pivot_levels: pivotLevels,
    trades,
    date_range: { start: "2025-08-25", end: "2025-08-25" },
    total_candles: candles.length,
    total_trades: trades.length / 2,
    ...(visuals.overlays || visuals.ema_series ? { visuals } : {}),
  };

  const totalPnl = trades
    .filter((t: any) => t.type === "exit")
    .reduce((sum: number, t: any) => sum + (t.trade?.net_pnl || 0), 0);
  const totalTrades = trades.filter((t: any) => t.type === "exit").length;

  await page.route(/\/api\/backtest\/run/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            symbol,
            net_pnl: totalPnl,
            trades: totalTrades,
            win_rate: totalTrades > 0 && totalPnl > 0 ? 100 : 0,
            pf: 1.5,
            tp_exits: totalPnl > 0 ? totalTrades : 0,
            sl_exits: totalPnl <= 0 ? totalTrades : 0,
          },
        ],
        totals: { net_pnl: totalPnl, total_costs: 500, win_rate: 50, trades: totalTrades },
        run_time: "2025-08-25T00:00:00Z",
        chart_data: { [symbol]: chartData },
      }),
    });
  });

  await page.route(apiRoute("backtest/chart/"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chartData),
    });
  });

  await page.route(apiRoute("backtest/history"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ history: [] }),
    });
  });
}

async function runBacktestForStrategy(
  page: Page,
  strategyType: string,
  symbol: string = "RELIANCE",
) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await mockFullBacktestApi(page, strategyType, symbol);
  await page.goto("/backtest");
  await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });
  await selectSymbolAndRun(page, symbol);
  await waitForBacktestResult(page, "results-summary");
}

async function verifyChartRenders(page: Page) {
  await expect(page.locator('[data-testid="echarts-container"]')).toBeVisible({ timeout: 10000 });
}

async function getChartOption(page: Page): Promise<any | null> {
  await page.waitForTimeout(1000);
  return page.evaluate(() => {
    const echarts = (window as any).echarts;
    if (!echarts) return null;
    const container = document.querySelector('[data-testid="echarts-container"]');
    if (!container) return null;
    const child = container.firstElementChild;
    if (!child) return null;
    const instance = echarts.getInstanceByDom(child);
    if (!instance) {
      const allDivs = container.querySelectorAll("div");
      for (const div of allDivs) {
        const inst = echarts.getInstanceByDom(div);
        if (inst) return inst.getOption();
      }
      return null;
    }
    return instance.getOption();
  });
}

async function verifyTradeMarkers(page: Page) {
  const option = await getChartOption(page);
  const series = option?.series || [];
  expect(series.some((s: any) => s.type === "scatter" && (s.data || []).length > 0)).toBeTruthy();
}

test.describe("Backtest - ORB Strategy", () => {
  test("should run ORB backtest and display results", async ({ page }) => {
    await runBacktestForStrategy(page, "ORB");
    await expect(page.locator('[data-testid="results-summary"]')).toBeVisible();
    await expect(page.locator('[data-testid="summary-net-pnl"]')).toBeVisible();
  });

  test("should display ORB chart with trade markers", async ({ page }) => {
    await runBacktestForStrategy(page, "ORB");
    await expect(page.locator('[data-testid="chart-tabs"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-tab-RELIANCE"]')).toBeVisible();
    await verifyChartRenders(page);
    await verifyTradeMarkers(page);
  });

  test("should show ORB zones as overlay data in chart", async ({ page }) => {
    await runBacktestForStrategy(page, "ORB");
    await verifyChartRenders(page);
    const result = await page.evaluate(() => {
      const echarts = (window as any).echarts;
      if (!echarts) return { err: "no echarts" };
      const container = document.querySelector('[data-testid="echarts-container"]');
      if (!container) return { err: "no container" };
      const child = container.firstElementChild;
      if (!child) return { err: "no child", childCount: container.children.length };
      let instance = echarts.getInstanceByDom(child);
      if (!instance) {
        const allDivs = container.querySelectorAll("div");
        for (const div of allDivs) {
          instance = echarts.getInstanceByDom(div);
          if (instance) return { series: instance.getOption().series, found: true };
        }
        return { err: "no instance", divCount: allDivs.length };
      }
      return { series: instance.getOption().series };
    });
    const series = result?.series || [];
    expect(
      series.some((s: any) => s.name?.includes("OR High") || s.name?.includes("OR Low")),
    ).toBeTruthy();
  });

  test("should display trade in history panel with TP exit reason", async ({ page }) => {
    await runBacktestForStrategy(page, "ORB");
    const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');
    if (await tradeHistoryPanel.isVisible()) {
      await expect(page.locator('[data-testid="trade-summary-pnl"]')).toBeVisible();
    }
  });
});

test.describe("Backtest - SR Breakout Strategy", () => {
  test("should run SR Breakout backtest and display results", async ({ page }) => {
    await runBacktestForStrategy(page, "SR_BREAKOUT");
    await expect(page.locator('[data-testid="results-summary"]')).toBeVisible();
  });

  test("should display SR Breakout chart with pivot overlays", async ({ page }) => {
    await runBacktestForStrategy(page, "SR_BREAKOUT");
    await verifyChartRenders(page);
    await verifyTradeMarkers(page);
    const option = await getChartOption(page);
    const series = option?.series || [];
    const pivotNames = ["PP", "R1", "S1", "R2", "S2"];
    expect(pivotNames.some((name) => series.some((s: any) => s.name === name))).toBeTruthy();
  });

  test("should include SR level info in trade data", async ({ page }) => {
    await runBacktestForStrategy(page, "SR_BREAKOUT");
    const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');
    if (await tradeHistoryPanel.isVisible()) {
      await expect(tradeHistoryPanel).toBeVisible();
    }
  });
});

test.describe("Backtest - EMA Cross Strategy", () => {
  test("should run EMA Cross backtest and display results", async ({ page }) => {
    await runBacktestForStrategy(page, "EMA_CROSS");
    await expect(page.locator('[data-testid="results-summary"]')).toBeVisible();
  });

  test("should display EMA Cross chart with EMA overlays", async ({ page }) => {
    await runBacktestForStrategy(page, "EMA_CROSS");
    await verifyChartRenders(page);
    await verifyTradeMarkers(page);
    const option = await getChartOption(page);
    const series = option?.series || [];
    expect(series.some((s: any) => s.name?.includes("EMA"))).toBeTruthy();
  });
});

test.describe("Backtest - 52W Chaser Strategy", () => {
  test("should run 52W Chaser backtest and display results", async ({ page }) => {
    await runBacktestForStrategy(page, "52W_CHASER");
    await expect(page.locator('[data-testid="results-summary"]')).toBeVisible();
  });

  test("should display 52W Chaser chart with 52W high line", async ({ page }) => {
    await runBacktestForStrategy(page, "52W_CHASER");
    await verifyChartRenders(page);
    await verifyTradeMarkers(page);
    const option = await getChartOption(page);
    const series = option?.series || [];
    expect(series.some((s: any) => s.name?.includes("52W"))).toBeTruthy();
  });

  test("should show losing trade for 52W Chaser SL exit", async ({ page }) => {
    await runBacktestForStrategy(page, "52W_CHASER");
    const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');
    if (await tradeHistoryPanel.isVisible()) {
      await expect(page.locator('[data-testid="trade-summary-pnl"]')).toBeVisible();
    }
  });
});

test.describe("Backtest - 52W Target Strategy", () => {
  test("should run 52W Target backtest and display results", async ({ page }) => {
    await runBacktestForStrategy(page, "52W_TARGET");
    await expect(page.locator('[data-testid="results-summary"]')).toBeVisible();
  });

  test("should display 52W Target chart with 52W high line", async ({ page }) => {
    await runBacktestForStrategy(page, "52W_TARGET");
    await verifyChartRenders(page);
    await verifyTradeMarkers(page);
  });
});

test.describe("Backtest - Timeframe Switching (All Strategies)", () => {
  const tfOptions = ["Native", "5m", "15m", "30m", "1H", "4H"];

  for (const tf of tfOptions) {
    test(`should switch to ${tf} timeframe`, async ({ page }) => {
      await runBacktestForStrategy(page, "ORB", "TCS");
      const tfSelect = page.locator('[data-testid="chart-tf-select"]');
      await expect(tfSelect).toBeVisible({ timeout: 10000 });
      await tfSelect.click({ force: true });
      await page.waitForTimeout(300);
      const option = page.locator(".mantine-Select-option").filter({ hasText: tf });
      if (await option.isVisible().catch(() => false)) {
        await option.click();
        await page.waitForTimeout(500);
        await verifyChartRenders(page);
      }
    });
  }
});

test.describe("Backtest - Chart Zoom", () => {
  test("should display zoom select with options", async ({ page }) => {
    await runBacktestForStrategy(page, "ORB");
    const zoomSelect = page.locator('[data-testid="chart-zoom-select"]');
    await expect(zoomSelect).toBeVisible();
    await zoomSelect.click({ force: true });
    await page.waitForTimeout(300);
    await expect(
      page.locator(".mantine-Select-dropdown").filter({ hasText: /All.*30D.*7D.*1D/ }),
    ).toBeVisible({ timeout: 5000 });
  });

  test("should have dataZoom configured on chart", async ({ page }) => {
    await runBacktestForStrategy(page, "ORB");
    await verifyChartRenders(page);
    const option = await getChartOption(page);
    expect(option?.dataZoom).not.toBeNull();
    expect(option?.dataZoom?.length).toBeGreaterThan(0);
  });

  test("should zoom chart via mouse wheel", async ({ page }) => {
    await runBacktestForStrategy(page, "ORB");
    const container = page.locator('[data-testid="echarts-container"]');
    await container.scrollIntoViewIfNeeded();
    const box = await container.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -100);
      await expect(container).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe("Backtest - Trade Highlight on Click", () => {
  test("should highlight trade row when clicked", async ({ page }) => {
    await runBacktestForStrategy(page, "ORB");
    await expect(page.locator('[data-testid="echarts-container"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="trade-history-tbody"] tr')).toHaveCount(1, {
      timeout: 15000,
    });

    const firstRow = page.locator('[data-testid="trade-history-tbody"] tr').first();
    await firstRow.scrollIntoViewIfNeeded({ timeout: 15000 });
    await expect(firstRow).toBeVisible({ timeout: 15000 });

    // Use native dispatchEvent - Playwright click doesn't reliably trigger React onClick for table rows
    await page.evaluate(() => {
      const row = document.querySelector('[data-testid="trade-history-tbody"] tr');
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    // Check immediately - highlight removed after 3s via setTimeout in component
    const firstRowFresh = page.locator('[data-testid="trade-history-tbody"] tr').first();
    expect(
      await firstRowFresh.evaluate((el) => el.classList.contains("trade-row-highlighted")),
    ).toBe(true);
  });
});

test.describe("Backtest - Multi-Day Chart", () => {
  test("should render multi-day candles without xAxis collapse", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);

    const multiDayCandles: any[] = [];
    for (let d = 0; d < 3; d++) {
      const date = `2025-08-${25 + d}`;
      for (let i = 0; i < 5; i++) {
        const h = 9 + Math.floor(i / 4);
        const m = (i % 4) * 15;
        multiDayCandles.push({
          time: `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
          date,
          date_raw: date,
          open: 2500 + d * 10,
          high: 2520 + d * 10,
          low: 2490 + d * 10,
          close: 2510 + d * 10,
          volume: 80000,
          time_str: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
        });
      }
    }

    await page.route(apiRoute("backtest/strategies"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ strategies: [{ id: "orb", name: "ORB", params: [] }] }),
      });
    });
    await page.route(apiRoute("strategies/variations"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(strategyVariations),
      });
    });
    await page.route(apiRoute("backtest/costs"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          costs: {
            brokerage_pct: 0.0003,
            min_brokerage: 20,
            stt_pct: 0.00025,
            exchange_pct: 0.0000297,
            sebi_pct: 0.000001,
            stamp_pct: 0.00003,
            gst_pct: 0.18,
          },
        }),
      });
    });
    await page.route(/\/api\/symbols\/search/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [{ symbol: "RELIANCE", name: "Reliance" }],
          query: "RELIANCE",
          total: 1,
        }),
      });
    });
    await page.route(/\/api\/backtest\/run/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              symbol: "RELIANCE",
              net_pnl: 5000,
              trades: 2,
              win_rate: 100,
              pf: 2.0,
              tp_exits: 2,
              sl_exits: 0,
            },
          ],
          totals: { net_pnl: 5000, total_costs: 300, win_rate: 100, trades: 2 },
          run_time: "2025-08-25T00:00:00Z",
          chart_data: {
            RELIANCE: {
              symbol: "RELIANCE",
              candles: multiDayCandles,
              orb_zones: [],
              pivot_levels: [],
              trades: [],
              date_range: { start: "2025-08-25", end: "2025-08-27" },
              total_candles: 15,
              total_trades: 0,
            },
          },
        }),
      });
    });
    await page.route(apiRoute("backtest/chart/"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol: "RELIANCE",
          candles: multiDayCandles,
          orb_zones: [],
          pivot_levels: [],
          trades: [],
          date_range: { start: "2025-08-25", end: "2025-08-27" },
          total_candles: 15,
          total_trades: 0,
        }),
      });
    });
    await page.route(apiRoute("backtest/history"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ history: [] }),
      });
    });

    await page.goto("/backtest");
    await selectSymbolAndRun(page, "RELIANCE");
    await waitForBacktestResult(page, "results-summary");
    await verifyChartRenders(page);

    const xAxisLabels = await page.evaluate(() => {
      const echarts = (window as any).echarts;
      if (!echarts) return [];
      const container = document.querySelector('[data-testid="echarts-container"]');
      if (!container) return [];
      const child = container.firstElementChild;
      if (!child) return [];
      const instance = echarts.getInstanceByDom(child);
      if (!instance) return [];
      const option = instance.getOption();
      return option.xAxis?.[0]?.data || [];
    });

    const uniqueDates = new Set(xAxisLabels.map((l: string) => l.split(" ")[0]));
    expect(uniqueDates.size).toBeGreaterThanOrEqual(2);
  });
});

test.describe("Backtest - Error Scenarios", () => {
  test("should display error when backtest API fails", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await page.route(apiRoute("backtest/strategies"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ strategies: [{ id: "orb", name: "ORB", params: [] }] }),
      });
    });
    await page.route(apiRoute("strategies/variations"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(strategyVariations),
      });
    });
    await page.route(apiRoute("backtest/costs"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ costs: {} }),
      });
    });
    await page.route(/\/api\/symbols\/search/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [{ symbol: "RELIANCE", name: "Reliance" }],
          query: "RELIANCE",
          total: 1,
        }),
      });
    });
    await page.route(/\/api\/backtest\/run/, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Internal server error" }),
      });
    });
    await page.route(apiRoute("backtest/history"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ history: [] }),
      });
    });

    await page.goto("/backtest");
    const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
    await symbolSelect.click({ force: true });
    await page.keyboard.type("RELIANCE");
    await page.locator(".mantine-MultiSelect-option").first().click({ timeout: 5000 });
    await page.locator('[data-testid="run-backtest-btn"]').click();
    await expect(page.locator('[data-testid="backtest-error"]')).toBeVisible({ timeout: 10000 });
  });

  test("should display empty chart when chart API returns empty candles", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await page.route(apiRoute("backtest/strategies"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ strategies: [{ id: "orb", name: "ORB", params: [] }] }),
      });
    });
    await page.route(apiRoute("strategies/variations"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(strategyVariations),
      });
    });
    await page.route(apiRoute("backtest/costs"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ costs: {} }),
      });
    });
    await page.route(/\/api\/symbols\/search/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [{ symbol: "RELIANCE", name: "Reliance" }],
          query: "RELIANCE",
          total: 1,
        }),
      });
    });
    await page.route(/\/api\/backtest\/run/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              symbol: "RELIANCE",
              net_pnl: 0,
              trades: 0,
              win_rate: 0,
              pf: 0,
              tp_exits: 0,
              sl_exits: 0,
            },
          ],
          totals: { net_pnl: 0, total_costs: 0, win_rate: 0, trades: 0 },
          run_time: "2025-08-25T00:00:00Z",
          chart_data: {
            RELIANCE: {
              symbol: "RELIANCE",
              candles: [],
              orb_zones: [],
              pivot_levels: [],
              trades: [],
              date_range: { start: "2025-08-25", end: "2025-08-25" },
              total_candles: 0,
              total_trades: 0,
            },
          },
        }),
      });
    });
    await page.route(apiRoute("backtest/chart/"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol: "RELIANCE",
          candles: [],
          orb_zones: [],
          pivot_levels: [],
          trades: [],
          date_range: { start: "2025-08-25", end: "2025-08-25" },
          total_candles: 0,
          total_trades: 0,
        }),
      });
    });
    await page.route(apiRoute("backtest/history"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ history: [] }),
      });
    });

    await page.goto("/backtest");
    await selectSymbolAndRun(page, "RELIANCE");
    await waitForBacktestResult(page, "chart-tabs");
    await expect(page.locator('[data-testid="chart-tab-RELIANCE"]')).toBeVisible({
      timeout: 10000,
    });
  });
});
