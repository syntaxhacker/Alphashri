import { test, expect, type Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, setupUserConfigMocks } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { collectConsoleErrors } from "./helpers/flowsB";

/**
 * Market Screener tab (`GET /api/market/snapshot`).
 *
 * The panel is fully mocked — no network, no backend required. The fixture
 * universe is built so every filter test has an unambiguous answer:
 *
 *   large : RELIANCE (rsi 62, fno) · TCS (rsi 45, fno) · HDFCBANK (rsi 55)
 *   mid   : PERSISTENT (rsi 71, fno) · COFORGE (rsi 38)
 *   small : KPITTECH (rsi 52)
 *   micro : MICROCO (rsi 22)
 *   class : NIFTYBEES (rsi 48) · LIQUIDBEES (rsi 50)
 *
 * The ETFs are production-shaped: `cap_tier: "etf"` (a class, not a size rung)
 * with a null market cap. They sort last in the default mcap_desc grid and only
 * the ETF tier selects them.
 *
 * `update_mode` is "streaming"; the Live-badge test pins the India session open
 * so the badge does not depend on the wall clock. The screener mounts at "/",
 * so tests navigate to "/?tab=market".
 */
const SNAPSHOT_PATH = "/?tab=market";

const MOCK_ROWS = [
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", exchange: "NSE", close: 1412.5, change: 1.2, relative_volume: 1.8, market_cap_cr: 1900000, cap_tier: "large", rsi: 62, adx: 28, pos_52w: 0.82, fno: true, etf: false },
  { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT", exchange: "NSE", close: 3288.0, change: -0.4, relative_volume: 1.1, market_cap_cr: 1200000, cap_tier: "large", rsi: 45, adx: 22, pos_52w: 0.61, fno: true, etf: false },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Banks", exchange: "NSE", close: 1712.3, change: 0.6, relative_volume: 0.9, market_cap_cr: 1300000, cap_tier: "large", rsi: 55, adx: 25, pos_52w: 0.74, fno: false, etf: false },
  { symbol: "PERSISTENT", name: "Persistent Systems", sector: "IT", exchange: "NSE", close: 5120.0, change: 2.1, relative_volume: 2.4, market_cap_cr: 78000, cap_tier: "mid", rsi: 71, adx: 31, pos_52w: 0.88, fno: true, etf: false },
  { symbol: "COFORGE", name: "Coforge", sector: "IT", exchange: "NSE", close: 6890.5, change: -1.3, relative_volume: 1.5, market_cap_cr: 41000, cap_tier: "mid", rsi: 38, adx: 19, pos_52w: 0.42, fno: false, etf: false },
  { symbol: "KPITTECH", name: "KPIT Technologies", sector: "IT", exchange: "NSE", close: 1834.75, change: 0.9, relative_volume: 1.3, market_cap_cr: 32000, cap_tier: "small", rsi: 52, adx: 24, pos_52w: 0.66, fno: false, etf: false },
  { symbol: "NIFTYBEES", name: "Nippon India ETF Nifty BeES", sector: "ETF", exchange: "NSE", close: 264.1, change: 0.5, relative_volume: 0.7, market_cap_cr: null, cap_tier: "etf", rsi: 48, adx: 18, pos_52w: 0.57, fno: false, etf: true },
  { symbol: "MICROCO", name: "Micro Co", sector: "Services", exchange: "NSE", close: 87.6, change: -2.2, relative_volume: 3.1, market_cap_cr: 900, cap_tier: "micro", rsi: 22, adx: 33, pos_52w: 0.18, fno: false, etf: false },
  { symbol: "LIQUIDBEES", name: "Nippon India ETF Liquid BeES", sector: "ETF", exchange: "NSE", close: 1130.2, change: 0.01, relative_volume: 0.3, market_cap_cr: null, cap_tier: "etf", rsi: 50, adx: 12, pos_52w: 0.51, fno: false, etf: true },
];

const ALL_SYMBOLS = MOCK_ROWS.map((row) => row.symbol);

function snapshotEnvelope(rows: typeof MOCK_ROWS = MOCK_ROWS) {
  return {
    as_of: new Date().toISOString(),
    universe: "all_equity",
    total: rows.length,
    update_mode: "streaming",
    rows,
  };
}

