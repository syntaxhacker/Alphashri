import { test, expect, type Page } from "@playwright/test";
import {
  setupApiMocks,
  setupUserConfigMocks,
  setupValueScanMocks,
  loginAsTestUser,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { collectConsoleErrors } from "./helpers/flowsB";

/**
 * Market -> Value view (V1). The whole stack is mocked: the market snapshot,
 * the pattern lookup, the saved-config endpoints and the value scan. The Deep
 * Value tab is exercised from the same stack to guard against its removal.
 */

const MOCK_ROWS = [
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", close: 1412.5, change: 1.2, relative_volume: 1.8, market_cap_cr: 1900000, cap_tier: "large", rsi: 62, adx: 28, pos_52w: 0.82, fno: true, etf: false },
  { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT", close: 3288.0, change: -0.4, relative_volume: 1.1, market_cap_cr: 1200000, cap_tier: "large", rsi: 45, adx: 22, pos_52w: 0.61, fno: true, etf: false },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Banks", close: 1712.3, change: 0.6, relative_volume: 0.9, market_cap_cr: 1300000, cap_tier: "large", rsi: 55, adx: 25, pos_52w: 0.74, fno: false, etf: false },
  { symbol: "PERSISTENT", name: "Persistent Systems", sector: "IT", close: 5120.0, change: 2.1, relative_volume: 2.4, market_cap_cr: 78000, cap_tier: "mid", rsi: 71, adx: 31, pos_52w: 0.88, fno: true, etf: false },
  { symbol: "MICROCO", name: "Micro Co", sector: "Services", close: 87.6, change: -2.2, relative_volume: 3.1, market_cap_cr: 900, cap_tier: "micro", rsi: 22, adx: 33, pos_52w: 0.18, fno: false, etf: false },
  { symbol: "NIFTYBEES", name: "Nippon India ETF Nifty BeES", sector: "ETF", close: 264.1, change: 0.5, relative_volume: 0.7, market_cap_cr: null, cap_tier: "etf", rsi: 48, adx: 18, pos_52w: 0.57, fno: false, etf: true },
];

const US_MOCK_ROWS = [
  { symbol: "AAPL", name: "Apple Inc", sector: "Technology", exchange: "NASDAQ", close: 189.5, change: 0.8, relative_volume: 1.4, marketCapUsdB: 2950, cap_tier: "large", rsi: 61, adx: 26, pos_52w: 0.87, fno: false, etf: false, currency: "USD" },
  { symbol: "MSFT", name: "Microsoft Corp", sector: "Technology", exchange: "NASDAQ", close: 415.2, change: -0.3, relative_volume: 1.0, marketCapUsdB: 3080, cap_tier: "large", rsi: 57, adx: 24, pos_52w: 0.79, fno: false, etf: false, currency: "USD" },
];

/** Chrome that belongs to the market table only — Value must not render any of it. */
const MARKET_ONLY_CHROME = [
  "market-search",
  "market-filter-rail",
  "market-rail-toggle",
  "market-result-count",
  "market-grid",
  "market-table-region",
  "market-refresh",
  "market-mode-badge",
  "market-active-chips",
];

const VALUE_SCAN = "/api/value/scan";

function valueScanResponse(market: string) {
  return (
    res: import("@playwright/test").Response,
  ) => res.url().includes(VALUE_SCAN) && res.url().includes(`market=${market}`);
}

async function setupMarketValueMocks(page: Page): Promise<string[]> {
  const consoleErrors = collectConsoleErrors(page);
  await setupApiMocks(page);
  await setupValueScanMocks(page);
  await loginAsTestUser(page);
  await setupUserConfigMocks(page);

  await page.route(apiRoute("market/snapshot"), async (route) => {
    const universe = new URL(route.request().url()).searchParams.get("universe");
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

  // The PATTERNS column must not reach the real API and log a 401 on every row.
  await page.route(apiRoute("chart-patterns/patterns/lookup"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timeframe: "1D",
        session: "2026-11-16",
        source: "stored",
        data_through: "2026-11-14",
        items: [],
      }),
    });
  });

  return consoleErrors;
}

async function openMarket(page: Page, query = "") {
  await page.goto(`/?tab=market${query}`);
  await expect(page.getByTestId("market-screener")).toBeVisible({ timeout: 20000 });
}

/** The universe Select is searchable: clear the previous label before choosing. */
async function pickUniverse(page: Page, label: string) {
  const combo = page.locator('[data-testid="market-universe-select"] [role="combobox"]');
  await combo.click();
  await combo.fill("");
  await page.getByRole("option", { name: label, exact: true }).click();
}

async function chooseView(page: Page, label: "Table" | "Value") {
  await page.getByTestId("market-view-toggle").getByText(label, { exact: true }).click();
}

/** Narrow layout puts the filter rail behind a drawer; wide layout is inline. */
async function applyLargeCapFilter(page: Page, narrow: boolean) {
  if (narrow) {
    await page.getByTestId("market-rail-toggle").click();
    await expect(page.getByTestId("market-filter-drawer")).toBeVisible();
  }
  await page.getByTestId("market-cap-large").click();
  if (narrow) {
    await page.getByTestId("market-rail-collapse").click();
    await expect(page.getByTestId("market-filter-drawer")).toHaveCount(0);
  }
}

