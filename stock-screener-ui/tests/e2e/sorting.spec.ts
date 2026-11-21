import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupUserConfigMocks,
  seedUserConfig,
  setupOptionDockMocks,
  type UserConfigMockHandle,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

/**
 * Header sort cycle + saved table prefs.
 *
 * Numeric columns cycle `none → desc → asc → none` (text columns ascend first);
 * `aria-sort` is the contract, the ▲/▼ glyph is only decoration. Every scope is
 * mocked in-page so a PUT survives a reload without a backend that has yet to
 * register `table.*` in its scope registry.
 */

const SCREENER_SCOPE = "table.screener.52w_high.approaching";
const MARKET_SCOPE = "table.market.grid";
const GAP_HEADER_ID = "paper-tanstack-header-to_52w_high";
const DAY_HEADER_ID = "paper-tanstack-header-day_change";

/** Deliberately NOT ordered by gap: the "no sort" frame must be distinguishable. */
const APPROACHING_ROWS = [
  row("GAP_MID", 3.25, 90, 900),
  row("GAP_HIGH", 8.5, 60, 100),
  row("GAP_MIN", -11.75, 50, 9000),
  row("GAP_LOW", -6.4, 75, 1000),
];

const MARKET_ROWS = [
  marketRow("MKT_UP", 9000, 9),
  marketRow("MKT_MID", 900, 4),
  marketRow("MKT_DOWN", 100, -3),
  { ...marketRow("MKT_ETF", null, 1), cap_tier: "etf", etf: true, sector: "ETF" },
];

function row(symbol: string, to52wHigh: number, score: number, volume: number) {
  return {
    symbol,
    score,
    to_52w_high: to52wHigh,
    high_52w: 100,
    low_52w: 60,
    upstox_price: 95,
    tv_price: 95,
    days_ago: 0,
    volume,
    volume_m: 1.5,
    rsi: 55,
    adx: 22,
    day_change: 1.2,
    sector: "Technology",
    touched_52w: false,
  };
}

function marketRow(symbol: string, marketCapCr: number | null, change: number) {
  return {
    symbol,
    name: symbol,
    sector: "IT",
    close: 1000,
    change,
    relative_volume: 1.2,
    market_cap_cr: marketCapCr,
    cap_tier: "large",
    rsi: 55,
    adx: 22,
    pos_52w: 0.6,
    fno: true,
    etf: false,
    exchange: "NSE",
  };
}

async function mock52wScreeners(page: Page) {
  // Later registrations win in Playwright; this replaces the broad handler in
  // setupApiMocks so the app defaults to the 52w_high profile under test.
  await page.route(apiRoute("screener"), async (route) => {
    if (route.request().url().endsWith("/api/screeners")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          screeners: [
            {
              id: "52w_high",
              label: "52W High",
              section_labels: { primary: "Approaching", secondary: "Touched" },
              section_descriptions: { primary: "", secondary: "" },
              default_sort: "score",
              filters: [],
            },
          ],
          default: "52w_high",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        approaching: APPROACHING_ROWS,
        touched: [],
        last_updated: new Date().toISOString(),
        provider: "upstox",
        mode: "intraday",
        screener: "52w_high",
        profile_meta: {
          section_labels: { primary: "Approaching", secondary: "Touched" },
          filters: [],
        },
      }),
    });
  });
}

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

function approachingTable(page: Page): Locator {
  return page.locator('[data-testid="screener-table-approaching"]');
}

function gapHeader(page: Page): Locator {
  return approachingTable(page).locator(`#${GAP_HEADER_ID}`);
}

/** Parse the rendered gap cells so the assertion covers values, not just the attribute. */
async function gapValues(page: Page): Promise<number[]> {
  const table = approachingTable(page);
  const index = await table
    .locator("thead th")
    .evaluateAll((ths, id) => ths.findIndex((th) => th.id === id), GAP_HEADER_ID);
  expect(index).toBeGreaterThanOrEqual(0);
  return table.locator("tbody tr").evaluateAll((rows, colIndex) => {
    return rows
      .map((tr) => parseFloat(tr.querySelectorAll("td")[colIndex]?.textContent ?? ""))
      .filter((value) => Number.isFinite(value));
  }, index);
}

