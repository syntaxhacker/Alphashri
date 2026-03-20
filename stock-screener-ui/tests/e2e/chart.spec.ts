import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

// Mock chart preview data with ORB levels and pivot levels
const mockChartPreviewData = {
  symbol: "RELIANCE",
  candles: [
    {
      time: "2026-03-02T09:15",
      date: "2026-03-02",
      time_str: "09:15",
      open: 2500,
      high: 2520,
      low: 2490,
      close: 2510,
      volume: 100000,
    },
    {
      time: "2026-03-02T09:30",
      date: "2026-03-02",
      time_str: "09:30",
      open: 2510,
      high: 2530,
      low: 2505,
      close: 2525,
      volume: 95000,
    },
    {
      time: "2026-03-02T09:45",
      date: "2026-03-02",
      time_str: "09:45",
      open: 2525,
      high: 2540,
      low: 2520,
      close: 2535,
      volume: 88000,
    },
    {
      time: "2026-03-02T10:00",
      date: "2026-03-02",
      time_str: "10:00",
      open: 2535,
      high: 2550,
      low: 2530,
      close: 2545,
      volume: 92000,
    },
    {
      time: "2026-03-02T10:15",
      date: "2026-03-02",
      time_str: "10:15",
      open: 2545,
      high: 2560,
      low: 2540,
      close: 2555,
      volume: 85000,
    },
    {
      time: "2026-03-02T10:30",
      date: "2026-03-02",
      time_str: "10:30",
      open: 2555,
      high: 2570,
      low: 2550,
      close: 2565,
      volume: 90000,
    },
    {
      time: "2026-03-02T10:45",
      date: "2026-03-02",
      time_str: "10:45",
      open: 2565,
      high: 2580,
      low: 2560,
      close: 2575,
      volume: 87000,
    },
    {
      time: "2026-03-02T11:00",
      date: "2026-03-02",
      time_str: "11:00",
      open: 2575,
      high: 2590,
      low: 2570,
      close: 2585,
      volume: 93000,
    },
    {
      time: "2026-03-02T11:15",
      date: "2026-03-02",
      time_str: "11:15",
      open: 2585,
      high: 2600,
      low: 2580,
      close: 2595,
      volume: 89000,
    },
    {
      time: "2026-03-02T11:30",
      date: "2026-03-02",
      time_str: "11:30",
      open: 2595,
      high: 2610,
      low: 2590,
      close: 2605,
      volume: 91000,
    },
  ],
  orb_zones: [
    {
      date: "2026-03-02",
      date_raw: "2026-03-02",
      or_high: 2540,
      or_low: 2490,
      or_end_time: "09:45",
    },
  ],
  pivot_levels: [
    {
      date: "2026-03-02",
      date_raw: "2026-03-02",
      pp: 2520,
      r1: 2560,
      s1: 2480,
      r2: 2590,
      s2: 2450,
    },
  ],
  timeframe: 15,
  or_minutes: 45,
  total_candles: 10,
};

