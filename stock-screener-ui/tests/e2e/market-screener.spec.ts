import { test, expect, type Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { setupEventsMocks } from "../mocks/eventResponses";
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
 *   small : KPITTECH (rsi 52) · NIFTYBEES (rsi 48, etf)
 *   micro : MICROCO (rsi 22) · LIQUIDBEES (rsi 50, etf)
 *
 * `update_mode` is "streaming" so the mode badge renders "Live". The screener
 * mounts at "/", so tests navigate to "/?tab=market".
 */
const SNAPSHOT_PATH = "/?tab=market";

const MOCK_ROWS = [
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", close: 1412.5, change: 1.2, relative_volume: 1.8, market_cap_cr: 1900000, cap_tier: "large", rsi: 62, adx: 28, pos_52w: 0.82, fno: true, etf: false },
  { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT", close: 3288.0, change: -0.4, relative_volume: 1.1, market_cap_cr: 1200000, cap_tier: "large", rsi: 45, adx: 22, pos_52w: 0.61, fno: true, etf: false },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Banks", close: 1712.3, change: 0.6, relative_volume: 0.9, market_cap_cr: 1300000, cap_tier: "large", rsi: 55, adx: 25, pos_52w: 0.74, fno: false, etf: false },
  { symbol: "PERSISTENT", name: "Persistent Systems", sector: "IT", close: 5120.0, change: 2.1, relative_volume: 2.4, market_cap_cr: 78000, cap_tier: "mid", rsi: 71, adx: 31, pos_52w: 0.88, fno: true, etf: false },
  { symbol: "COFORGE", name: "Coforge", sector: "IT", close: 6890.5, change: -1.3, relative_volume: 1.5, market_cap_cr: 41000, cap_tier: "mid", rsi: 38, adx: 19, pos_52w: 0.42, fno: false, etf: false },
  { symbol: "KPITTECH", name: "KPIT Technologies", sector: "IT", close: 1834.75, change: 0.9, relative_volume: 1.3, market_cap_cr: 32000, cap_tier: "small", rsi: 52, adx: 24, pos_52w: 0.66, fno: false, etf: false },
  { symbol: "NIFTYBEES", name: "Nippon India ETF Nifty BeES", sector: "ETF", close: 264.1, change: 0.5, relative_volume: 0.7, market_cap_cr: 18000, cap_tier: "small", rsi: 48, adx: 18, pos_52w: 0.57, fno: false, etf: true },
  { symbol: "MICROCO", name: "Micro Co", sector: "Services", close: 87.6, change: -2.2, relative_volume: 3.1, market_cap_cr: 900, cap_tier: "micro", rsi: 22, adx: 33, pos_52w: 0.18, fno: false, etf: false },
  { symbol: "LIQUIDBEES", name: "Nippon India ETF Liquid BeES", sector: "ETF", close: 1130.2, change: 0.01, relative_volume: 0.3, market_cap_cr: 15000, cap_tier: "micro", rsi: 50, adx: 12, pos_52w: 0.51, fno: false, etf: true },
];

const ALL_SYMBOLS = MOCK_ROWS.map((row) => row.symbol);

function snapshotEnvelope() {
  return {
    as_of: new Date().toISOString(),
    universe: "all_equity",
    total: MOCK_ROWS.length,
    update_mode: "streaming",
    rows: MOCK_ROWS,
  };
}

/**
 * Register the snapshot mock. `state.status` is read per request so a test can
 * flip 502 → 200 before clicking retry. Call before page.goto().
 */
async function mockMarketSnapshot(page: Page, state: { status: number } = { status: 200 }) {
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
      body: JSON.stringify(snapshotEnvelope()),
    });
  });
}

async function openMarketTab(page: Page, state?: { status: number }) {
  await setupApiMocks(page);
  // EventsPanel is mounted on every screener tab — keep it off the network too.
  await setupEventsMocks(page);
  await loginAsTestUser(page);
  await mockMarketSnapshot(page, state);
  await page.goto(SNAPSHOT_PATH);
  await page.waitForSelector('[data-testid="market-screener"]', { timeout: 15000 });
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
    await page.getByRole("textbox", { name: /search symbol or name/i }).fill("reliance");
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
    await openMarketTab(page);

    await expect(page.locator('[data-testid="market-mode-badge"]')).toHaveText(/live/i);
  });
});