async function openScreener(page: Page) {
  await page.goto("/?tab=screener");
  await expect(approachingTable(page).locator("tbody tr").first()).toBeVisible({ timeout: 15000 });
}

async function openMarket(page: Page) {
  await page.goto("/screener/market");
  await expect(page.getByTestId("market-grid")).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid^="market-row-"]').first()).toBeVisible({ timeout: 15000 });
}

async function marketRowOrder(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="market-row-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid") ?? ""));
}

async function dockWidths(page: Page) {
  return page.evaluate(() => {
    const outlet = document.querySelector('[data-testid="chart-dock-outlet"]') as HTMLElement;
    const grid = document.querySelector('[data-testid="market-grid"]') as HTMLElement;
    const row = outlet.parentElement as HTMLElement;
    const wrapper = Array.from(row.children).find(
      (child) => child.contains(grid) && (child as HTMLElement).classList.contains("flex-1"),
    ) as HTMLElement | undefined;
    return {
      display: getComputedStyle(outlet).display,
      outletWidth: outlet.getBoundingClientRect().width,
      wrapperWidth: wrapper?.getBoundingClientRect().width ?? -1,
      rowWidth: row.getBoundingClientRect().width,
    };
  });
}

test.describe("Table sorting — 52W screener", () => {
  let config: UserConfigMockHandle;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    config = await setupUserConfigMocks(page);
    await mock52wScreeners(page);
  });

  test("numeric header cycles desc → asc → none and the rows follow", async ({ page }) => {
    await openScreener(page);
    const header = gapHeader(page);
    await expect(header).toHaveAttribute("aria-sort", "none");
    // Unsort: fixture order is mid, high, min, low.
    expect((await gapValues(page)).slice(0, 3)).toEqual([3.25, 8.5, -11.75]);

    await header.click();
    await expect(header).toHaveAttribute("aria-sort", "descending");
    await expect.poll(async () => (await gapValues(page)).slice(0, 3)).toEqual([8.5, 3.25, -6.4]);

    await header.click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await expect.poll(async () => (await gapValues(page)).slice(0, 3)).toEqual([-11.75, -6.4, 3.25]);

    await header.click();
    await expect(header).toHaveAttribute("aria-sort", "none");
    await expect.poll(async () => (await gapValues(page)).slice(0, 3)).toEqual([3.25, 8.5, -11.75]);
  });

  test("a saved ascending sort restores on load", async ({ page }) => {
    await seedUserConfig(page, SCREENER_SCOPE, {
      sorting: [{ id: "to_52w_high", desc: false }],
    });
    await openScreener(page);

    await expect(gapHeader(page)).toHaveAttribute("aria-sort", "ascending");
    await expect.poll(async () => (await gapValues(page))[0]).toBe(-11.75);
    await expect(approachingTable(page).locator('[data-testid="stock-row-GAP_MIN"]')).toBeVisible();
  });

  test("a header click PUTs the new sorting and survives a reload", async ({ page }) => {
    await openScreener(page);

    const putResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/user-configs/${SCREENER_SCOPE}`) &&
        response.request().method() === "PUT",
      { timeout: 15000 },
    );

    await gapHeader(page).click();
    await expect(gapHeader(page)).toHaveAttribute("aria-sort", "descending");

    const put = await putResponse;
    const payload = JSON.parse(put.request().postData() ?? "{}") as {
      config?: { sorting?: { id: string; desc: boolean }[] };
    };
    expect(payload.config?.sorting).toEqual([{ id: "to_52w_high", desc: true }]);
    await expect
      .poll(() => config.storedScope(SCREENER_SCOPE)?.sorting, { timeout: 15000 })
      .toEqual([{ id: "to_52w_high", desc: true }]);

    await page.reload();
    await expect(approachingTable(page).locator("tbody tr").first()).toBeVisible({ timeout: 15000 });
    await expect(gapHeader(page)).toHaveAttribute("aria-sort", "descending");
    await expect.poll(async () => (await gapValues(page))[0]).toBe(8.5);
  });

  test("score and symbol headers stay sortable with a visible indicator", async ({ page }) => {
    await openScreener(page);
    const table = approachingTable(page);
    const score = table.locator("#paper-tanstack-header-score");
    const symbol = table.locator('[id="paper-tanstack-header-symbol"]').first();

    await expect(score).toHaveAttribute("aria-sort", "none");
    await score.click();
    await expect(score).toHaveAttribute("aria-sort", "descending");
    await expect(score).toContainText("▼");

    await symbol.click();
    await expect(symbol).toHaveAttribute("aria-sort", "ascending");
    await expect(symbol).toContainText("▲");
  });
});

test.describe("Table sorting — market grid", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupUserConfigMocks(page);
    await mockMarketSnapshot(page);
    await mockPatternLookup(page);
  });

  // Depends on the `table.market.grid` persistence lane landing in the app.
  test("a saved day_change ascending sort puts the smallest change first", async ({ page }) => {
    await seedUserConfig(page, MARKET_SCOPE, {
      sorting: [{ id: "day_change", desc: false }],
    });
    await openMarket(page);

    const day = page.locator(`#${DAY_HEADER_ID}`);
    await expect(day).toHaveAttribute("aria-sort", "ascending");
    await expect.poll(() => marketRowOrder(page)).toEqual([
      "market-row-MKT_DOWN",
      "market-row-MKT_ETF",
      "market-row-MKT_MID",
      "market-row-MKT_UP",
    ]);
  });

  test("default mcap_desc puts the null-cap ETF row last", async ({ page }) => {
    await openMarket(page);
    await expect(page.locator('[data-testid^="market-row-"]')).toHaveCount(MARKET_ROWS.length);
    await expect.poll(() => marketRowOrder(page)).toEqual([
      "market-row-MKT_UP",
      "market-row-MKT_MID",
      "market-row-MKT_DOWN",
      "market-row-MKT_ETF",
    ]);
  });

  test("closing the options dock collapses the outlet and restores the grid width", async ({ page }) => {
    // The inline outlet only renders at >= 1400px (MarketScreenerPanel's isWide).
    await page.setViewportSize({ width: 1500, height: 900 });
    await setupOptionDockMocks(page);
    await openMarket(page);
    // Collapse the 240px filter rail so the row is just the grid + outlet —
    // that is the layout the data-dock-open fix has to reclaim in full.
    await page.getByTestId("market-rail-collapse").click();
    await expect(page.getByTestId("market-rail-panel")).toHaveCount(0);

    const outlet = page.getByTestId("chart-dock-outlet");
    await expect(outlet).toHaveAttribute("data-dock-open", "false");
    await expect(outlet).toBeHidden();
    const before = await dockWidths(page);
    expect(before.display).toBe("none");
    expect(before.outletWidth).toBe(0);
    expect(before.wrapperWidth).toBeGreaterThan(0);
    expect(before.wrapperWidth).toBeCloseTo(before.rowWidth, 0);

    await page.locator('[data-testid="symbol-options-MKT_UP"]').first().click();
    await expect(page.getByTestId("options-dock")).toBeVisible({ timeout: 15000 });
    await expect(outlet).toHaveAttribute("data-dock-open", "true");

    await page.getByTestId("options-close").click();
    await expect(outlet).toHaveAttribute("data-dock-open", "false");
    await expect(outlet).toBeHidden();
    await expect.poll(async () => (await dockWidths(page)).wrapperWidth).toBeCloseTo(before.rowWidth, 0);
    const after = await dockWidths(page);
    expect(after.display).toBe("none");
    expect(after.outletWidth).toBe(0);
    expect(after.wrapperWidth).toBeCloseTo(after.rowWidth, 0);
  });
});