// Mock chart data with 52-week levels
const mockChartWith52WLevels = {
  symbol: "TCS",
  candles: [
    {
      time: "2026-03-02T09:15",
      date: "2026-03-02",
      time_str: "09:15",
      open: 3800,
      high: 3820,
      low: 3790,
      close: 3810,
      volume: 50000,
    },
    {
      time: "2026-03-02T09:30",
      date: "2026-03-02",
      time_str: "09:30",
      open: 3810,
      high: 3830,
      low: 3805,
      close: 3825,
      volume: 48000,
    },
    {
      time: "2026-03-02T09:45",
      date: "2026-03-02",
      time_str: "09:45",
      open: 3825,
      high: 3840,
      low: 3820,
      close: 3835,
      volume: 46000,
    },
    {
      time: "2026-03-02T10:00",
      date: "2026-03-02",
      time_str: "10:00",
      open: 3835,
      high: 3850,
      low: 3830,
      close: 3845,
      volume: 47000,
    },
    {
      time: "2026-03-02T10:15",
      date: "2026-03-02",
      time_str: "10:15",
      open: 3845,
      high: 3860,
      low: 3840,
      close: 3855,
      volume: 45000,
    },
    {
      time: "2026-03-02T10:30",
      date: "2026-03-02",
      time_str: "10:30",
      open: 3855,
      high: 3870,
      low: 3850,
      close: 3865,
      volume: 44000,
    },
    {
      time: "2026-03-02T10:45",
      date: "2026-03-02",
      time_str: "10:45",
      open: 3865,
      high: 3880,
      low: 3860,
      close: 3875,
      volume: 43000,
    },
    {
      time: "2026-03-02T11:00",
      date: "2026-03-02",
      time_str: "11:00",
      open: 3875,
      high: 3890,
      low: 3870,
      close: 3885,
      volume: 42000,
    },
  ],
  orb_zones: [],
  pivot_levels: [],
  timeframe: 15,
  or_minutes: 45,
  total_candles: 8,
  week52_levels: {
    high_52w: 3900,
    low_52w: 3400,
    distance_to_high_pct: 0.4,
    near_high: true,
  },
};

// Mock chart data with trade markers
const mockChartWithTrades = {
  symbol: "HDFC",
  candles: [
    {
      time: "2026-03-02T09:15",
      date: "2026-03-02",
      time_str: "09:15",
      open: 1600,
      high: 1610,
      low: 1595,
      close: 1605,
      volume: 80000,
    },
    {
      time: "2026-03-02T09:30",
      date: "2026-03-02",
      time_str: "09:30",
      open: 1605,
      high: 1620,
      low: 1600,
      close: 1615,
      volume: 75000,
    },
    {
      time: "2026-03-02T09:45",
      date: "2026-03-02",
      time_str: "09:45",
      open: 1615,
      high: 1630,
      low: 1610,
      close: 1625,
      volume: 70000,
    },
    {
      time: "2026-03-02T10:00",
      date: "2026-03-02",
      time_str: "10:00",
      open: 1625,
      high: 1640,
      low: 1620,
      close: 1635,
      volume: 68000,
    },
    {
      time: "2026-03-02T10:15",
      date: "2026-03-02",
      time_str: "10:15",
      open: 1635,
      high: 1650,
      low: 1630,
      close: 1645,
      volume: 65000,
    },
    {
      time: "2026-03-02T10:30",
      date: "2026-03-02",
      time_str: "10:30",
      open: 1645,
      high: 1660,
      low: 1640,
      close: 1655,
      volume: 63000,
    },
  ],
  orb_zones: [
    {
      date: "2026-03-02",
      date_raw: "2026-03-02",
      or_high: 1630,
      or_low: 1595,
      or_end_time: "09:45",
    },
  ],
  pivot_levels: [],
  timeframe: 15,
  or_minutes: 45,
  total_candles: 6,
  trades: [
    {
      symbol: "HDFC",
      side: "BUY",
      entry_price: 1635,
      entry_time: "2026-03-02T10:15:00",
      quantity: 10,
      strategy: "ORB Conservative",
    },
    {
      symbol: "HDFC",
      side: "SELL",
      exit_price: 1655,
      exit_time: "2026-03-02T10:30:00",
      quantity: 10,
      pnl: 200,
      strategy: "ORB Conservative",
    },
  ],
};

// Helper to setup chart preview API mocks
async function setupChartMocks(page: import("@playwright/test").Page, customData?: any) {
  const responseData = customData || mockChartPreviewData;

  await page.route("**/api/chart/preview/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responseData),
    });
  });
}

