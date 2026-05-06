import { test, expect, Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import {
  generateCandles,
  expectChartVisible,
  gotoChart,
  createOrbZone,
  createPivotLevels,
} from "./helpers/chartHelpers";

async function setupChartPreviewMock(
  page: Page,
  data: {
    symbol: string;
    orbZones?: any[];
    pivotLevels?: any[];
    week52Levels?: any;
    trades?: any[];
  },
) {
  await setupApiMocks(page);
  await loginAsTestUser(page);

  const candles = generateCandles(
    10,
    data.symbol === "TCS"
      ? 3750
      : data.symbol === "RELIANCE"
        ? 2500
        : data.symbol === "HDFC"
          ? 1600
          : 1480,
  );

  const chartData: any = {
    symbol: data.symbol,
    candles,
    timeframe: 15,
    or_minutes: 45,
    total_candles: candles.length,
    orb_zones: data.orbZones || [],
    pivot_levels: data.pivotLevels || [],
    trades: data.trades || [],
  };

  if (data.week52Levels) {
    chartData.week52_levels = data.week52Levels;
  }

  await page.route(apiRoute("chart/preview/"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chartData),
    });
  });
}

async function getChartOption(page: Page): Promise<any | null> {
  await page.waitForTimeout(1000);
  return page.evaluate(() => {
    const echarts = (window as any).echarts;
    if (!echarts) return null;
    const container = document.querySelector('[data-testid="candlestick-chart"]');
    if (!container) return null;
    const instance = echarts.getInstanceByDom(container);
    if (!instance) return null;
    return instance.getOption();
  });
}

test.describe("Chart Preview - ORB Strategy Levels", () => {
  test("should display chart with ORB data", async ({ page }) => {
    await setupChartPreviewMock(page, {
      symbol: "RELIANCE",
      orbZones: [createOrbZone("2026-03-02", 2540, 2490, "09:45")],
      pivotLevels: [createPivotLevels("2026-03-02", 2520, 2560, 2480, 2590, 2450)],
    });
    await gotoChart(page, "RELIANCE");
    await expectChartVisible(page);
    await expect(page.locator('[data-testid="chart-title"]')).toContainText("RELIANCE");
  });

  test("should display ORB high and low lines", async ({ page }) => {
    await setupChartPreviewMock(page, {
      symbol: "RELIANCE",
      orbZones: [createOrbZone("2026-03-02", 2540, 2490, "09:45")],
      pivotLevels: [createPivotLevels("2026-03-02", 2520, 2560, 2480, 2590, 2450)],
    });
    await gotoChart(page, "RELIANCE");
    await expectChartVisible(page);
    const option = await getChartOption(page);
    const series = option?.series || [];
    expect(series.some((s: any) => s.name === "OR High")).toBeTruthy();
    expect(series.some((s: any) => s.name === "OR Low")).toBeTruthy();
  });

  test("should display ORB high and low lines with data", async ({ page }) => {
    await setupChartPreviewMock(page, {
      symbol: "RELIANCE",
      orbZones: [createOrbZone("2026-03-02", 2540, 2490, "09:45")],
    });
    await gotoChart(page, "RELIANCE");
    await expectChartVisible(page);
    const option = await getChartOption(page);
    const series = option?.series || [];
    const orbHigh = series.find((s: any) => s.name === "OR High");
    const orbLow = series.find((s: any) => s.name === "OR Low");
    expect(orbHigh).toBeTruthy();
    expect(orbLow).toBeTruthy();
    expect(orbHigh.data.some((v: any) => v !== null)).toBeTruthy();
    expect(orbLow.data.some((v: any) => v !== null)).toBeTruthy();
  });
});

test.describe("Chart Preview - Pivot Levels", () => {
  test("should display pivot levels (PP, R1, S1)", async ({ page }) => {
    await setupChartPreviewMock(page, {
      symbol: "RELIANCE",
      pivotLevels: [createPivotLevels("2026-03-02", 2520, 2560, 2480, 2590, 2450)],
    });
    await gotoChart(page, "RELIANCE");
    await expectChartVisible(page);
    const option = await getChartOption(page);
    const series = option?.series || [];
    const pivotNames = series
      .filter((s: any) => s.name && ["PP", "R1", "S1"].includes(s.name))
      .map((s: any) => s.name);
    expect(pivotNames).toContain("PP");
    expect(pivotNames).toContain("R1");
    expect(pivotNames).toContain("S1");
  });
});

