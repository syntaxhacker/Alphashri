import { expect, test, type Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

const THEME = {
  light: { bg: "rgb(244, 245, 247)", surface: "rgb(255, 255, 255)" },
  dark: { bg: "rgb(0, 0, 0)", surface: "rgb(19, 22, 28)" },
} as const;

/**
 * The market tab paints its grid from `GET /api/market/snapshot`. Without a
 * mock the request falls through to the real backend, which rejects the fake
 * E2E token with 401 — the panel then renders its error banner, never a row,
 * and this spec would be asserting colours on a page that failed to load.
 * A minimal row set is enough: the theme assertions only need the grid (and
 * its toolbar) mounted, not any particular market data.
 */
const MARKET_ROWS = [
  {
    symbol: "THEME1",
    name: "Theme Fixture One",
    sector: "Energy",
    exchange: "NSE",
    close: 1412.5,
    change: 1.2,
    relative_volume: 1.8,
    market_cap_cr: 1_900_000,
    cap_tier: "large",
    rsi: 62,
    adx: 28,
    pos_52w: 0.82,
    fno: true,
    etf: false,
  },
  {
    symbol: "THEME2",
    name: "Theme Fixture Two",
    sector: "IT",
    exchange: "NSE",
    close: 3288.0,
    change: -0.4,
    relative_volume: 1.1,
    market_cap_cr: 1_200_000,
    cap_tier: "large",
    rsi: 45,
    adx: 22,
    pos_52w: 0.61,
    fno: true,
    etf: false,
  },
];

async function mockMarketSnapshot(page: Page) {
  await page.route(apiRoute("market/snapshot"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        as_of: new Date().toISOString(),
        universe: "all_equity",
        total: MARKET_ROWS.length,
        update_mode: "streaming",
        rows: MARKET_ROWS,
      }),
    });
  });
}

/** The PATTERNS column asks the real API on mount; answer it locally so the
 *  page does not log a 401 for every load/reload. */
async function mockPatternLookup(page: Page) {
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
}

// The toggle used to flip `data-color-scheme` while every token stayed on its
// dark value — there was no light block in tailwind.css — so the button looked
// broken. Asserting the painted background, not the attribute, is what catches
// that: an attribute check passes on a page that never repaints.
test("theme toggle changes the painted background and persists", async ({ page }) => {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await mockMarketSnapshot(page);
  await mockPatternLookup(page);
  await page.goto("/screener/market");
  await page.waitForSelector('[data-testid="market-grid"] tbody tr', { timeout: 20000 });

  const attr = () => page.evaluate(() => document.documentElement.getAttribute("data-color-scheme"));
  const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const surface = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="market-toolbar"]');
      return el ? getComputedStyle(el).backgroundColor : "none";
    });
  const stored = () => page.evaluate(() => localStorage.getItem("color-scheme"));

  const initial = (await attr()) as "light" | "dark";
  const next = initial === "dark" ? "light" : "dark";
  // The boot scheme honours the system preference; assert consistency, then flip.
  expect(await bodyBg()).toBe(THEME[initial].bg);

  await page.locator('[data-testid="theme-toggle-btn"]:visible').first().click();
  await expect.poll(attr).toBe(next);
  await expect.poll(bodyBg).toBe(THEME[next].bg);
  expect(await stored()).toBe(next);

  // The choice must survive a reload, and be applied before first paint (the
  // bootstrap in index.html), so no frame is painted in the other scheme.
  await page.reload();
  await page.waitForSelector('[data-testid="market-grid"] tbody tr', { timeout: 20000 });
  expect(await attr()).toBe(next);
  expect(await bodyBg()).toBe(THEME[next].bg);
  expect(await surface()).toBe(THEME[next].surface);

  // Back to the original for a clean end state.
  await page.locator('[data-testid="theme-toggle-btn"]:visible').first().click();
  await expect.poll(attr).toBe(initial);
});