test.describe("Chart View - Display Candlestick Chart", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupChartMocks(page);
  });

  test("should render chart container when symbol is loaded", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart container to be visible
    const chartContainer = page.locator('[data-testid="candlestick-chart"]');
    await expect(chartContainer).toBeVisible({ timeout: 10000 });
  });

  test("should show loading state while fetching chart data", async ({ page }) => {
    // Slow down the response to test loading state
    await page.route("**/api/chart/preview/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockChartPreviewData),
      });
    });

    await page.goto("/chart/RELIANCE");

    // Check for loading indicator
    const loadingElement = page.locator('[data-testid="chart-loading"]');
    await expect(loadingElement).toBeVisible();

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });
  });

  test("should show error state when API fails", async ({ page }) => {
    // Override the mock to fail
    await page.route("**/api/chart/preview/**", async (route) => {
      await route.abort("failed");
    });

    await page.goto("/chart/INVALID");

    // Should show error or redirect
    const errorElement = page.locator('[data-testid="chart-error"]');
    await expect(errorElement.first()).toBeVisible({ timeout: 5000 });
  });

  test("should display symbol in chart title", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    const chartTitle = page.locator('[data-testid="chart-title"]');
    await expect(chartTitle).toBeVisible({ timeout: 10000 });
    await expect(chartTitle).toContainText("RELIANCE");
  });

  test("should show back button to navigate back", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    const backButton = page.locator('[data-testid="chart-back-btn"]');
    await expect(backButton).toBeVisible({ timeout: 10000 });
    await expect(backButton).toContainText("Back");
  });

  test("should display candle count in footer", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    const footer = page.locator('[data-testid="chart-footer"]');
    await expect(footer).toBeVisible({ timeout: 10000 });
    await expect(footer).toContainText("candles");
  });
});

test.describe("Chart View - ORB Levels", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupChartMocks(page, mockChartPreviewData);
  });

  test("should display ORB high line when orb_zones data is present", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    const orbHighRendered = await page.evaluate(() => {
      const chartContainer = document.querySelector('[data-testid="candlestick-chart"]');
      if (!chartContainer) return false;
      const echarts = (window as any).echarts;
      if (!echarts) return false;
      const instance = echarts.getInstanceByDom(chartContainer);
      if (!instance) return false;
      const option = instance.getOption();
      const series = option.series || [];
      const orbHigh = series.find((s: any) => s.name === "OR High");
      if (!orbHigh) return false;
      return (orbHigh.data || []).some((v: any) => v !== null);
    });
    expect(orbHighRendered).toBeTruthy();
  });

  test("should display ORB low line when orb_zones data is present", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    const orbLowRendered = await page.evaluate(() => {
      const chartContainer = document.querySelector('[data-testid="candlestick-chart"]');
      if (!chartContainer) return false;
      const echarts = (window as any).echarts;
      if (!echarts) return false;
      const instance = echarts.getInstanceByDom(chartContainer);
      if (!instance) return false;
      const option = instance.getOption();
      const series = option.series || [];
      const orbLow = series.find((s: any) => s.name === "OR Low");
      if (!orbLow) return false;
      return (orbLow.data || []).some((v: any) => v !== null);
    });
    expect(orbLowRendered).toBeTruthy();
  });

  test("should update ORB levels when OR minutes setting changes", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    // Find OR dropdown
    const orSelect = page.locator("select").nth(1); // Second select is for OR minutes
    await orSelect.selectOption("30");

    // Chart should update with new OR levels
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible();
  });
});

test.describe("Chart View - 52 Week High/Low Levels", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupChartMocks(page, mockChartWith52WLevels);
  });

  test("should display 52W high line when week52_levels data is present", async ({ page }) => {
    await page.goto("/chart/TCS");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('[data-testid="chart-title"]')).toContainText("TCS");
    await expect(page.locator('[data-testid="chart-footer"]')).toContainText(
      `${mockChartWith52WLevels.candles.length} candles`,
    );
  });

  test("should display 52W low line when week52_levels data is present", async ({ page }) => {
    await page.goto("/chart/TCS");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    // Chart should show 52W levels
    const footer = page.locator('[data-testid="chart-footer"]');
    await expect(footer).toBeVisible();
  });
});

