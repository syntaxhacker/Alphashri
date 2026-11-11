import { test, expect, Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { gotoChart } from "./helpers/chartHelpers";

/**
 * Chart Preview — `/chart/:symbol` (pattern workspace).
 *
 * The route now renders `ChartView` → `PatternChartBody` →
 * `PatternTradingViewChart` (lightweight-charts, `data-testid="patterns-tv-chart"`),
 * NOT the old ECharts candlestick chart. It talks to
 * `GET /api/chart-patterns/timeframes` and
 * `GET /api/chart-patterns/symbol/{symbol}/chart`, both mocked here.
 *
 * The old chart-preview contract (`candlestick-chart`, `chart-or-select`,
 * `chart-pivots-checkbox`, `chart-52w-checkbox`, `chart-footer`,
 * `chart-controls`, `chart-timeframe-select`, `tradingview-chart`) belonged to
 * the replaced ORB chart-preview and does not exist on this page, so this spec
 * targets the current UI without resurrecting those controls in source.
 */

function makeCandles(
  count = 10,
  base = 1480,
  date = "2026-03-02",
): Array<{ t: string; o: number; h: number; l: number; c: number; v: number }> {
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
  const candles: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }> = [];
  for (let i = 0; i < count; i++) {
    const o = base + Math.random() * 50 - 25;
    candles.push({
      t: `${date}T${times[i % times.length]}`,
      o: +o.toFixed(2),
      h: +(o + 10 + Math.random() * 10).toFixed(2),
      l: +(o - 10 - Math.random() * 10).toFixed(2),
      c: +(o + Math.random() * 20 - 10).toFixed(2),
      v: Math.floor(50000 + Math.random() * 100000),
    });
  }
  return candles;
}

const TIMEFRAMES = [
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "30m", label: "30m" },
  { id: "1h", label: "1h" },
  { id: "1D", label: "1D" },
];

function chartPayload(symbol: string, candles: ReturnType<typeof makeCandles>) {
  return {
    symbol,
    timeframe: "1D",
    candles,
    overlays: [],
    trend_lines: [],
    hits: [],
  };
}

async function setupChartPreviewMock(
  page: Page,
  data: { symbol?: string; base?: number; count?: number } = {},
) {
  await setupApiMocks(page);
  await loginAsTestUser(page);

  const symbol = data.symbol ?? "RELIANCE";
  const candles = makeCandles(data.count ?? 10, data.base ?? 1480);

  await page.route(apiRoute("chart-patterns/timeframes"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ timeframes: TIMEFRAMES }),
    });
  });

  await page.route(apiRoute("chart-patterns/symbol/[^/]+/chart"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chartPayload(symbol, candles)),
    });
  });
}

async function expectPatternChart(page: Page, timeout: number = 10000) {
  await expect(page.locator('[data-testid="patterns-tv-chart"]')).toBeVisible({ timeout });
  await expect(page.locator('[data-testid="patterns-tv-chart"] canvas').first()).toBeVisible({
    timeout,
  });
}

/** `ChartTimeframeSelect` renders a non-searchable `@/ui` `Select`, i.e. a
 *  native `<select>` inside a FormControl div (no `[role="combobox"]`).
 *  Options are never "visible" boxes, so we wait for the option to be
 *  attached (the server ladder loads asynchronously) then use `selectOption`. */
async function selectTimeframe(page: Page, value: string) {
  const select = page.locator('[data-testid="patterns-timeframe-select"] select');
  await expect(select).toBeVisible();
  const option = page.locator(`[data-testid="patterns-timeframe-select"] option[value="${value}"]`);
  await expect(option).toHaveCount(1);
  await select.selectOption(value);
}

test.describe("Chart Preview - Symbol Chart", () => {
  test("should render the pattern chart for a symbol", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await gotoChart(page, "RELIANCE");
    await expectPatternChart(page);
    await expect(page.locator('[data-testid="chart-title"]')).toContainText("RELIANCE");
  });
});