test.describe("Chart Preview - 52W Levels", () => {
  test("should display chart with 52W levels data", async ({ page }) => {
    await setupChartPreviewMock(page, {
      symbol: "TCS",
      week52Levels: { high_52w: 3900, low_52w: 3400, distance_to_high_pct: 2.5, near_high: true },
    });
    await gotoChart(page, "TCS");
    await expectChartVisible(page);
    await expect(page.locator('[data-testid="chart-title"]')).toContainText("TCS");
  });

  test("should render chart with 52W levels in API response", async ({ page }) => {
    await setupChartPreviewMock(page, {
      symbol: "TCS",
      week52Levels: { high_52w: 3900, low_52w: 3400, distance_to_high_pct: 2.5, near_high: true },
    });
    await gotoChart(page, "TCS");
    await expectChartVisible(page);
    const option = await getChartOption(page);
    expect(option).not.toBeNull();
    expect(option?.series).toBeDefined();
  });
});

test.describe("Chart Preview - Trade Markers", () => {
  test("should display chart with trade data in response", async ({ page }) => {
    await setupChartPreviewMock(page, {
      symbol: "HDFC",
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
    });
    await gotoChart(page, "HDFC");
    await expectChartVisible(page);
    const option = await getChartOption(page);
    expect(option).not.toBeNull();
    expect(option?.series).toBeDefined();
    expect(option?.series.length).toBeGreaterThan(0);
  });
});

test.describe("Chart Preview - Timeframe Switching", () => {
  const timeframes = [
    { value: "1", label: "1m" },
    { value: "5", label: "5m" },
    { value: "15", label: "15m" },
    { value: "30", label: "30m" },
    { value: "60", label: "60m" },
  ];

  for (const tf of timeframes) {
    test(`should switch to ${tf.label} timeframe`, async ({ page }) => {
      await setupChartPreviewMock(page, { symbol: "RELIANCE" });
      await gotoChart(page, "RELIANCE");
      await expectChartVisible(page);
      const tfSelect = page.locator('[data-testid="chart-timeframe-select"]');
      await expect(tfSelect).toBeVisible();
      await tfSelect.selectOption(tf.value);
      await expectChartVisible(page, 5000);
      const footer = page.locator('[data-testid="chart-footer"]');
      await expect(footer).toContainText(`TF: ${tf.label}`);
    });
  }

  test("should display timeframe selector dropdown", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await gotoChart(page, "RELIANCE");
    await expectChartVisible(page);
    await expect(page.locator('[data-testid="chart-timeframe-select"]')).toBeVisible();
  });

  test("should refresh chart data when timeframe changes", async ({ page }) => {
    let requestCount = 0;
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await page.route(apiRoute("chart/preview/"), async (route) => {
      requestCount++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol: "RELIANCE",
          candles: generateCandles(10, 2500),
          timeframe: 15,
          or_minutes: 45,
          total_candles: 10,
          orb_zones: [],
          pivot_levels: [],
        }),
      });
    });
    await gotoChart(page, "RELIANCE");
    await expectChartVisible(page);
    const initialCount = requestCount;
    const tfSelect = page.locator('[data-testid="chart-timeframe-select"]');
    await tfSelect.selectOption("30");
    await expectChartVisible(page, 5000);
    expect(requestCount).toBeGreaterThan(initialCount);
  });
});

test.describe("Chart Preview - OR Minutes Setting", () => {
  test("should change OR minutes setting", async ({ page }) => {
    await setupChartPreviewMock(page, {
      symbol: "RELIANCE",
      orbZones: [createOrbZone("2026-03-02", 2540, 2490, "09:45")],
    });
    await gotoChart(page, "RELIANCE");
    await expectChartVisible(page);
    const orSelect = page.locator('[data-testid="chart-or-select"]');
    await expect(orSelect).toBeVisible();
    await orSelect.selectOption("30");
    await expectChartVisible(page, 5000);
  });
});

test.describe("Chart Preview - Pivot Toggle", () => {
  test("should toggle pivots checkbox", async ({ page }) => {
    await setupChartPreviewMock(page, {
      symbol: "RELIANCE",
      pivotLevels: [createPivotLevels("2026-03-02", 2520, 2560, 2480, 2590, 2450)],
    });
    await gotoChart(page, "RELIANCE");
    await expectChartVisible(page);
    const pivotsCheckbox = page.locator('[data-testid="chart-pivots-checkbox"]');
    await expect(pivotsCheckbox).toBeVisible();
    await pivotsCheckbox.uncheck();
    await expectChartVisible(page, 5000);
    await pivotsCheckbox.check();
    await expectChartVisible(page, 5000);
  });
});

test.describe("Chart Preview - Combined Overlays (All Strategy Types)", () => {
  test("should render chart with ORB + Pivot + 52W overlays simultaneously", async ({ page }) => {
    await setupChartPreviewMock(page, {
      symbol: "RELIANCE",
      orbZones: [createOrbZone("2026-03-02", 2540, 2490, "09:45")],
      pivotLevels: [createPivotLevels("2026-03-02", 2520, 2560, 2480, 2590, 2450)],
      week52Levels: { high_52w: 2600, low_52w: 2200, distance_to_high_pct: 4.0, near_high: false },
    });
    await gotoChart(page, "RELIANCE");
    await expectChartVisible(page);
    const option = await getChartOption(page);
    const series = option?.series || [];
    const overlayNames = series
      .filter((s: any) => s.name && s.type !== "candlestick" && s.type !== "scatter")
      .map((s: any) => s.name);
    expect(overlayNames.length).toBeGreaterThanOrEqual(3);
  });
});