/**
 * Register the snapshot mock. `state.status` is read per request so a test can
 * flip 502 → 200 before clicking retry. Call before page.goto().
 */
async function mockMarketSnapshot(
  page: Page,
  state: { status: number } = { status: 200 },
  rows: typeof MOCK_ROWS = MOCK_ROWS,
) {
  await page.route(apiRoute("market/snapshot"), async (route) => {
    if (state.status !== 200) {
      await route.fulfill({
        status: state.status,
        contentType: "application/json",
        body: JSON.stringify({ detail: "market_snapshot_unavailable" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshotEnvelope(rows)),
    });
  });
}

/**
 * `POST /api/chart-patterns/patterns/lookup` — the PATTERNS column would
 * otherwise reach the real API and log a 401 for every page. Every request body
 * is recorded so a test can assert the window batching (one call per window,
 * never one per row).
 */
async function mockPatternLookup(page: Page, seeded: Record<string, string[]> = {}) {
  const requests: { symbols: string[]; timeframe?: string; universe?: string | null }[] = [];
  await page.route(apiRoute("chart-patterns/patterns/lookup"), async (route) => {
    const raw = route.request().postData();
    const body = raw ? (JSON.parse(raw) as typeof requests[number]) : { symbols: [] };
    requests.push(body);
    const items = body.symbols
      .filter((symbol) => seeded[symbol] !== undefined)
      .map((symbol) => ({
        symbol,
        count: seeded[symbol].length,
        patterns: seeded[symbol].map((direction, i) => ({
          pattern_id: `pat_${i}`,
          name: `${symbol} pattern ${i + 1}`,
          direction,
          status: "confirmed",
          quality: "strong",
          confidence: 80,
          bars_ago: 2,
        })),
      }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timeframe: "1D",
        session: "2026-11-16",
        source: "stored",
        data_through: "2026-11-14",
        items,
      }),
    });
  });
  return requests;
}

async function openMarketTab(
  page: Page,
  state?: { status: number },
  lookup?: { seed?: Record<string, string[]>; rows?: typeof MOCK_ROWS },
) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await mockMarketSnapshot(page, state, lookup?.rows);
  const lookupRequests = await mockPatternLookup(page, lookup?.seed);
  await page.goto(SNAPSHOT_PATH);
  await page.waitForSelector('[data-testid="market-screener"]', { timeout: 15000 });
  return { lookupRequests };
}

/**
 * Reads layout geometry in one browser round-trip. Nulls make a missing row
 * observable so a layout regression reports the actual shift instead of a
 * locator timeout.
 */
async function measureLayout(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="market-grid"]');
    const chips = document.querySelector('[data-testid="market-active-chips"]');
    return {
      gridTop: grid ? grid.getBoundingClientRect().top : null,
      chipsHeight: chips ? chips.getBoundingClientRect().height : null,
    };
  });
}

/** Positive means the document is wider than the viewport (horizontal scroll). */
async function measureOverflow(page: Page) {
  return page.evaluate(() => {
    const scrollWidth = document.documentElement.scrollWidth;
    const clientWidth = document.documentElement.clientWidth;
    return { scrollWidth, clientWidth, overflow: scrollWidth - clientWidth };
  });
}

