import { test, expect, type Locator, type Page, type Route } from "@playwright/test";
import {
  loginAsTestUser,
  mockTrendingResponse,
  setupApiMocks,
  setupNiftyReportMocks,
  setupOptionsMocks,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

/**
 * Viewport scroll contract.
 *
 * Every route page must fit inside `#app-main`; that column never scrolls and
 * neither does the document. The page's own child region (results table, report
 * desk cell, replay body, …) owns vertical scrolling instead.
 *
 * The route sweep stays data-light: it mocks just enough of the pattern and
 * report APIs for the lazy route chunks to paint their page roots. Separate
 * data-heavy cases then prove the designated internal regions actually own
 * overflow while the document and `#app-main` stay still.
 */

type RouteCase = {
  name: string;
  path: string;
  /** Route-owned marker that proves the lazy page chunk mounted. */
  ready?: string;
  patterns?: boolean;
  report?: boolean;
};

const ROUTES: RouteCase[] = [
  { name: "root redirect", path: "/" },
  { name: "home", path: "/home" },
  { name: "screener", path: "/screener" },
  { name: "sector", path: "/sector" },
  { name: "backtest", path: "/backtest" },
  { name: "experiments", path: "/experiments" },
  { name: "paper", path: "/paper" },
  { name: "replay", path: "/replay" },
  { name: "strategy runner", path: "/strategy-runner" },
  { name: "strategies", path: "/strategies", ready: '[data-testid="strategies-view"]' },
  { name: "bots", path: "/bots", ready: '[data-testid="bots-view"]' },
  { name: "options", path: "/options", ready: '[data-testid="options-view"]' },
  {
    name: "report index",
    path: "/report/index",
    ready: '[data-testid="nifty-report-panel"]',
    report: true,
  },
  { name: "report profit", path: "/report/profit", ready: '[data-testid="profitability-report"]' },
  { name: "settings", path: "/settings" },
  { name: "news", path: "/news" },
  { name: "agri", path: "/agri" },
  { name: "patterns", path: "/patterns", ready: '[data-testid="patterns-page"]', patterns: true },
  { name: "chart", path: "/chart/RELIANCE", ready: '[data-testid="chart-view"]', patterns: true },
  { name: "poc kit", path: "/poc/kit", ready: '[data-testid="kit-poc"]' },
  { name: "poc smc", path: "/poc/smc", ready: '[data-testid="smc-poc"]' },
  { name: "poc replay index", path: "/poc/replay", ready: '[data-testid="replay-index"]' },
  { name: "poc tick replay", path: "/poc/tick-replay", ready: '[data-testid="tick-replay-page"]' },
  { name: "poc smc trades", path: "/poc/smc-trades", ready: '[data-testid="smc-trades-page"]' },
  {
    name: "poc replay strategy",
    path: "/poc/replay/smc-ifvg",
    ready: '[data-testid="replay-strategy-page"]',
  },
];

const VIEWPORTS = [
  { name: "1600x1000", width: 1600, height: 1000 },
  { name: "390x844", width: 390, height: 844 },
] as const;

function fulfillJson(body: unknown) {
  return (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
}

/** Minimal chart-patterns surface so /patterns and /chart/<symbol> paint. */
async function setupPatternMocks(page: Page) {
  const json = fulfillJson;
  await page.route(
    /chart-patterns\/timeframes/,
    json({
      timeframes: [
        {
          id: "1D",
          label: "1D",
          minutes: 1440,
          native: "days/1",
          source_tf: null,
          max_lookback_days: 730,
          min_bars: 60,
        },
      ],
    }),
  );
  await page.route(
    /chart-patterns\/universes/,
    json({
      universes: [{ id: "nifty500", label: "Nifty 500", count: 500 }],
      default: "nifty500",
    }),
  );
  await page.route(/chart-patterns\/patterns/, json({ families: [], patterns: [] }));
  await page.route(
    /chart-patterns\/summary/,
    json({ scanned: 0, patterns: 0, in_view: 0, confirmed: 0, bullish: 0, bearish: 0 }),
  );
  await page.route(
    /chart-patterns\/results(\?|$)/,
    json({ items: [], total: 0, data_through: null }),
  );
  await page.route(/chart-patterns\/results\/stream/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'event: meta\ndata: {"total":0,"data_through":null}\n\nevent: done\ndata: {}\n\n',
    }),
  );
  await page.route(
    /chart-patterns\/matrix/,
    json({ universe: "nifty500", timeframes: ["1D"], rows: [], data_through: null }),
  );
  await page.route(/chart-patterns\/jobs(\?|$)/, json({ jobs: [] }));
  await page.route(
    /chart-patterns\/jobs\/[^/]+/,
    json({ job_id: "scroll-e2e", status: "completed" }),
  );
  await page.route(
    /chart-patterns\/scan(\?|$)/,
    json({ job_id: "scroll-e2e", status: "completed" }),
  );
  await page.route(
    /chart-patterns\/scan\/[^/]+/,
    json({ job_id: "scroll-e2e", status: "completed" }),
  );
  await page.route(/chart-patterns\/watch\/setups/, json({ setups: [] }));
  await page.route(/chart-patterns\/watch(\?|$)/, json({ items: [], total: 0 }));
  await page.route(/chart-patterns\/watch\/stream/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'event: meta\ndata: {"total":0}\n\nevent: done\ndata: {}\n\n',
    }),
  );
  await page.route(/chart-patterns\/market-status/, json({ open: false, holiday: false }));
  await page.route(/chart-patterns\/health/, json({ ok: true }));
  await page.route(
    /chart-patterns\/symbol\/[^/]+\/chart/,
    json({
      symbol: "RELIANCE",
      timeframe: "1D",
      candles: [],
      hits: [],
      trend_lines: [],
      data_through: null,
    }),
  );
}