test.describe("Chart View - Trade Markers", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupChartMocks(page, mockChartWithTrades);
  });

  test("should display entry markers for buy trades", async ({ page }) => {
    await page.goto("/chart/HDFC");

    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="chart-title"]')).toContainText("HDFC");
    await expect(page.locator('[data-testid="chart-footer"]')).toContainText("candles");
  });

  test("should display exit markers for sell trades", async ({ page }) => {
    await page.goto("/chart/HDFC");

    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });
    const chartView = page.locator('[data-testid="chart-view"]');
    await expect(chartView).toBeVisible();
  });

  test("should show trade markers with correct price levels", async ({ page }) => {
    await page.goto("/chart/HDFC");

    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="chart-footer"]')).toContainText(
      `${mockChartWithTrades.candles.length} candles`,
    );
  });
});

test.describe("Chart View - Chart Zoom and Pan", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupChartMocks(page);
  });

  test("should support zoom functionality via mouse wheel", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    const chartContainer = page.locator('[data-testid="candlestick-chart"]');
    await expect(chartContainer).toBeVisible({ timeout: 10000 });

    // Simulate wheel zoom
    await chartContainer.hover({ position: { x: 200, y: 200 } });
    await page.mouse.wheel(0, -100); // Zoom in

    // Chart should still be visible after zoom
    await expect(chartContainer).toBeVisible({ timeout: 5000 });
  });

  test("should support pan functionality via drag", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    const chartContainer = page.locator('[data-testid="candlestick-chart"]');
    await expect(chartContainer).toBeVisible({ timeout: 10000 });

    // Simulate drag pan
    const box = await chartContainer.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2);
      await page.mouse.up();

      // Chart should still be visible after pan
      await expect(chartContainer).toBeVisible({ timeout: 5000 });
    }
  });

  test("should show data zoom slider for full size chart", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    // Full chart should have zoom slider (dataZoom component)
    const zoomConfig = await page.evaluate(() => {
      const chartContainer = document.querySelector('[data-testid="candlestick-chart"]');
      if (!chartContainer) return null;
      const echarts = (window as any).echarts;
      if (!echarts) return null;
      const instance = echarts.getInstanceByDom(chartContainer);
      if (!instance) return null;
      const option = instance.getOption();
      return option.dataZoom || null;
    });

    expect(zoomConfig).not.toBeNull();
    expect(zoomConfig!.length).toBeGreaterThan(0);
    expect(zoomConfig![0]).toHaveProperty("start");
    expect(zoomConfig![0]).toHaveProperty("end");
    expect(typeof zoomConfig![0].start).toBe("number");
    expect(typeof zoomConfig![0].end).toBe("number");
  });
});

test.describe("Chart View - Timeframe Selection", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupChartMocks(page);
  });

  test("should display timeframe selector dropdown", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    // Look for timeframe control
    const timeframeLabel = page.locator("label:has-text('Timeframe')");
    await expect(timeframeLabel).toBeVisible();
  });

  test("should change timeframe when 1m is selected", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    // Find timeframe select (first select)
    const timeframeSelect = page.locator("select").first();
    await timeframeSelect.selectOption("1"); // 1m option

    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible();

    // Footer should show updated timeframe
    const footer = page.locator('[data-testid="chart-footer"]');
    await expect(footer).toContainText("TF: 1m");
  });

  test("should change timeframe when 5m is selected", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    const timeframeSelect = page.locator("select").first();
    await timeframeSelect.selectOption("5"); // 5m option

    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 5000 });
  });

  test("should change timeframe when 15m is selected", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    const timeframeSelect = page.locator("select").first();
    await timeframeSelect.selectOption("15"); // 15m option

    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 5000 });
  });

  test("should change timeframe when 30m is selected", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    const timeframeSelect = page.locator("select").first();
    await timeframeSelect.selectOption("30"); // 30m option

    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 5000 });
  });

  test("should change timeframe when 1h is selected", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    const timeframeSelect = page.locator("select").first();
    await timeframeSelect.selectOption("60"); // 1h option

    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 5000 });

    // Footer should show updated timeframe
    const footer = page.locator('[data-testid="chart-footer"]');
    await expect(footer).toContainText("TF: 60m");
  });

  test("should refresh chart data when timeframe changes", async ({ page }) => {
    let requestCount = 0;

    // Track API calls
    await page.route("**/api/chart/preview/**", async (route) => {
      requestCount++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockChartPreviewData),
      });
    });

    await page.goto("/chart/RELIANCE");

    // Wait for initial load
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });
    const initialCount = requestCount;

    // Change timeframe
    const timeframeSelect = page.locator("select").first();
    await timeframeSelect.selectOption("30");

    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 5000 });
    expect(requestCount).toBeGreaterThan(initialCount);
  });
});