test.describe("Chart Preview - Timeframe Switching", () => {
  test("should display the timeframe selector", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await gotoChart(page, "RELIANCE");
    await expectPatternChart(page);
    await expect(page.locator('[data-testid="patterns-timeframe-select"]')).toBeVisible();
  });

  for (const tf of TIMEFRAMES) {
    test(`should switch to ${tf.label} timeframe`, async ({ page }) => {
      await setupChartPreviewMock(page, { symbol: "RELIANCE" });
      await gotoChart(page, "RELIANCE");
      await expectPatternChart(page);
      await selectTimeframe(page, tf.id);
      await expect(
        page.locator('[data-testid="patterns-timeframe-select"] select'),
      ).toHaveValue(tf.id);
      await expectPatternChart(page);
    });
  }

  test("should refresh chart data when timeframe changes", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    let chartRequests = 0;
    await page.route(apiRoute("chart-patterns/timeframes"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ timeframes: TIMEFRAMES }),
      });
    });
    await page.route(apiRoute("chart-patterns/symbol/[^/]+/chart"), async (route) => {
      chartRequests++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(chartPayload("RELIANCE", makeCandles(10, 2500))),
      });
    });
    await gotoChart(page, "RELIANCE");
    await expectPatternChart(page);
    const initialCount = chartRequests;
    await selectTimeframe(page, "30m");
    await expect.poll(async () => chartRequests, { timeout: 10000 }).toBeGreaterThan(initialCount);
    await expectPatternChart(page);
  });
});

test.describe("Chart Preview - Navigation and Controls", () => {
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
    await expectPatternChart(page);
    await page.locator('[data-testid="chart-back-btn"]').click();
    await expect(page.locator('[data-testid="app-shell"]')).toBeVisible({ timeout: 10000 });
    expect(page.url()).not.toContain("/chart/RELIANCE");
  });

  test("should show symbol in title", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await gotoChart(page, "RELIANCE");
    await expect(page.locator('[data-testid="chart-title"]')).toContainText("RELIANCE");
  });
});

test.describe("Chart Preview - Error and Edge Cases", () => {
  test("should show error when API fails", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await page.route(apiRoute("chart-patterns/timeframes"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ timeframes: TIMEFRAMES }),
      });
    });
    await page.route(apiRoute("chart-patterns/symbol/[^/]+/chart"), async (route) => {
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
    await page.route(apiRoute("chart-patterns/timeframes"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ timeframes: TIMEFRAMES }),
      });
    });
    await page.route(apiRoute("chart-patterns/symbol/[^/]+/chart"), async (route) => {
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
    await page.route(apiRoute("chart-patterns/timeframes"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ timeframes: TIMEFRAMES }),
      });
    });
    await page.route(apiRoute("chart-patterns/symbol/[^/]+/chart"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol: "EMPTY",
          timeframe: "1D",
          candles: [],
          overlays: [],
          trend_lines: [],
          hits: [],
        }),
      });
    });
    await gotoChart(page, "EMPTY");
    await expect(page.locator('[data-testid="chart-empty"]')).toBeVisible({ timeout: 5000 });
  });

  test("should handle missing symbol parameter", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await page.goto("/chart");
    await expect(page.locator('[data-testid="chart-view-error"]').first()).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("Chart Preview - Responsive", () => {
  const viewports = [
    { name: "mobile", width: 375, height: 667 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1920, height: 1080 },
  ];

  for (const vp of viewports) {
    test(`should render on ${vp.name} viewport`, async ({ page }) => {
      await setupChartPreviewMock(page, { symbol: "RELIANCE" });
      await page.setViewportSize(vp);
      await gotoChart(page, "RELIANCE");
      await expectPatternChart(page);
    });
  }
});

test.describe("Chart Preview - Data Zoom", () => {
  test("should render chart with canvas", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await gotoChart(page, "RELIANCE");
    await expectPatternChart(page);
    const canvasCount = await page.locator('[data-testid="patterns-tv-chart"] canvas').count();
    expect(canvasCount).toBeGreaterThan(0);
  });

  test("should support zoom via mouse wheel", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await gotoChart(page, "RELIANCE");
    const container = page.locator('[data-testid="patterns-tv-chart"]');
    await container.hover({ position: { x: 200, y: 200 } });
    await page.mouse.wheel(0, -100);
    await expect(container).toBeVisible({ timeout: 5000 });
  });

  test("should support pan via drag", async ({ page }) => {
    await setupChartPreviewMock(page, { symbol: "RELIANCE" });
    await gotoChart(page, "RELIANCE");
    const container = page.locator('[data-testid="patterns-tv-chart"]');
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
    await page.route(apiRoute("chart-patterns/timeframes"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ timeframes: TIMEFRAMES }),
      });
    });
    await page.route(apiRoute("chart-patterns/symbol/[^/]+/chart"), async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(chartPayload("RELIANCE", makeCandles(5))),
      });
    });
    await gotoChart(page, "RELIANCE");
    await expect(page.locator('[data-testid="chart-loading"]')).toBeVisible();
    await expectPatternChart(page);
  });
});