const HEAVY_PATTERN_COUNT = 40;
const HEAVY_PATTERN_DEFS = [
  { id: "falling_wedge", name: "Falling Wedge", family: "reversal", direction: "bullish" },
  { id: "cup_handle", name: "Cup & Handle", family: "curve_cup", direction: "bullish" },
  {
    id: "ascending_triangle",
    name: "Ascending Triangle",
    family: "continuation",
    direction: "bullish",
  },
  { id: "bull_flag", name: "Bull Flag", family: "continuation", direction: "bullish" },
  { id: "double_bottom", name: "Double Bottom", family: "reversal", direction: "bullish" },
  { id: "head_shoulders", name: "Head & Shoulders", family: "reversal", direction: "bearish" },
  { id: "pennant", name: "Pennant", family: "continuation", direction: "neutral" },
  { id: "rectangle", name: "Rectangle", family: "continuation", direction: "neutral" },
] as const;

function heavyPatternHits() {
  return Array.from({ length: HEAVY_PATTERN_COUNT }, (_, i) => {
    const def = HEAVY_PATTERN_DEFS[i % HEAVY_PATTERN_DEFS.length];
    const symbol = `HEAVY${String(i + 1).padStart(2, "0")}`;
    const price = 100 + i * 7.5;
    return {
      id: 5000 + i,
      symbol,
      name: `${symbol} Industries`,
      timeframe: "1D",
      pattern_id: def.id,
      pattern_name: def.name,
      family: def.family,
      direction: def.direction,
      status: i % 3 === 0 ? "forming" : "confirmed",
      quality: i % 2 === 0 ? "strong" : "fair",
      confidence: 70 + (i % 25),
      start_date: "2026-08-01",
      end_date: "2026-09-28",
      start_price: price,
      end_price: price + 4,
      breakout_level: price + 5,
      target: price + 12,
      stop: price - 3,
      rr: 1.8,
      bars_ago: (i % 5) + 1,
      volume_confirmed: i % 2 === 0,
      trendlines: [],
      notes: "",
      last_close: price + 4,
      day_change_pct: i % 2 === 0 ? 1.25 : -0.75,
      range_pos: 62,
      to_52w_high: 3.5,
      candles: [],
    };
  });
}

const heavyPatternSummary = {
  scanned: 500,
  patterns: HEAVY_PATTERN_COUNT,
  in_view: HEAVY_PATTERN_COUNT,
  confirmed: 25,
  bullish: 30,
  bearish: 10,
  data_through: "2026-09-30",
  last_scan_at: new Date().toISOString(),
};

/** Override the empty sweep fixture with enough cards to force card scrolling. */
async function setupHeavyPatternData(page: Page) {
  const items = heavyPatternHits();
  await page.route(/chart-patterns\/summary/, fulfillJson(heavyPatternSummary));
  await page.route(/chart-patterns\/results(\?|$)/, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/stream")) {
      return route.abort();
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items,
        total: items.length,
        summary: heavyPatternSummary,
        data_through: heavyPatternSummary.data_through,
      }),
    });
  });
  // Force the GET /results path: the SSE fixture would otherwise win and paint
  // the empty meta payload from the base mock.
  await page.route(/chart-patterns\/results\/stream/, (route) => route.abort());
}

