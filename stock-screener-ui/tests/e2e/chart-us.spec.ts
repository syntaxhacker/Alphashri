import { test, expect, type Page } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupUserConfigMocks,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

/**
 * US stock chart end-to-end: clicking a USA row's chart icon must land on a
 * rendered in-app chart. The provider route (`?market=usa`) is mocked so the
 * spec locks the whole click → navigate → render path, and asserts the
 * currency/pattern/replay contract both at desktop and mobile widths.
 */

const VIEWPORTS = [
  { name: "1600", viewport: { width: 1600, height: 900 } },
  { name: "390", viewport: { width: 390, height: 844 } },
];

const US_ROWS = [
  {
    symbol: "AAPL",
    name: "Apple Inc",
    sector: "Technology",
    exchange: "NASDAQ",
    close: 189.5,
    change: 0.8,
    relative_volume: 1.4,
    marketCapUsdB: 2950,
    cap_tier: "large",
    rsi: 61,
    adx: 26,
    pos_52w: 0.87,
    fno: false,
    etf: false,
    currency: "USD",
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corp",
    sector: "Technology",
    exchange: "NASDAQ",
    close: 415.2,
    change: -0.3,
    relative_volume: 1.0,
    marketCapUsdB: 3080,
    cap_tier: "large",
    rsi: 57,
    adx: 24,
    pos_52w: 0.79,
    fno: false,
    etf: false,
    currency: "USD",
  },
];

function makeCandles(symbol: string) {
  const isUS = symbol === "AAPL" || symbol === "MSFT";
  const base = isUS ? 190 : 1480;
  return Array.from({ length: 12 }, (_, i) => {
    const t = isUS
      ? `2026-11-16T14:${String(30 + i).padStart(2, "0")}:00Z`
      : `2026-11-17T09:${String(15 + i).padStart(2, "0")}:00+05:30`;
    const open = base + i;
    return { t, o: open, h: open + 2, l: open - 1, c: open + 1, v: 100000 + i };
  });
}

function makeHit(
  symbol: string,
  patternName: string,
  source: "live" | "scan",
  endDate: string,
) {
  return {
    id: 1,
    uuid: `${symbol}-${patternName}`,
    symbol,
    name: source === "live" ? "Live detection" : "Stored scan",
    timeframe: "1D",
    pattern_id: patternName.toLowerCase().replace(/\s+/g, "_"),
    pattern_name: patternName,
    family: "continuation",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 93.1,
    start_date: "2026-11-01",
    end_date: endDate,
    start_price: 330,
    end_price: 352.25,
    breakout_level: 354.8,
    target: 370,
    stop: 320,
    bars_ago: 7,
    volume_confirmed: true,
    trendlines: [
      [
        { t: "2026-11-01T00:00:00Z", price: 330 },
        { t: "2026-11-16T00:00:00Z", price: 352 },
      ],
    ],
    trend_lines: [],
    notes: "rising support; resistance near 354.8",
    pivots: [
      { t: "2026-11-03T00:00:00Z", price: 344.01, kind: "high" },
      { t: "2026-11-05T00:00:00Z", price: 299.51, kind: "low" },
    ],
    last_close: 352.25,
    day_change_pct: -1.13,
    close_bar_date: "2026-11-16",
    source,
  };
}

function chartPayload(symbol: string, isUS: boolean) {
  const base = {
    symbol,
    timeframe: "1D",
    candles: makeCandles(symbol),
    ...(isUS
      ? {
          overlays: [
            {
              pattern_id: "rising_wedge",
              pattern_name: "Rising Wedge",
              direction: "bearish",
              trendlines: [
                [
                  { t: "2026-11-05T00:00:00Z", price: 340 },
                  { t: "2026-11-16T00:00:00Z", price: 352 },
                ],
              ],
            },
          ],
          trend_lines: [
            {
              kind: "support",
              start_date: "2026-11-01",
              start_price: 330,
              end_date: "2026-11-16",
              end_price: 344,
              slope: 1,
              touches: 3,
              span_bars: 10,
              violations: 0,
            },
          ],
          hits: [
            makeHit(symbol, "Falling Wedge", "live", "2026-11-16"),
            makeHit(symbol, "Rising Wedge", "live", "2026-11-10"),
          ],
        }
      : {
          overlays: [],
          trend_lines: [],
          hits: [makeHit(symbol, "Consolidation", "scan", "2026-11-16")],
        }),
  };
  if (!isUS) return base;
  return {
    ...base,
    market: "usa",
    feed: "yahoo",
    delay_label: "~1 min (forming)",
    session_date: "2026-11-16",
  };
}