test.describe("Market Screener tab", () => {
  const consoleErrors: string[] = [];
  /** The 502 test deliberately triggers a failed fetch — Chromium logs an
   * unsuppressable "Failed to load resource" for it. Only that test may waive it. */
  let allowResourceErrors = false;

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    allowResourceErrors = false;
    collectConsoleErrors(page);
  });

  test.afterEach(() => {
    const unexpected = allowResourceErrors
      ? consoleErrors.filter((text) => !text.includes("Failed to load resource"))
      : consoleErrors;
    expect(unexpected).toEqual([]);
  });

  test("loads the market tab, shows all rows and the result count", async ({ page }) => {
    await openMarketTab(page);

    await expect(page.locator('[data-testid="market-screener"]')).toBeVisible();
    await expect(page.locator('[data-testid="market-universe-select"]')).toBeVisible();

    for (const symbol of ALL_SYMBOLS) {
      await expect(page.locator(`[data-testid="market-row-${symbol}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-testid^="market-row-"]')).toHaveCount(MOCK_ROWS.length);
    await expect(page.locator('[data-testid="market-result-count"]')).toContainText(
      `${MOCK_ROWS.length} / ${MOCK_ROWS.length}`,
    );
  });

  test("cap filter (large) reduces rows and updates the count", async ({ page }) => {
    await openMarketTab(page);

    await page.locator('[data-testid="market-cap-large"]').click();

    for (const symbol of ["RELIANCE", "TCS", "HDFCBANK"]) {
      await expect(page.locator(`[data-testid="market-row-${symbol}"]`)).toBeVisible();
    }
    for (const symbol of ["PERSISTENT", "COFORGE", "KPITTECH", "NIFTYBEES", "MICROCO", "LIQUIDBEES"]) {
      await expect(page.locator(`[data-testid="market-row-${symbol}"]`)).toHaveCount(0);
    }
    await expect(page.locator('[data-testid="market-result-count"]')).toContainText(
      `3 / ${MOCK_ROWS.length}`,
    );
    await expect(page.locator('[data-testid="market-active-chips"]')).toBeVisible();
  });

  test("ETF tier keeps only ETF rows, labels the chip and shows the class group", async ({ page }) => {
    await openMarketTab(page);

    await page.locator('[data-testid="market-cap-etf"]').click();

    // Derive the contract from the payload: this is the tier the fixture rows
    // actually carry, not a hardcoded count that drifts with the fixture.
    const etfSymbols = MOCK_ROWS.filter((row) => row.cap_tier === "etf").map((row) => row.symbol);
    expect(etfSymbols.length).toBeGreaterThan(0);
    for (const symbol of etfSymbols) {
      await expect(page.locator(`[data-testid="market-row-${symbol}"]`)).toBeVisible();
    }
    for (const symbol of ALL_SYMBOLS.filter((s) => !etfSymbols.includes(s))) {
      await expect(page.locator(`[data-testid="market-row-${symbol}"]`)).toHaveCount(0);
    }
    await expect(page.locator('[data-testid^="market-row-"]')).toHaveCount(etfSymbols.length);
    await expect(page.locator('[data-testid="market-result-count"]')).toContainText(
      `${etfSymbols.length} / ${MOCK_ROWS.length}`,
    );
    await expect(page.locator('[data-testid="market-filter-chip-capTier:etf"]')).toContainText(
      "Cap: ETF",
    );
    await expect(
      page.getByTestId("market-filter-rail").getByText("Instrument class", { exact: true }),
    ).toBeVisible();
  });

  test("active filter row is fixed: applying/removing a filter never shifts the table", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await openMarketTab(page);

    const chips = page.locator('[data-testid="market-active-chips"]');
    const capLargeChip = page.locator('[data-testid="market-filter-chip-capTier:large"]');

    // Zero filters: the band stays mounted at a fixed 24px with a muted
    // placeholder, and chips never wrap (they scroll horizontally instead).
    await expect(chips).toBeVisible();
    await expect(page.locator('[data-testid="market-active-chips-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="market-row-RELIANCE"]')).toBeVisible();

    const css = await chips.evaluate((el) => {
      const s = getComputedStyle(el);
      return { wrap: s.flexWrap, overflowX: s.overflowX, whiteSpace: s.whiteSpace };
    });
    expect(css.wrap).toBe("nowrap");
    expect(css.overflowX).toBe("auto");
    expect(css.whiteSpace).toBe("nowrap");

    const { gridTop: top0, chipsHeight: height0 } = await measureLayout(page);
    expect(height0).toBe(24);

    // Apply Cap: Large from the filter rail. Wait on the result count and the
    // chip (web-first) before re-measuring — no fixed sleeps.
    await page.locator('[data-testid="market-cap-large"]').click();
    await expect(page.locator('[data-testid="market-result-count"]')).toContainText(
      `3 / ${MOCK_ROWS.length}`,
    );
    await expect(capLargeChip).toBeVisible();

    await expect.poll(async () => {
      const { gridTop } = await measureLayout(page);
      return gridTop === null || top0 === null ? Infinity : Math.abs(gridTop - top0);
    }).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await measureLayout(page)).chipsHeight).toBe(height0);

    // Remove the filter via its chip's × — the band must return to the exact
    // same geometry with the placeholder back.
    await capLargeChip.click();
    await expect(page.locator('[data-testid="market-result-count"]')).toContainText(
      `${MOCK_ROWS.length} / ${MOCK_ROWS.length}`,
    );
    await expect(page.locator('[data-testid="market-active-chips-empty"]')).toBeVisible();

    await expect.poll(async () => {
      const { gridTop } = await measureLayout(page);
      return gridTop === null || top0 === null ? Infinity : Math.abs(gridTop - top0);
    }).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await measureLayout(page)).chipsHeight).toBe(height0);
  });

  test("overflowing chip strip reveals a scroll affordance at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openMarketTab(page);

    const chips = page.locator('[data-testid="market-active-chips"]');
    const affordance = page.locator('[data-testid="market-active-chips-scroll-affordance"]');
    await expect(chips).toBeVisible();
    await expect(affordance).toHaveCount(0);

    // Narrow layout hides the rail behind a drawer — open it and stack enough
    // chips to exceed the ~390px strip width.
    await page.locator('[data-testid="market-rail-toggle"]').click();
    const drawer = page.locator('[data-testid="market-filter-drawer"]');
    await expect(drawer).toBeVisible();
    for (const tier of ["large", "mid", "small", "micro", "etf"]) {
      await page.locator(`[data-testid="market-cap-${tier}"]`).click();
    }
    await page.locator('[data-testid="market-filter-above-sma20"]').click();
    await page.locator('[data-testid="market-filter-above-sma50"]').click();
    await page.locator('[data-testid="market-filter-above-sma200"]').click();
    await page.locator('[data-testid="market-rail-collapse"]').click();
    await expect(drawer).toHaveCount(0);

    await expect(page.locator('[data-testid^="market-filter-chip-"]').first()).toBeVisible();
    await expect(affordance).toBeVisible();
    await expect(affordance).toHaveAttribute("aria-label", "Scroll filters");

    const before = await chips.evaluate((el) => el.scrollLeft);
    await affordance.click();
    await expect.poll(() => chips.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);

    await page.locator('[data-testid="market-reset"]').click();
    await expect(page.locator('[data-testid="market-active-chips-empty"]')).toBeVisible();
    await expect(affordance).toHaveCount(0);
  });

  test("RSI min filter combines with search", async ({ page }) => {
    await openMarketTab(page);

    // rsi >= 60 → RELIANCE (62) and PERSISTENT (71). No boundary values used.
    // aria-label="Minimum RSI" lands on the MUI TextField root (FormControl),
    // not the <input>; the spinbutton itself has no accessible name.
    await page.locator('[data-testid="market-filter-rsi-min"]').getByRole("spinbutton").fill("60");
    await expect(page.locator('[data-testid="market-result-count"]')).toContainText(
      `2 / ${MOCK_ROWS.length}`,
    );
    await expect(page.locator('[data-testid="market-row-RELIANCE"]')).toBeVisible();
    await expect(page.locator('[data-testid="market-row-PERSISTENT"]')).toBeVisible();

    // Search narrows the filtered set, not the raw universe.
    // TextInput drops aria-label entirely; the textbox's accessible name comes
    // from its placeholder ("Search symbol or name…").
    await page.getByRole("textbox", { name: /search symbols/i }).fill("reliance");
    await expect(page.locator('[data-testid="market-result-count"]')).toContainText(
      `1 / ${MOCK_ROWS.length}`,
    );
    await expect(page.locator('[data-testid="market-row-RELIANCE"]')).toBeVisible();
    await expect(page.locator('[data-testid="market-row-PERSISTENT"]')).toHaveCount(0);
  });

  test("reset restores all rows and clears the count", async ({ page }) => {
    await openMarketTab(page);

    await page.locator('[data-testid="market-cap-large"]').click();
    await expect(page.locator('[data-testid="market-result-count"]')).toContainText(
      `3 / ${MOCK_ROWS.length}`,
    );

    await page.locator('[data-testid="market-reset"]').click();

    await expect(page.locator('[data-testid^="market-row-"]')).toHaveCount(MOCK_ROWS.length);
    for (const symbol of ALL_SYMBOLS) {
      await expect(page.locator(`[data-testid="market-row-${symbol}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-testid="market-result-count"]')).toContainText(
      `${MOCK_ROWS.length} / ${MOCK_ROWS.length}`,
    );
  });

  test("F&O and ETF badges render on the matching rows only", async ({ page }) => {
    await openMarketTab(page);

    await expect(page.locator('[data-testid="market-fno-RELIANCE"]')).toBeVisible();

    await expect(page.locator('[data-testid="market-etf-NIFTYBEES"]')).toBeVisible();
    await expect(page.locator('[data-testid="market-etf-LIQUIDBEES"]')).toBeVisible();

    await expect(page.locator('[data-testid="market-fno-MICROCO"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="market-etf-MICROCO"]')).toHaveCount(0);
  });

  test("error state (502) shows market-error and a working retry", async ({ page }) => {
    allowResourceErrors = true;
    const state = { status: 502 };
    await openMarketTab(page, state);

    const alert = page.locator('[data-testid="market-error"]');
    await expect(alert).toBeVisible();

    const retry = page.locator('[data-testid="market-retry"]');
    await expect(retry).toBeVisible();

    // Backing off to 200 and clicking retry refetches successfully.
    state.status = 200;
    await retry.click();
    await expect(page.locator('[data-testid="market-row-RELIANCE"]')).toBeVisible();
    await expect(page.locator('[data-testid="market-result-count"]')).toContainText(
      `${MOCK_ROWS.length} / ${MOCK_ROWS.length}`,
    );
  });

  test("mode badge shows Live when update_mode is streaming", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__E2E_MOCK_MARKET_OPEN__ = true;
    });
    await openMarketTab(page);

    await expect(page.locator('[data-testid="market-mode-badge"]')).toHaveText(/live/i);
  });

  test("PATTERNS column shows a seeded badge and a dash for the rest", async ({ page }) => {
    await openMarketTab(page, undefined, { seed: { RELIANCE: ["bullish", "bullish"] } });

    await expect(page.locator('[data-testid="market-patterns-RELIANCE"]')).toBeVisible();
    await expect(page.locator('[data-testid="market-patterns-RELIANCE"]')).toHaveText("2▲");
    // A symbol the store has no hit for must read as a dash, not "0".
    await expect(page.locator('[data-testid="market-dash-TCS-patterns"]')).toHaveText("–");
  });

  test("changing the sort costs one lookup for the new window, not one per row", async ({ page }) => {
    // More rows than the 80-row window, so a re-sort really changes which
    // symbols are on screen.
    const manyRows = Array.from({ length: 100 }, (_, i) => ({
      symbol: `SYM${String(i).padStart(3, "0")}`,
      name: `Synthetic ${i}`,
      sector: i % 2 === 0 ? "Energy" : "IT",
      close: 100 + i,
      change: i % 5,
      relative_volume: 1,
      market_cap_cr: 1_000_000 - i * 1_000,
      cap_tier: "large",
      rsi: 50,
      adx: 20,
      pos_52w: 0.5,
      fno: false,
      etf: false,
    }));

    const region = page.locator('[data-testid="market-table-region"]');

    // Wait for the response, not just for the request to be recorded: the sort
    // below must not race an in-flight lookup. usePatternSummary clears
    // `data-patterns-loading` only after it has merged the response into its
    // per-symbol cache, so that flag is the observable "cache is warm" signal.
    const initialLookup = page.waitForResponse(
      (res) =>
        res.url().includes("/api/chart-patterns/patterns/lookup") &&
        res.request().method() === "POST",
    );
    const { lookupRequests } = await openMarketTab(page, undefined, { rows: manyRows });

    await initialLookup;
    await expect.poll(() => lookupRequests.length).toBe(1);
    expect(lookupRequests[0].symbols.length).toBe(80);
    await expect(region).not.toHaveAttribute("data-patterns-loading", "true");

    // Sorting by LTP reverses the window, so the newly mounted rows are new
    // symbols — one more batch request, never one per row.
    const sortLookup = page.waitForResponse(
      (res) =>
        res.url().includes("/api/chart-patterns/patterns/lookup") &&
        res.request().method() === "POST",
    );
    await page.click("#paper-tanstack-header-close");
    await sortLookup;
    await expect.poll(() => lookupRequests.length, { timeout: 5000 }).toBe(2);
    await expect(region).not.toHaveAttribute("data-patterns-loading", "true");

    // The second call only asks for what is not cached, and stays batched.
    expect(lookupRequests[1].symbols.length).toBeGreaterThan(1);
    expect(lookupRequests[1].symbols.length).toBeLessThanOrEqual(80);

    // Clicking again returns to the first window: fully cached, zero requests.
    await page.click("#paper-tanstack-header-close");
    // Both the reverted window (SYM000 is mounted again) and the settled
    // loading flag flush in the same reactive batch that would schedule a
    // third lookup. Waiting on them removes the need for a fixed sleep.
    await expect(page.locator('[data-testid="market-row-SYM000"]')).toBeVisible();
    await expect(region).not.toHaveAttribute("data-patterns-loading", "true");
    expect(lookupRequests.length).toBe(2);
  });
});