function heavyScreenerRows() {
  const base = mockTrendingResponse.approaching[0];
  return Array.from({ length: 40 }, (_, i) => ({
    ...base,
    symbol: `HEAVY${String(i + 1).padStart(2, "0")}`,
    score: 120 - i,
    interest_score: 120 - i,
    tv_price: base.tv_price + i,
    upstox_price: base.upstox_price + i,
    high_52w: base.high_52w + i,
    day_change: i % 2 === 0 ? 1.4 : -0.8,
    rationale: `Heavy scroll fixture row ${i + 1}`,
  }));
}

/** Override the small screener fixture with 40 rows for the table scroll owner. */
async function setupHeavyScreenerData(page: Page) {
  const rows = heavyScreenerRows();
  await page.route(apiRoute("screener"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path !== "/api/screener") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...mockTrendingResponse,
        approaching: rows,
        touched: [],
        last_updated: new Date().toISOString(),
      }),
    });
  });
}

function optionContract(strike: number, type: "CE" | "PE") {
  const call = type === "CE";
  return {
    trading_symbol: `NIFTY26MAR${strike}${type}`,
    strike_price: strike,
    instrument_type: type,
    market_data: {
      ltp: call ? 120 : 90,
      volume: call ? 15000 : 12000,
      oi: call ? 80000 : 70000,
      prev_oi: call ? 72000 : 65000,
      bid_price: call ? 118 : 88,
      ask_price: call ? 122 : 92,
    },
    option_greeks: {
      delta: call ? 0.55 : -0.45,
      iv: call ? 17 : 19,
      theta: call ? -5 : -4,
      gamma: 0.001,
      vega: 10,
    },
    sentiment: {
      type: call ? "Long Buildup" : "Long Unwinding",
      color: call ? "green" : "orange",
      label: call ? "LB" : "LU",
    },
  };
}

function heavyOptionChain() {
  return Array.from({ length: 40 }, (_, i) => {
    const strike = 23800 + i * 10;
    return {
      strike,
      ce: optionContract(strike, "CE"),
      pe: optionContract(strike, "PE"),
    };
  });
}

/** Override the small chain fixture so the table's own scrollport overflows. */
async function setupHeavyOptionsData(page: Page) {
  const chain = heavyOptionChain();
  await page.route(apiRoute("options/chain"), (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        underlying: "NIFTY",
        expiry: "2026-03-12",
        spot: 24000.5,
        timestamp: new Date().toISOString(),
        summary: {
          pcr: 0.95,
          max_pain: 24000,
          expected_move: { upper: 24200, lower: 23800, range: 200 },
          total_ce_oi: 1_000_000,
          total_pe_oi: 950_000,
          dte: 2,
        },
        chain,
      }),
    }),
  );
}

async function openRoute(
  page: Page,
  route: RouteCase,
  viewport: { width: number; height: number },
) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await setupApiMocks(page);
  await loginAsTestUser(page);
  if (route.report) await setupNiftyReportMocks(page);
  if (route.patterns) await setupPatternMocks(page);

  await page.goto(route.path);
  await expect(page.locator("#app-main")).toBeVisible();
  if (route.ready) {
    await expect(page.locator(route.ready)).toBeVisible({ timeout: 20_000 });
  }

  // Web fonts and lazy chunks can still change box heights after first paint.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

type ScrollMetrics = {
  missing: boolean;
  viewport: number;
  documentScrollHeight: number;
  bodyScrollHeight: number;
  mainScrollHeight: number;
  mainClientHeight: number;
  bodyOverflowY: string;
  mainOverflowY: string;
};

async function readScrollMetrics(page: Page): Promise<ScrollMetrics> {
  return page.evaluate(() => {
    const scrolling = document.scrollingElement as HTMLElement | null;
    const body = document.body;
    const main = document.getElementById("app-main");
    if (!scrolling || !main) {
      return {
        missing: true,
        viewport: 0,
        documentScrollHeight: 0,
        bodyScrollHeight: 0,
        mainScrollHeight: 0,
        mainClientHeight: 0,
        bodyOverflowY: "",
        mainOverflowY: "",
      };
    }
    return {
      missing: false,
      viewport: window.innerHeight,
      documentScrollHeight: scrolling.scrollHeight,
      bodyScrollHeight: body.scrollHeight,
      mainScrollHeight: main.scrollHeight,
      mainClientHeight: main.clientHeight,
      bodyOverflowY: getComputedStyle(body).overflowY,
      mainOverflowY: getComputedStyle(main).overflowY,
    };
  });
}