for (const vp of [
  { label: "1600", width: 1600, height: 900 },
  { label: "390", width: 390, height: 844 },
]) {
  test.describe(`Market Value view (V1) @ ${vp.label}`, () => {
    let consoleErrors: string[] = [];

    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      consoleErrors = await setupMarketValueMocks(page);
    });

    test.afterEach(() => {
      expect(consoleErrors).toEqual([]);
    });

    test("Market → Value renders the value table and hides market-only chrome", async ({
      page,
    }) => {
      const indiaScan = page.waitForResponse(valueScanResponse("india"), { timeout: 20000 });
      await openMarket(page);
      await expect(page.locator('[data-testid^="market-row-"]').first()).toBeVisible();

      await chooseView(page, "Value");
      await indiaScan;

      await expect(page.getByTestId("market-value-region")).toBeVisible();
      await expect(page.getByTestId("value-table")).toBeVisible();
      await expect(page.getByTestId("value-row-SBILIFE")).toBeVisible();
      // One selector: the host universe stays, the embedded panel has no second one.
      await expect(page.getByTestId("market-universe-select")).toBeVisible();
      await expect(page.getByTestId("value-market-tabs")).toHaveCount(0);
      for (const id of MARKET_ONLY_CHROME) {
        await expect(page.getByTestId(id)).toHaveCount(0, { timeout: 5000 });
      }
    });

    test("the null-cap ETF row sorts last in the default mcap_desc grid", async ({ page }) => {
      await openMarket(page);
      await expect(page.locator('[data-testid^="market-row-"]')).toHaveCount(MOCK_ROWS.length);

      const order = await page
        .locator('[data-testid^="market-row-"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
      expect(order[order.length - 1]).toBe("market-row-NIFTYBEES");
      await expect(page.getByTestId("market-etf-NIFTYBEES")).toBeVisible();
    });

    test("Market universe drives the scan: USA → market=usa, All NSE → market=india", async ({
      page,
    }) => {
      await openMarket(page);
      await expect(page.locator('[data-testid^="market-row-"]').first()).toBeVisible();
      const combo = page.locator('[data-testid="market-universe-select"] [role="combobox"]');

      await pickUniverse(page, "USA");
      await expect(combo).toHaveValue("USA");

      const usaScan = page.waitForResponse(valueScanResponse("usa"), { timeout: 20000 });
      await chooseView(page, "Value");
      const usaRes = await usaScan;
      expect((await usaRes.json()).market).toBe("usa");
      await expect(page.getByTestId("value-table")).toBeVisible();

      const indiaScan = page.waitForResponse(valueScanResponse("india"), { timeout: 20000 });
      await pickUniverse(page, "All NSE");
      const indiaRes = await indiaScan;
      expect((await indiaRes.json()).market).toBe("india");
      await expect(combo).toHaveValue("All NSE");
      await expect(page.getByTestId("market-value-region")).toBeVisible();
    });

    test("switching back to Table restores rows, filters and search", async ({ page }) => {
      await openMarket(page);
      await applyLargeCapFilter(page, vp.width < 600);
      await expect(page.getByTestId("market-result-count")).toContainText(`3 / ${MOCK_ROWS.length}`);
      await page.getByRole("textbox", { name: /search symbols/i }).fill("reliance");
      await expect(page.getByTestId("market-result-count")).toContainText(`1 / ${MOCK_ROWS.length}`);
      await expect(page.getByTestId("market-row-RELIANCE")).toBeVisible();

      const scan = page.waitForResponse((res) => res.url().includes(VALUE_SCAN), {
        timeout: 20000,
      });
      await chooseView(page, "Value");
      await scan;
      await expect(page.getByTestId("value-table")).toBeVisible();
      await expect(page.getByTestId("market-search")).toHaveCount(0);

      await chooseView(page, "Table");
      await expect(page.getByTestId("market-search")).toHaveValue("reliance");
      await expect(page.getByTestId("market-filter-chip-capTier:large")).toBeVisible();
      await expect(page.getByTestId("market-row-RELIANCE")).toBeVisible();
      await expect(page.getByTestId("market-result-count")).toContainText(`1 / ${MOCK_ROWS.length}`);
      await expect(page.getByTestId("market-rail-toggle")).toBeVisible();
      await expect(page.getByTestId("value-table")).toHaveCount(0);
    });

    test("the retired Deep Value tab redirects to the Market value view", async ({ page }) => {
      // Deep Value is no longer a tab: it is the Market table's `value` view with
      // its filter rail. A legacy ?tab=deepvalue URL must land there, not 404 and
      // not show a standalone panel.
      await page.goto("/?tab=deepvalue");
      await expect(page.getByTestId("tab-deepvalue")).toHaveCount(0);
      await expect(page.getByTestId("market-value-region")).toBeVisible();
      await expect(page).toHaveURL(/view=value/);
    });

    test("?view=value round-trips through the URL", async ({ page }) => {
      await openMarket(page, "&view=value");
      await expect(page.getByTestId("market-value-region")).toBeVisible();
      await expect(page).toHaveURL(/[?&]view=value/);

      await chooseView(page, "Table");
      await expect(page.getByTestId("market-table-region")).toBeVisible();
      await expect(page).not.toHaveURL(/[?&]view=value/);

      await chooseView(page, "Value");
      await expect(page).toHaveURL(/[?&]view=value/);
      await expect(page.getByTestId("market-value-region")).toBeVisible();
    });
  });
}