async function setupCharts(page: Page, chartUrls: string[]) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupUserConfigMocks(page);

  await page.route(apiRoute("chart-patterns/timeframes"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timeframes: [
          { id: "1m", label: "1m" },
          { id: "5m", label: "5m" },
          { id: "15m", label: "15m" },
          { id: "1h", label: "1h" },
          { id: "1D", label: "1D" },
        ],
      }),
    });
  });

  await page.route(apiRoute("chart-patterns/symbol/[^/]+/chart"), async (route) => {
    const url = route.request().url();
    chartUrls.push(url);
    const isUS = new URL(url).searchParams.get("market") === "usa";
    const symbol = decodeURIComponent(url.split("/symbol/")[1].split("/chart")[0]);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chartPayload(symbol, isUS)),
    });
  });

  await page.route(apiRoute("chart-patterns/patterns/lookup"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timeframe: "1D",
        session: "2026-11-17",
        source: "stored",
        data_through: null,
        items: [],
      }),
    });
  });

  await page.route(apiRoute("market/snapshot"), async (route) => {
    const universe = new URL(route.request().url()).searchParams.get("universe");
    const rows = universe === "us" ? US_ROWS : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        as_of: new Date().toISOString(),
        universe: universe ?? "all_equity",
        total: rows.length,
        update_mode: "streaming",
        rows,
      }),
    });
  });
}

/** Contracts shared by the direct route and the row-icon click, at any width. */
async function expectUSChart(page: Page) {
  const view = page.locator('[data-testid="chart-view"]');
  await expect(view).toBeVisible({ timeout: 15000 });
  await expect(view).toHaveAttribute("data-market", "usa");
  await expect(view).toHaveAttribute("data-feed", "yahoo");
  await expect(page.locator('[data-testid="chart-us-feed"]')).toContainText("yahoo");
  await expect(page.locator('[data-testid="patterns-tv-chart"] canvas').first()).toBeVisible({
    timeout: 15000,
  });

  // Currency: header / close / LTP / pivots / legend are all USD, never INR.
  await expect(view).not.toContainText("₹");
  await expect(view).toContainText("$");
  const panel = page.locator('[data-testid="patterns-fullscreen-panel"]');
  await expect(panel).toContainText("$");

  // Live US hits/overlays/trendlines render like any pattern chart...
  await expect(panel).toContainText("Falling Wedge");
  await expect(page.locator('[data-testid="patterns-chart-legend"]')).toContainText(
    "Falling Wedge",
  );
  await expect(page.locator('[data-testid="patterns-chart-legend"]')).toContainText(
    "Rising Wedge",
  );
  // ...but the NSE SCAN/LIVE provenance badge is India-only.
  await expect(page.locator('[data-testid="chart-pattern-source"]')).toHaveCount(0);

  // Replay is an NSE feature: no as-of control, banner or date inputs for US.
  await expect(page.locator('[data-testid="patterns-fullscreen-asof-controls"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="patterns-fullscreen-asof-from"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="patterns-fullscreen-asof-to"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="patterns-fullscreen-asof-banner"]')).toHaveCount(0);
}