function containmentViolation(metrics: ScrollMetrics): string | null {
  if (metrics.missing) return "missing document.scrollingElement or #app-main";
  const tolerance = 1;
  const problems: string[] = [];
  if (metrics.documentScrollHeight > metrics.viewport + tolerance) {
    problems.push(`document ${metrics.documentScrollHeight} > viewport ${metrics.viewport}`);
  }
  if (metrics.bodyScrollHeight > metrics.viewport + tolerance) {
    problems.push(`body ${metrics.bodyScrollHeight} > viewport ${metrics.viewport}`);
  }
  if (metrics.mainScrollHeight > metrics.mainClientHeight + tolerance) {
    problems.push(`#app-main ${metrics.mainScrollHeight} > client ${metrics.mainClientHeight}`);
  }
  return problems.length > 0 ? `${problems.join("; ")} (${JSON.stringify(metrics)})` : null;
}

async function expectContained(page: Page, label: string) {
  await expect
    .poll(async () => containmentViolation(await readScrollMetrics(page)), {
      message: `${label} must fit the viewport`,
      timeout: 10_000,
    })
    .toBeNull();
}

async function expectInternalScroll(locator: Locator, label: string) {
  await expect(locator).toBeVisible();
  await expect
    .poll(
      async () => {
        const metrics = await locator.evaluate((el) => ({
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        }));
        return metrics.scrollHeight > metrics.clientHeight + 1
          ? "overflowing"
          : JSON.stringify(metrics);
      },
      { message: `${label} must own vertical overflow`, timeout: 10_000 },
    )
    .toBe("overflowing");
}

for (const viewport of VIEWPORTS) {
  test.describe(`scroll containment @ ${viewport.name}`, () => {
    for (const route of ROUTES) {
      test(`${route.name} (${route.path}) keeps document and #app-main still`, async ({ page }) => {
        await openRoute(page, route, viewport);
        await expectContained(page, `${route.path} at ${viewport.name}`);
      });
    }
  });

  test.describe(`data-heavy scroll owners @ ${viewport.name}`, () => {
    test("patterns keeps 40 result cards inside its own vertical region", async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await setupApiMocks(page);
      await loginAsTestUser(page);
      await setupPatternMocks(page);
      await setupHeavyPatternData(page);

      await page.goto("/patterns?view=grid");
      await expect(page.locator('[data-testid="patterns-page"]')).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(() => page.locator('[data-testid^="patterns-mini-chart-HEAVY"]').count())
        .toBe(HEAVY_PATTERN_COUNT);

      await expectInternalScroll(
        page.locator('[data-testid="patterns-grid-scroll-region"]'),
        `patterns grid at ${viewport.name}`,
      );
      await expectContained(page, `patterns grid at ${viewport.name}`);
    });

    test("screener keeps 40 rows inside the table scrollport", async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await setupApiMocks(page);
      await loginAsTestUser(page);
      await setupHeavyScreenerData(page);

      await page.goto("/screener/screener");
      await expect
        .poll(() => page.locator('[data-testid="stock-row-HEAVY01"]').count())
        .toBeGreaterThan(0);

      await expectInternalScroll(
        page.locator('[data-testid="screener-table-scroll-wrapper"] .paper-tanstack-scroll'),
        `screener table at ${viewport.name}`,
      );
      await expectContained(page, `screener table at ${viewport.name}`);
    });

    test("options keeps 40 strikes inside the chain scrollport", async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await setupApiMocks(page);
      await loginAsTestUser(page);
      await setupOptionsMocks(page);
      await setupHeavyOptionsData(page);

      await page.goto("/options");
      await expect(page.locator('[data-testid="options-view"]')).toBeVisible({
        timeout: 20_000,
      });
      await expect
        .poll(() => page.locator('[data-testid^="options-chain-row-"]').count())
        .toBeGreaterThan(0);

      await expectInternalScroll(
        page.locator('[data-testid="options-chain-table-scrollarea"]'),
        `options chain at ${viewport.name}`,
      );
      await expectContained(page, `options chain at ${viewport.name}`);
    });
  });
}