test.describe("Chart Preview - Navigation and Controls", () => {
  test("should show chart controls", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await gotoChart(page, "RELIANCE");
    await expect(page.locator('[data-testid="chart-controls"]')).toBeVisible({ timeout: 10000 });
  });

  test("should show back button", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await gotoChart(page, "RELIANCE");
    await expect(page.locator('[data-testid="chart-back-btn"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="chart-back-btn"]')).toContainText("Back");
  });

  test("should navigate back when back button clicked", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await page.goto("/");
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible({ timeout: 10000 });
    await gotoChart(page, "RELIANCE", { waitUntil: "domcontentloaded" });
    await expectChartVisible(page);
    await page.locator('[data-testid="chart-back-btn"]').click();
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible({ timeout: 10000 });
    expect(page.url()).not.toContain("/chart/RELIANCE");
  });

  test("should show symbol in title", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await gotoChart(page, "RELIANCE");
    await expect(page.locator('[data-testid="chart-title"]')).toContainText("RELIANCE");
  });

  test("should show candle count in footer", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await gotoChart(page, "RELIANCE");
    await expect(page.locator('[data-testid="chart-footer"]')).toContainText("candles");
  });
});

test.describe("Chart Preview - Error and Edge Cases", () => {
  test("should show error when API fails", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await page.route(apiRoute("chart/preview/"), async (route) => {
      await route.abort("failed");
    });
    await gotoChart(page, "INVALID");
    await expect(page.locator('[data-testid="chart-error"]').first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("should show error for 500 response", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await page.route(apiRoute("chart/preview/"), async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal server error" }),
      });
    });
    await gotoChart(page, "ERROR");
    await expect(page.locator('[data-testid="chart-error"]')).toBeVisible({ timeout: 5000 });
  });

  test("should handle empty candle data", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await page.route(apiRoute("chart/preview/"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol: "EMPTY",
          candles: [],
          orb_zones: [],
          pivot_levels: [],
          timeframe: 15,
          or_minutes: 45,
          total_candles: 0,
          error: "No data",
        }),
      });
    });
    await gotoChart(page, "EMPTY");
    await expect(
      page.locator('[data-testid="chart-error"], [data-testid="chart-loading"]'),
    ).toBeVisible({ timeout: 5000 });
  });

  test("should handle missing symbol parameter", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await page.goto("/chart");

    await expect(
      page
        .locator(
          '[data-testid="chart-view-error"], [data-testid="chart-error"], [data-testid="chart-back-btn"]',
        )
        .first(),
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Chart Preview - Responsive", () => {
  test("should render on mobile viewport", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoChart(page, "RELIANCE");
    await expectChartVisible(page);
  });

  test("should render on tablet viewport", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await page.setViewportSize({ width: 768, height: 1024 });
    await gotoChart(page, "RELIANCE");
    await expectChartVisible(page);
  });

  test("should render on desktop viewport", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await gotoChart(page, "RELIANCE");
    await expectChartVisible(page);
  });
});

test.describe("Chart Preview - Data Zoom", () => {
  test("should have dataZoom configured", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await gotoChart(page, "RELIANCE");
    await expectChartVisible(page);
    const option = await getChartOption(page);
    expect(option?.dataZoom).not.toBeNull();
    expect(option?.dataZoom?.length).toBeGreaterThan(0);
    expect(option?.dataZoom?.[0]).toHaveProperty("start");
    expect(option?.dataZoom?.[0]).toHaveProperty("end");
  });

  test("should support zoom via mouse wheel", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await gotoChart(page, "RELIANCE");
    const container = page.locator('[data-testid="candlestick-chart"]');
    await container.hover({ position: { x: 200, y: 200 } });
    await page.mouse.wheel(0, -100);
    await expect(container).toBeVisible({ timeout: 5000 });
  });

  test("should support pan via drag", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await gotoChart(page, "RELIANCE");
    const container = page.locator('[data-testid="candlestick-chart"]');
    const box = await container.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2);
      await page.mouse.up();
      await expect(container).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe("Chart Preview - Loading State", () => {
  test("should show loading while fetching data", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await page.route(apiRoute("chart/preview/"), async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol: "RELIANCE",
          candles: generateCandles(5),
          timeframe: 15,
          or_minutes: 45,
          total_candles: 5,
          orb_zones: [],
          pivot_levels: [],
        }),
      });
    });
    await gotoChart(page, "RELIANCE");
    await expect(page.locator('[data-testid="chart-loading"]')).toBeVisible();
    await expectChartVisible(page);
  });
});