for (const vp of VIEWPORTS) {
  test.describe(`US stock chart @ ${vp.name}px`, () => {
    test.use({ viewport: vp.viewport });

    test("direct /chart/AAPL?market=usa renders USD patterns with no replay controls", async ({
      page,
    }) => {
      const chartUrls: string[] = [];
      await setupCharts(page, chartUrls);

      await page.goto("/chart/AAPL?market=usa");
      await expectUSChart(page);

      const usRequest = chartUrls.find((u) => u.includes("/symbol/AAPL/chart"));
      expect(usRequest).toBeDefined();
      expect(usRequest).toContain("market=usa");
      // US is a single live-detection read (no stored scan lookup).
      expect(usRequest).toContain("detect_patterns=1");
    });

    test("USA row chart icon renders the US chart and keeps market=usa on timeframe change", async ({
      page,
    }) => {
      const chartUrls: string[] = [];
      await setupCharts(page, chartUrls);

      await page.goto("/screener");
      await page.waitForSelector('[data-testid="market-screener"]', { timeout: 15000 });

      const combo = page.locator('[data-testid="market-universe-select"] [role="combobox"]');
      await combo.click();
      await combo.fill("");
      await page.getByRole("option", { name: "USA", exact: true }).click();
      await expect(page.locator('[data-testid="market-row-AAPL"]')).toBeVisible({ timeout: 15000 });

      await page.locator('[data-testid="market-chart-AAPL"]').click();

      await expect(page).toHaveURL(/\/chart\/AAPL\?market=usa/);
      await expectUSChart(page);
      expect(
        chartUrls.some((u) => u.includes("/symbol/AAPL/chart") && u.includes("market=usa")),
      ).toBe(true);

      await page.locator('[aria-label="Timeframe"]').selectOption("15m");
      await expect(page).toHaveURL(/[?&]tf=15m/);
      await expect(page).toHaveURL(/market=usa/);
      const last = chartUrls.at(-1);
      expect(last).toContain("market=usa");
      expect(last).toContain("timeframe=15m");
      await expectUSChart(page);
    });
  });
}

test.describe("Deep-linked US timeframe regression", () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  // The async /timeframes ladder starts as [1D]. A valid US deep link must not
  // be validated against that placeholder: doing so rewrote tf=5m to tf=1D and
  // fired a second, wrong chart request before the real options arrived.
  test("?tf=5m stays a single 5m request with no 1D fallback", async ({ page }) => {
    const chartUrls: string[] = [];
    await setupCharts(page, chartUrls);

    await page.goto("/chart/AAPL?market=usa&tf=5m");

    await expect.poll(() => chartUrls.length).toBeGreaterThan(0);
    await expectUSChart(page);

    const timeframes = chartUrls.map((u) => new URL(u).searchParams.get("timeframe"));
    expect(timeframes).toEqual(["5m"]);
    expect(timeframes).not.toContain("1D");

    // URL params survive intact (order-insensitive).
    const url = new URL(page.url());
    expect(url.searchParams.get("tf")).toBe("5m");
    expect(url.searchParams.get("market")).toBe("usa");
  });
});

test.describe("India chart regression", () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test("APLAPOLLO keeps ₹ and the stored Consolidation pattern", async ({ page }) => {
    const chartUrls: string[] = [];
    await setupCharts(page, chartUrls);

    await page.goto("/chart/APLAPOLLO");
    const view = page.locator('[data-testid="chart-view"]');
    await expect(view).toBeVisible({ timeout: 15000 });
    await expect(view).toHaveAttribute("data-market", "india");
    await expect(view).toContainText("₹");

    const panel = page.locator('[data-testid="patterns-fullscreen-panel"]');
    await expect(panel).toContainText("Consolidation");
    await expect(panel).toContainText("₹");
    await expect(page.locator('[data-testid="chart-pattern-source"]')).toContainText("SCAN");
    // Replay stays available on India.
    await expect(page.locator('[data-testid="patterns-fullscreen-asof-controls"]')).toBeVisible();

    const indiaRequest = chartUrls.find((u) => u.includes("/symbol/APLAPOLLO/chart"));
    expect(indiaRequest).toBeDefined();
    expect(indiaRequest).not.toContain("market=");
    // Stored-first read: no live detection when the scan already has hits.
    expect(indiaRequest).not.toContain("detect_patterns");
  });
});