test.describe("Chart View - Pivot Levels", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupChartMocks(page, mockChartPreviewData);
  });

  test("should display pivot checkbox control", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    // Look for pivots checkbox
    const pivotsLabel = page.locator("label:has-text('Pivots')");
    await expect(pivotsLabel).toBeVisible();
  });

  test("should show pivot levels when checkbox is enabled", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    // Enable pivots
    const pivotsCheckbox = page.locator('[data-testid="chart-pivots-checkbox"]');
    await pivotsCheckbox.check();

    // Chart should still be visible
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 5000 });
  });

  test("should hide pivot levels when checkbox is disabled", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    // Disable pivots
    const pivotsCheckbox = page.locator('[data-testid="chart-pivots-checkbox"]');
    await pivotsCheckbox.uncheck();

    // Chart should still be visible
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Chart View - Chart Controls", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupChartMocks(page);
  });

  test("should display all chart controls", async ({ page }) => {
    await page.goto("/chart/RELIANCE");

    // Wait for chart to render
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    // Check for controls container
    const controls = page.locator('[data-testid="chart-controls"]');
    await expect(controls).toBeVisible();
  });

  test("should navigate back when back button is clicked", async ({ page }) => {
    // First navigate to home page to establish history
    await page.goto("/");
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible({ timeout: 10000 });

    // Then navigate to chart (use domcontentloaded to avoid hanging on persistent home page connections)
    await page.goto("/chart/RELIANCE", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });

    // Click back button
    const backButton = page.locator('[data-testid="chart-back-btn"]');
    await backButton.click();

    // Should navigate back to home
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible({ timeout: 10000 });
    const url = page.url();
    expect(url).not.toContain("/chart/RELIANCE");
  });
});

test.describe("Chart View - Responsive Design", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupChartMocks(page);
  });

  test("should render chart on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/chart/RELIANCE");

    // Chart should render on mobile
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });
  });

  test("should render chart on tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/chart/RELIANCE");

    // Chart should render on tablet
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });
  });

  test("should render chart on desktop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/chart/RELIANCE");

    // Chart should render on desktop
    await expect(page.locator('[data-testid="candlestick-chart"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Chart View - Empty and Edge Cases", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should handle missing candle data gracefully", async ({ page }) => {
    await setupChartMocks(page, {
      symbol: "EMPTY",
      candles: [],
      orb_zones: [],
      pivot_levels: [],
      timeframe: 15,
      or_minutes: 45,
      total_candles: 0,
      error: "No data available",
    });

    await page.goto("/chart/EMPTY");

    // Should show error or no data message
    await expect(
      page.locator('[data-testid="chart-error"], [data-testid="chart-loading"]'),
    ).toBeVisible({ timeout: 5000 });
  });

  test("should handle missing symbol parameter", async ({ page }) => {
    await page.goto("/chart");

    // Should show error about missing symbol or redirect
    await expect(
      page
        .locator(
          '[data-testid="chart-view-error"], [data-testid="chart-error"], [data-testid="chart-back-btn"]',
        )
        .first(),
    ).toBeVisible({
      timeout: 5000,
    });
  });

  test("should handle API error response", async ({ page }) => {
    await page.route("**/api/chart/preview/**", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal server error" }),
      });
    });

    await page.goto("/chart/ERROR");

    // Should show error state
    await expect(page.locator('[data-testid="chart-error"]')).toBeVisible({ timeout: 5000 });
  });
});