/**
 * US-universe coverage reuses the same mock stack as the India specs above:
 * one `market/snapshot` route that answers per `universe`, the shared pattern
 * lookup mock and the shared auth/config mocks. The row shape is the wire shape
 * the backend emits for USA — `currency: "USD"` + `marketCapUsdB` + a US
 * exchange, with no rupee cap field.
 */
const US_MOCK_ROWS = [
  { symbol: "AAPL", name: "Apple Inc", sector: "Technology", exchange: "NASDAQ", close: 189.5, change: 0.8, relative_volume: 1.4, marketCapUsdB: 2950, cap_tier: "large", rsi: 61, adx: 26, pos_52w: 0.87, fno: false, etf: false, currency: "USD" },
  { symbol: "MSFT", name: "Microsoft Corp", sector: "Technology", exchange: "NASDAQ", close: 415.2, change: -0.3, relative_volume: 1.0, marketCapUsdB: 3080, cap_tier: "large", rsi: 57, adx: 24, pos_52w: 0.79, fno: false, etf: false, currency: "USD" },
  { symbol: "JPM", name: "JPMorgan Chase", sector: "Financials", exchange: "NYSE", close: 212.7, change: 1.1, relative_volume: 1.2, marketCapUsdB: 610, cap_tier: "large", rsi: 64, adx: 29, pos_52w: 0.9, fno: false, etf: false, currency: "USD" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF", sector: "ETF", exchange: "AMEX", close: 558.4, change: 0.4, relative_volume: 1.6, marketCapUsdB: 580, cap_tier: "large", rsi: 59, adx: 21, pos_52w: 0.93, fno: false, etf: true, currency: "USD" },
];

async function mockUniverseSnapshots(page: Page, urls: string[]) {
  await page.route(apiRoute("market/snapshot"), async (route) => {
    const url = route.request().url();
    urls.push(url);
    const universe = new URL(url).searchParams.get("universe");
    const rows = universe === "us" ? US_MOCK_ROWS : MOCK_ROWS;
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

async function openMarketTabWithUniverses(page: Page) {
  const urls: string[] = [];
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupUserConfigMocks(page);
  await mockUniverseSnapshots(page, urls);
  await mockPatternLookup(page);
  await page.goto(SNAPSHOT_PATH);
  await page.waitForSelector('[data-testid="market-screener"]', { timeout: 15000 });
  return { urls };
}

/** The universe control is a native <select>; Playwright picks by option label. */
async function pickUniverse(page: Page, label: string) {
  await page.getByTestId("market-universe-select").locator("select").selectOption({ label });
}

test.describe("Market Screener — USA universe (USD)", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    collectConsoleErrors(page);
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("USA switches header/rows/request to USD and All NSE restores ₹ with a stable filter row", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const { urls } = await openMarketTabWithUniverses(page);

    const combo = page.getByTestId("market-universe-select").locator("select");
    const mcapHeader = page.locator('[id="paper-tanstack-header-market_cap_cr"]');
    const chips = page.locator('[data-testid="market-active-chips"]');

    // Baseline: India universe, zero filters.
    await expect(combo.locator("option:checked")).toHaveText("All NSE");
    await expect(mcapHeader).toContainText("MCAP ₹Cr");
    await expect(page.locator('[data-testid="market-close-RELIANCE"]')).toHaveText(/^₹/);
    await expect(chips).toBeVisible();
    await expect(page.locator('[data-testid="market-active-chips-empty"]')).toBeVisible();
    const baseline = await measureLayout(page);
    expect(baseline.chipsHeight).toBe(24);

    // Choose USA from the universe dropdown.
    await pickUniverse(page, "USA");

    await expect(combo.locator("option:checked")).toHaveText("USA");
    await expect
      .poll(() => urls.some((u) => new URL(u).searchParams.get("universe") === "us"))
      .toBe(true);
    await expect(page.locator('[data-testid="market-row-AAPL"]')).toBeVisible();
    await expect(mcapHeader).toContainText("MCAP $B");
    await expect(page.locator('[data-testid="market-close-AAPL"]')).toHaveText(/^\$/);
    await expect(page.locator('[data-testid="market-mcap-AAPL"]')).toHaveText(/^\$[\d,.]+B$/);
    await expect(page.locator('[data-testid="market-filter-price"]')).toContainText("Price $");

    // Apply the two unit-bound US filters so the switch-back has something to clear.
    await page.locator('[data-testid="market-cap-large"]').click();
    await page
      .locator('[data-testid="market-filter-price-min"]')
      .getByRole("spinbutton")
      .fill("100");
    const capChip = page.locator('[data-testid="market-filter-chip-capTier:large"]');
    const priceChip = page.locator('[data-testid="market-filter-chip-price"]');
    await expect(capChip).toBeVisible();
    await expect(priceChip).toBeVisible();

    const usMeasured = await measureLayout(page);
    expect(usMeasured.chipsHeight).toBe(24);
    expect(Math.abs(usMeasured.gridTop! - baseline.gridTop!)).toBeLessThanOrEqual(1);

    // Switch back: US-only filters are dropped, ₹ formatting returns.
    await pickUniverse(page, "All NSE");

    await expect(combo.locator("option:checked")).toHaveText("All NSE");
    await expect(page.locator('[data-testid="market-row-RELIANCE"]')).toBeVisible();
    await expect(mcapHeader).toContainText("MCAP ₹Cr");
    await expect(page.locator('[data-testid="market-close-RELIANCE"]')).toHaveText(/^₹/);
    await expect(capChip).toHaveCount(0);
    await expect(priceChip).toHaveCount(0);

    await expect.poll(async () => {
      const { gridTop } = await measureLayout(page);
      return gridTop === null || baseline.gridTop === null
        ? Infinity
        : Math.abs(gridTop - baseline.gridTop);
    }).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await measureLayout(page)).chipsHeight).toBe(24);
  });

  /**
   * Regression guard for universe-aware chip descriptors: the panel must pass
   * the selected universe to buildMarketFilterChips, or a US cap tier reads the
   * bare India label ("Cap: Large"/"MCap … Cr") instead of "$B" bounds.
   */
  test("US cap-tier chip label uses $B bounds, not ₹/Cr", async ({ page }) => {
    await openMarketTabWithUniverses(page);
    const combo = page.getByTestId("market-universe-select").locator("select");
    await pickUniverse(page, "USA");
    await expect(combo.locator("option:checked")).toHaveText("USA");

    await page.locator('[data-testid="market-cap-large"]').click();
    const capChip = page.locator('[data-testid="market-filter-chip-capTier:large"]');
    await expect(capChip).toContainText("Cap: Large 10–200B");
    await expect(capChip).not.toContainText("₹");
    await expect(capChip).not.toContainText("Cr");
  });

  /**
   * 390px regression: the rail collapses into a drawer, so the USD labels and
   * the unit-bound chips must be asserted through that drawer while the
   * always-mounted chip row and the table keep their geometry across a
   * universe switch.
   */
  test("390px: USA drawer shows USD labels, table stays stable with no body overflow, All NSE restores ₹", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { urls } = await openMarketTabWithUniverses(page);

    const combo = page.getByTestId("market-universe-select").locator("select");
    const mcapHeader = page.locator('[id="paper-tanstack-header-market_cap_cr"]');
    const chips = page.locator('[data-testid="market-active-chips"]');
    const railToggle = page.locator('[data-testid="market-rail-toggle"]');
    const drawer = page.locator('[data-testid="market-filter-drawer"]');
    const railCollapse = page.locator('[data-testid="market-rail-collapse"]');

    // 1. Narrow layout hides the rail behind a drawer. Open it on the India
    // baseline, then close it so the toolbar is reachable for the switch.
    await expect(railToggle).toBeVisible();
    await railToggle.click();
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Price ₹");
    await railCollapse.click();
    await expect(drawer).toHaveCount(0);

    await expect(combo.locator("option:checked")).toHaveText("All NSE");
    await expect(mcapHeader).toContainText("MCAP ₹Cr");
    const baseline = await measureLayout(page);
    expect(baseline.chipsHeight).toBe(24);
    expect((await measureOverflow(page)).overflow).toBeLessThanOrEqual(0);

    // 2. Pick USA from the toolbar (drawer closed — it is a fixed overlay).
    await pickUniverse(page, "USA");
    await expect(combo.locator("option:checked")).toHaveText("USA");
    await expect
      .poll(() => urls.some((u) => new URL(u).searchParams.get("universe") === "us"))
      .toBe(true);
    await expect(page.locator('[data-testid="market-row-AAPL"]')).toBeVisible();

    // 3. USD table + drawer rail labels.
    await expect(mcapHeader).toContainText("MCAP $B");
    const usHeaderText = await mcapHeader.textContent();
    await expect(page.locator('[data-testid="market-close-AAPL"]')).toHaveText(/^\$/);
    await expect(page.locator('[data-testid="market-mcap-AAPL"]')).toHaveText(/^\$[\d,.]+B$/);

    await railToggle.click();
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Price $");
    const usTierLabels = ["Large 10–200B", "Mid 2–10B", "Small 0.3–2B", "Micro <0.3B"];
    for (const label of usTierLabels) {
      await expect(drawer).toContainText(label);
    }
    const railText = (await drawer.innerText())
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^(Price|Large|Mid|Small|Micro)\b/.test(line));
    const priceLabel =
      (await page.locator('[data-testid="market-filter-price"]').innerText())
        .split("\n")
        .map((line) => line.trim())
        .find((line) => /^price\b/i.test(line)) ?? "";

    // Apply a US filter from inside the drawer so the chip row carries a USD
    // chip; close the drawer again before measuring the underlying layout.
    await page.locator('[data-testid="market-cap-large"]').click();
    await railCollapse.click();
    await expect(drawer).toHaveCount(0);

    const capChip = page.locator('[data-testid="market-filter-chip-capTier:large"]');
    await expect(capChip).toBeVisible();
    await expect(capChip).toContainText("Large 10–200B");
    await expect(chips).not.toContainText("₹");
    await expect(chips).not.toContainText("Cr");

    // 4. The always-mounted chip row stays 24px and the table top does not move.
    const usMeasured = await measureLayout(page);
    expect(usMeasured.chipsHeight).toBe(24);
    expect(Math.abs(usMeasured.gridTop! - baseline.gridTop!)).toBeLessThanOrEqual(1);

    // 5. No horizontal body overflow at 390 in the densest (USD + chip) state.
    const overflowUS = await measureOverflow(page);
    await expect.poll(async () => (await measureOverflow(page)).overflow).toBeLessThanOrEqual(0);

    // 6. Switch back: US-only filters are dropped, ₹ formatting returns.
    await pickUniverse(page, "All NSE");
    await expect(combo.locator("option:checked")).toHaveText("All NSE");
    await expect(page.locator('[data-testid="market-row-RELIANCE"]')).toBeVisible();
    await expect(mcapHeader).toContainText("MCAP ₹Cr");
    await expect(page.locator('[data-testid="market-close-RELIANCE"]')).toHaveText(/^₹/);
    await expect(capChip).toHaveCount(0);

    await expect.poll(async () => {
      const { gridTop } = await measureLayout(page);
      return gridTop === null || baseline.gridTop === null
        ? Infinity
        : Math.abs(gridTop - baseline.gridTop);
    }).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await measureLayout(page)).chipsHeight).toBe(24);

    console.log(
      `[us-mobile] usHeader="${usHeaderText}" finalHeader="${await mcapHeader.textContent()}" priceLabel="${priceLabel}" rail=${JSON.stringify(railText)} baselineTop=${baseline.gridTop} usTop=${usMeasured.gridTop} chips=${usMeasured.chipsHeight} overflow=${overflowUS.overflow} (${overflowUS.scrollWidth}/${overflowUS.clientWidth})`,
    );
  });
});
