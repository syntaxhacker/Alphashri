import { test, expect, type Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

/**
 * E2E spec for the Chart Patterns page (`/patterns`).
 *
 * The feature talks to a real backend (`/api/chart-patterns/*`), so this spec
 * mocks those responses with realistic DTOs matching CONTRACT.md §5. Auth uses
 * the shared `setupApiMocks` + `loginAsTestUser` helpers.
 *
 * No `waitForTimeout` — web-first assertions only.
 */

// --------------------------------------------------------------------------- //
// Realistic mock DTOs (CONTRACT §5)
// --------------------------------------------------------------------------- //

const mockTimeframes = {
  timeframes: [
    { id: "1m", label: "1m", minutes: 1, native: "minutes/1", source_tf: null, max_lookback_days: 30, min_bars: 60 },
    { id: "5m", label: "5m", minutes: 5, native: "minutes/5", source_tf: null, max_lookback_days: 90, min_bars: 60 },
    { id: "15m", label: "15m", minutes: 15, native: "minutes/15", source_tf: null, max_lookback_days: 90, min_bars: 60 },
    { id: "1h", label: "1h", minutes: 60, native: "hours/1", source_tf: null, max_lookback_days: 365, min_bars: 60 },
    { id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 },
  ],
};

const mockUniverses = {
  universes: [
    { id: "nifty500", label: "Nifty 500", count: 500 },
    { id: "nifty50", label: "Nifty 50", count: 50 },
    { id: "nse_eq", label: "NSE EQ", count: 2670 },
  ],
  default: "nifty500",
};

const mockPatterns = {
  families: [
    { id: "reversal", label: "Reversal" },
    { id: "continuation", label: "Continuation" },
    { id: "curve_cup", label: "Curve / Cup" },
  ],
  patterns: [
    { pattern_id: "falling_wedge", name: "Falling Wedge", family: "reversal", direction: "bullish", description: "Converging down trendlines, bullish resolution." },
    { pattern_id: "rising_wedge", name: "Rising Wedge", family: "reversal", direction: "bearish", description: "Converging up trendlines, bearish resolution." },
    { pattern_id: "head_shoulders", name: "Head & Shoulders", family: "reversal", direction: "bearish", description: "Three peaks, lower highs." },
    { pattern_id: "inverse_head_shoulders", name: "Inverse H&S", family: "reversal", direction: "bullish", description: "Three troughs, higher lows." },
    { pattern_id: "double_bottom", name: "Double Bottom", family: "reversal", direction: "bullish", description: "W shape." },
    { pattern_id: "triple_bottom", name: "Triple Bottom", family: "reversal", direction: "bullish", description: "Three equal lows." },
    { pattern_id: "rounding_bottom", name: "Rounding Bottom", family: "reversal", direction: "bullish", description: "Saucer base." },
    { pattern_id: "diamond_bottom", name: "Diamond Bottom", family: "reversal", direction: "bullish", description: "Diamond reversal." },
    { pattern_id: "ascending_channel", name: "Ascending Channel", family: "continuation", direction: "bullish", description: "Parallel rising channel." },
    { pattern_id: "descending_channel", name: "Descending Channel", family: "continuation", direction: "bearish", description: "Parallel falling channel." },
    { pattern_id: "bull_flag", name: "Bull Flag", family: "continuation", direction: "bullish", description: "Pole + consolidation." },
    { pattern_id: "bear_flag", name: "Bear Flag", family: "continuation", direction: "bearish", description: "Inverse pole + consolidation." },
    { pattern_id: "pennant", name: "Pennant", family: "continuation", direction: "bullish", description: "Small symmetrical flag." },
    { pattern_id: "rectangle", name: "Rectangle (unresolved range)", family: "continuation", direction: "neutral", description: "Horizontal range." },
    { pattern_id: "ascending_triangle", name: "Ascending Triangle", family: "continuation", direction: "bullish", description: "Flat top, rising lows." },
    { pattern_id: "descending_triangle", name: "Descending Triangle", family: "continuation", direction: "bearish", description: "Flat bottom, falling highs." },
    { pattern_id: "curve_bearish", name: "Curve Pattern (Bearish)", family: "curve_cup", direction: "bearish", description: "Inverted saucer." },
    { pattern_id: "cup_handle", name: "Cup & Handle", family: "curve_cup", direction: "bullish", description: "Cup + handle breakout." },
  ],
};

const summary = {
  scanned: 500,
  patterns: 42,
  in_view: 8,
  confirmed: 5,
  bullish: 6,
  bearish: 2,
  data_through: "2026-10-02",
  // Recent timestamp so the fresh-scan guard (`isScanStale`) does not trigger an
  // unwanted auto-scan that would mask the cards with the loading state.
  last_scan_at: new Date().toISOString(),
};

type Hit = {
  id: number;
  symbol: string;
  name: string;
  timeframe: string;
  pattern_id: string;
  pattern_name: string;
  family: string;
  direction: string;
  status: string;
  quality: string;
  confidence: number;
  start_date: string;
  end_date: string;
  start_price: number;
  end_price: number;
  breakout_level: number;
  target: number;
  stop: number;
  rr: number;
  bars_ago: number;
  volume_confirmed: boolean;
  trendlines: Array<Array<{ t: string; price: number }>>;
  notes: string;
};

const allHits: Hit[] = [
  {
    id: 101,
    symbol: "IRCON",
    name: "IRCON International Ltd.",
    timeframe: "1D",
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 78.4,
    start_date: "2026-04-26",
    end_date: "2026-09-26",
    start_price: 129.8,
    end_price: 112.6,
    breakout_level: 112.6,
    target: 129.6,
    stop: 102.5,
    rr: 1.7,
    bars_ago: 1,
    volume_confirmed: true,
    trendlines: [
      [{ t: "2026-04-26", price: 129.8 }, { t: "2026-09-26", price: 112.6 }],
      [{ t: "2026-04-26", price: 118.2 }, { t: "2026-09-26", price: 108.9 }],
    ],
    notes: "Converging wedge with volume on breakout (Rs112.6).",
  },
  {
    id: 102,
    symbol: "TCS",
    name: "Tata Consultancy Services Ltd.",
    timeframe: "1D",
    pattern_id: "cup_handle",
    pattern_name: "Cup & Handle",
    family: "curve_cup",
    direction: "bullish",
    status: "forming",
    quality: "fair",
    confidence: 60.2,
    start_date: "2026-03-10",
    end_date: "2026-09-28",
    start_price: 3800.0,
    end_price: 4120.0,
    breakout_level: 4150.0,
    target: 4600.0,
    stop: 3950.0,
    rr: 2.1,
    bars_ago: 2,
    volume_confirmed: false,
    trendlines: [[{ t: "2026-03-10", price: 3800.0 }, { t: "2026-09-28", price: 4120.0 }]],
    notes: "Handle forming 2% below rim.",
  },
  {
    id: 103,
    symbol: "INFY",
    name: "Infosys Ltd.",
    timeframe: "1D",
    pattern_id: "head_shoulders",
    pattern_name: "Head & Shoulders",
    family: "reversal",
    direction: "bearish",
    status: "confirmed",
    quality: "fair",
    confidence: 66.0,
    start_date: "2026-05-02",
    end_date: "2026-09-25",
    start_price: 1900.0,
    end_price: 1820.0,
    breakout_level: 1815.0,
    target: 1680.0,
    stop: 1885.0,
    rr: 1.4,
    bars_ago: 3,
    volume_confirmed: true,
    trendlines: [[{ t: "2026-05-02", price: 1900.0 }, { t: "2026-09-25", price: 1820.0 }]],
    notes: "Neckline break confirmed with volume.",
  },
];

const jobDto = {
  job_id: "cpj_test0001",
  universe: "nifty500",
  timeframe: "1D",
  status: "completed",
  total: 500,
  done: 500,
  failed: 3,
  skipped: 40,
  queue_position: null,
  started_at: "2026-10-03T09:15:00",
  finished_at: "2026-10-03T09:16:00",
  data_through: "2026-10-02",
  error: null,
};

function filteredHits(url: URL): Hit[] {
  let hits = [...allHits];
  const dirs = url.searchParams.getAll("direction");
  const families = url.searchParams.getAll("family");
  const statuses = url.searchParams.getAll("status");
  const symbols = url.searchParams.getAll("symbol");
  if (dirs.length) hits = hits.filter((h) => dirs.map((d) => d.toLowerCase()).includes(h.direction));
  if (families.length) hits = hits.filter((h) => families.includes(h.family));
  if (statuses.length) hits = hits.filter((h) => statuses.includes(h.status));
  if (symbols.length) hits = hits.filter((h) => symbols.includes(h.symbol));
  const q = url.searchParams.get("q");
  if (q) {
    const needle = q.toLowerCase();
    hits = hits.filter(
      (h) => h.symbol.toLowerCase().includes(needle) || h.name.toLowerCase().includes(needle),
    );
  }
  return hits;
}

function candlesFor(symbol: string) {
  const base = symbol === "INFY" ? 1820 : symbol === "TCS" ? 4120 : 112;
  const out: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }> = [];
  for (let i = 0; i < 40; i++) {
    const drift = Math.sin(i / 4) * base * 0.02;
    const c = base + drift;
    out.push({
      t: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:00`,
      o: c - base * 0.005,
      h: c + base * 0.01,
      l: c - base * 0.01,
      c,
      v: 100000 + i * 1000,
    });
  }
  return out;
}

async function setupChartPatternsMocks(page: Page) {
  // Register broad → specific (Playwright: last registered handler wins).
  await page.route(apiRoute("chart-patterns"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.route(apiRoute("chart-patterns/timeframes"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockTimeframes) });
  });

  await page.route(apiRoute("chart-patterns/universes"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUniverses) });
  });

  await page.route(apiRoute("chart-patterns/patterns"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockPatterns) });
  });

  await page.route(apiRoute("chart-patterns/jobs"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobs: [jobDto] }) });
  });

  await page.route(apiRoute("chart-patterns/jobs/[^/]+"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(jobDto) });
  });

  await page.route(apiRoute("chart-patterns/scan"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ job_id: "cpj_test0002", status: "running", queue_position: 0, queue_size: 1 }),
    });
  });

  await page.route(apiRoute("chart-patterns/results"), async (route) => {
    const url = new URL(route.request().url());
    const items = filteredHits(url);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items, total: items.length, summary, data_through: summary.data_through }),
    });
  });

  await page.route(apiRoute("chart-patterns/summary"), async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(summary) });
  });

  // Symbol search backs the multi-symbol picker.
  await page.route(apiRoute("symbols/search"), async (route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get("q") || "").toUpperCase();
    const allSymbols = [
      { symbol: "IRCON", name: "IRCON International Ltd." },
      { symbol: "TCS", name: "Tata Consultancy Services Ltd." },
      { symbol: "INFY", name: "Infosys Ltd." },
    ];
    const results = allSymbols.filter(
      (s) => s.symbol.includes(q) || s.name.toUpperCase().includes(q),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results, query: q, total: results.length }),
    });
  });

  // The detail regex is unanchored, so it also matches `/symbol/X/chart`.
  // Register it FIRST so the more specific chart handler (registered last) wins.
  await page.route(apiRoute("chart-patterns/symbol/[^/]+"), async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split("/");
    const symbol = decodeURIComponent(parts[parts.indexOf("symbol") + 1]);
    const hits = allHits.filter((h) => h.symbol === symbol);
    const detail = hits[0] ?? allHits[0];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol: detail.symbol,
        name: detail.name,
        last_close: detail.end_price,
        day_change_pct: 1.2,
        history_bars: 250,
        timeframes: mockTimeframes.timeframes,
        counts: { confirmed: hits.filter((h) => h.status === "confirmed").length, forming: hits.filter((h) => h.status === "forming").length },
        patterns: hits,
      }),
    });
  });

  await page.route(apiRoute("chart-patterns/symbol/[^/]+/chart"), async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split("/");
    const symbol = decodeURIComponent(parts[parts.indexOf("symbol") + 1]);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbol,
        timeframe: url.searchParams.get("timeframe") || "1D",
        candles: candlesFor(symbol),
        overlays: [{ pattern_id: "falling_wedge", trendlines: allHits[0].trendlines }],
      }),
    });
  });
}

/**
 * Change the timeframe select. Handles both a native <select> and an MUI Select
 * (contract mandates the testid; either implementation is accepted).
 */
async function chooseTimeframe(page: Page, label: string) {
  const select = page.locator('[data-testid="patterns-timeframe-select"]');
  await expect(select).toBeVisible();
  const tag = await select.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "select") {
    await select.selectOption({ label });
    await expect(select.locator("option:checked")).toHaveText(label);
  } else {
    await select.click();
    const option = page.getByRole("option", { name: label, exact: true });
    await expect(option).toBeVisible();
    await option.click();
    await expect(select).toContainText(label);
  }
}

/**
 * Apply a "bearish" filter using whichever control the filter rail exposes
 * (checkbox/switch/radio, button, MUI select or plain text). Returns the
 * strategy used, or null when no recognisable control exists.
 */
async function applyBearishFilter(page: Page): Promise<string | null> {
  const rail = page.locator('[data-testid="patterns-filter-rail"]');
  await expect(rail).toBeVisible();
  const nameRe = /bearish/i;

  for (const role of ["checkbox", "switch", "radio"]) {
    const ctrl = rail.getByRole(role as "checkbox" | "switch" | "radio", { name: nameRe });
    if (await ctrl.count()) {
      await ctrl.first().click();
      return role;
    }
  }

  const btn = rail.getByRole("button", { name: nameRe });
  if (await btn.count()) {
    await btn.first().click();
    return "button";
  }

  const text = rail.getByText(/^\s*bearish\s*$/i);
  if (await text.count()) {
    await text.first().click();
    return "text";
  }

  const combo = rail.getByRole("combobox");
  if (await combo.count()) {
    await combo.first().click();
    const opt = page.getByRole("option", { name: nameRe });
    if (await opt.count()) {
      await opt.first().click();
      return "select";
    }
    await page.keyboard.press("Escape");
  }

  const input = rail.locator('input[type="text"], input[type="search"], input:not([type])').first();
  if (await input.count()) {
    await input.fill("INFY");
    return "symbol";
  }

  return null;
}

test.describe("Chart Patterns page", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupChartPatternsMocks(page);
    await page.goto("/patterns");
  });

  test("renders the patterns page", async ({ page }) => {
    await expect(page.locator('[data-testid="patterns-page"]')).toBeVisible();
  });

  test("shows the universe bar and scan-again control", async ({ page }) => {
    await expect(page.locator('[data-testid="patterns-universe-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="patterns-scan-again"]')).toBeVisible();
  });

  test("shows the stat strip with summary values", async ({ page }) => {
    await expect(page.locator('[data-testid="patterns-stats"]')).toBeVisible();
    await expect(page.locator('[data-testid="patterns-stat-scanned"]')).toContainText("500");
    await expect(page.locator('[data-testid="patterns-stat-patterns"]')).toContainText("42");
    await expect(page.locator('[data-testid="patterns-stat-in_view"]')).toContainText("8");
    await expect(page.locator('[data-testid="patterns-stat-confirmed"]')).toContainText("5");
    await expect(page.locator('[data-testid="patterns-stat-bull_bear"]')).toBeVisible();
    await expect(page.locator('[data-testid="patterns-stat-data_through"]')).toContainText("2026-10-02");
  });

  test("switching the timeframe select updates the value", async ({ page }) => {
    await expect(page.locator('[data-testid="patterns-timeframe-select"]')).toBeVisible();
    await chooseTimeframe(page, "5m");
  });

  test("filter rail filters the cards", async ({ page }) => {
    await expect(page.locator('[data-testid="patterns-filter-rail"]')).toBeVisible();
    await expect(page.locator('[data-testid="patterns-card"]').first()).toBeVisible();
    const before = await page.locator('[data-testid="patterns-card"]').count();

    const strategy = await applyBearishFilter(page);
    expect(strategy, "filter rail exposes no recognisable filter control (see CONTRACT testids)").not.toBeNull();

    await expect
      .poll(async () => page.locator('[data-testid="patterns-card"]').count(), { timeout: 10000 })
      .toBeLessThan(before);
  });

  test("renders at least one pattern card", async ({ page }) => {
    await expect(page.locator('[data-testid="patterns-card"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="patterns-card-IRCON-falling_wedge"]')).toBeVisible();
  });

  test("clicking a card opens the fullscreen chart", async ({ page }) => {
    const card = page.locator('[data-testid="patterns-card"]').first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.locator('[data-testid="patterns-fullscreen-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="patterns-fullscreen-chart"]')).toBeVisible();
  });

  test("clicking a specific card opens its fullscreen chart", async ({ page }) => {
    const card = page.locator('[data-testid="patterns-card-IRCON-falling_wedge"]');
    await expect(card).toBeVisible();
    await card.click();
    const modal = page.locator('[data-testid="patterns-fullscreen-modal"]');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("IRCON");
    await expect(page.locator('[data-testid="patterns-fullscreen-chart"]')).toBeVisible();
  });

  test("clicking the expand icon opens the fullscreen chart", async ({ page }) => {
    const expand = page.locator('[data-testid="patterns-card-expand-IRCON-falling_wedge"]');
    await expect(expand).toBeVisible();
    await expand.click();
    await expect(page.locator('[data-testid="patterns-fullscreen-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="patterns-fullscreen-chart"]')).toBeVisible();
  });

  test("shows the last completed scan time", async ({ page }) => {
    const cell = page.locator('[data-testid="patterns-stat-last_scan"]');
    await expect(cell).toBeVisible();
    await expect(cell).not.toContainText("—");
  });

  test("deep-linking restores filters from the URL", async ({ page }) => {
    await page.goto("/patterns?direction=bearish");
    await expect(page.locator('[data-testid="patterns-card"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="patterns-card-INFY-head_shoulders"]')).toBeVisible();
  });

  test("mirrors a filter change into the URL", async ({ page }) => {
    await page.locator('[data-testid="patterns-direction-bearish"]').click();
    await expect(page).toHaveURL(/direction=bearish/);
    await expect(page.locator('[data-testid="patterns-card"]')).toHaveCount(1);
  });

  test("multi-symbol picker narrows the cards to the chosen symbol", async ({ page }) => {
    const filter = page.locator('[data-testid="patterns-symbol-filter"]');
    const input = filter.getByRole("combobox");
    await input.click();
    await input.pressSequentially("IRCON", { delay: 30 });
    const option = page.getByRole("option", { name: /IRCON/ });
    await expect(option).toBeVisible();
    await option.click();

    await expect(page.locator('[data-testid="patterns-card"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="patterns-card-IRCON-falling_wedge"]')).toBeVisible();
  });

  test("results search filters the cards by symbol or company name", async ({ page }) => {
    await page.getByPlaceholder("Symbol or company").fill("infy");
    await expect(page.locator('[data-testid="patterns-card"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="patterns-card-INFY-head_shoulders"]')).toBeVisible();
  });
});
