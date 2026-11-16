import { test, expect, type Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, setupOptionDockMocks } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { collectConsoleErrors } from "./helpers/flowsB";

/**
 * Options dock (P1): chain → legs → payoff, opened from a symbol.
 *
 * Fully mocked: E1 (`/api/options/underlying/{symbol}`) and E2
 * (`/api/options/chain/{symbol}`). The mock reports `market_state: closed`,
 * so the dock does one fetch and never polls — that is what makes the request
 * counts exact rather than "roughly two".
 */

const SNAPSHOT_PATH = "/?tab=market";

const MOCK_ROWS = [
  {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    sector: "Energy",
    close: 1417.4,
    change: 0.8,
    relative_volume: 1.4,
    market_cap_cr: 1900000,
    cap_tier: "large",
    rsi: 58,
    adx: 24,
    pos_52w: 0.72,
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
        total: MOCK_ROWS.length,
        update_mode: "streaming",
        rows: MOCK_ROWS,
      }),
    });
  });
}

/** The PATTERNS column lookups would otherwise hit the real API and log a 401. */
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

async function enterWithDock(
  page: Page,
  options: Parameters<typeof setupOptionDockMocks>[1] = {},
) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await mockMarketSnapshot(page);
  await mockPatternLookup(page);
  const dock = await setupOptionDockMocks(page, options);
  return dock;
}

async function openDock(page: Page) {
  await page.goto(SNAPSHOT_PATH);
  await expect(page.locator('[data-testid="market-row-RELIANCE"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="symbol-options-RELIANCE"]').first().click();
  await expect(page.locator('[data-testid="options-dock"]')).toBeVisible({ timeout: 15000 });
}

test.describe("Options dock", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    collectConsoleErrors(page);
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("opens from a symbol, costs two requests and lands on the nearest expiry", async ({ page }) => {
    const dock = await enterWithDock(page);
    await openDock(page);

    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-dock-symbol"]')).toHaveText("RELIANCE");

    // Nearest listed expiry, not the far one.
    await expect(page.locator('[data-testid="options-expiry-select"]')).toHaveValue("2026-11-26");

    expect(dock.counts.underlying).toBe(1);
    expect(dock.counts.chain).toBe(1);
  });

  test("adds two legs from the chain with zero extra requests, then renders payoff and POP", async ({
    page,
  }) => {
    const dock = await enterWithDock(page);
    await openDock(page);

    const before = dock.counts.underlying + dock.counts.chain;

    await page.locator('[data-testid="options-ce-1420"]').click();
    await page.locator('[data-testid="options-pe-1400"]').click();

    await expect(page.locator('[data-testid="options-leg-count"]')).toHaveText("2/4");
    expect(dock.counts.underlying + dock.counts.chain).toBe(before);

    // The payoff panel only exists once a leg exists.
    await expect(page.locator('[data-testid="options-payoff"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-pop"]')).toContainText("%");
    await expect(page.locator('[data-testid="options-breakevens"]')).toContainText("BE");
    await expect(page.locator('[data-testid="options-payoff-chart"]')).toBeVisible();

    // Four labelled footer cells, not one run-on line, and the footer starts
    // below the chart — the x-axis tick labels must not collide with it.
    const footer = page.locator('[data-testid="options-payoff-footer"]');
    await expect(footer).toBeVisible();
    await expect(footer.locator("> *")).toHaveCount(4);
    await expect(page.locator('[data-testid="options-max-pnl"]')).toContainText("MAX P/L");
    await expect(page.locator('[data-testid="options-expected-pnl"]')).toContainText("MODEL E[P&L]");
    await expect(page.locator('[data-testid="options-expected-move"]')).toContainText("±1σ");
    const boxes = await page.evaluate(() => {
      const chart = document.querySelector('[data-testid="options-payoff-chart"]')!.getBoundingClientRect();
      const foot = document.querySelector('[data-testid="options-payoff-footer"]')!.getBoundingClientRect();
      return { chartBottom: chart.bottom, footerTop: foot.top, footerHeight: foot.height };
    });
    expect(boxes.footerTop).toBeGreaterThanOrEqual(Math.floor(boxes.chartBottom));
    expect(boxes.footerHeight).toBeLessThanOrEqual(28);
  });

  test("the dock's sections carry headers and are separated by hairlines", async ({ page }) => {
    await enterWithDock(page);
    await openDock(page);

    await expect(page.locator('[data-testid="dock-section-chain"]')).toContainText(/CHAIN · RELIANCE/);
    await expect(page.locator('[data-testid="dock-section-strategy"]')).toHaveText("STRATEGY");
    await expect(page.locator('[data-testid="dock-section-legs"]')).toContainText("LEGS");

    await page.locator('[data-testid="options-ce-1420"]').click();
    await expect(page.locator('[data-testid="dock-section-payoff"]')).toContainText("PAYOFF");

    const sections = page.locator("[data-dock-section]");
    await expect(sections).toHaveCount(4);
    const borders = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-dock-section]")).map((el) => ({
        id: el.getAttribute("data-testid"),
        borderTop: parseFloat(getComputedStyle(el).borderTopWidth),
        rounded: parseFloat(getComputedStyle(el).borderTopLeftRadius),
      })),
    );
    // Chain opens the column under the summary strip's own rule; the three below
    // it each add exactly one separator. No section is a rounded nested card.
    expect(borders.map((b) => b.borderTop)).toEqual([0, 1, 1, 1]);
    for (const b of borders) expect(b.rounded).toBe(0);
  });

  test("strategy preset builds an iron condor and survives an expiry change", async ({ page }) => {
    const dock = await enterWithDock(page);
    await openDock(page);

    await page.locator('[data-testid="options-strategy"]').click();
    await page.locator('[data-testid="options-strategy-iron_condor"]').click();

    await expect(page.locator('[data-testid="options-leg-count"]')).toHaveText("4/4");
    await expect(page.locator('[data-testid="options-leg-chips"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-strategy"]')).toContainText("Iron condor");
    await expect(page.locator('[data-testid="options-strategy-risk"]')).toHaveText("defined risk");

    // The preset prices from the in-memory frame: no extra chain request.
    expect(dock.counts.underlying).toBe(1);
    expect(dock.counts.chain).toBe(1);

    await expect(page.locator('[data-testid="options-payoff"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-pop"]')).toContainText("%");
    const points = await page
      .locator('[data-testid="options-payoff-chart"]')
      .getAttribute("data-points");
    expect(Number(points)).toBeGreaterThan(0);

    const before = dock.counts.chain;
    await page.locator('[data-testid="options-expiry-select"]').selectOption("2026-12-31");
    await expect.poll(() => dock.counts.chain, { timeout: 15000 }).toBe(before + 1);

    // Rebuilt against the new frame rather than left stale on the old expiry.
    await expect(page.locator('[data-testid="options-leg-count"]')).toHaveText("4/4");
    await expect(page.locator('[data-testid="options-legs-expiry-mismatch"]')).toBeHidden();
    await expect(page.locator('[data-testid="options-strategy"]')).toContainText("Iron condor");
  });

  test("No strategy clears the preset's legs", async ({ page }) => {
    await enterWithDock(page);
    await openDock(page);

    await page.locator('[data-testid="options-strategy"]').click();
    await page.locator('[data-testid="options-strategy-bull_call_spread"]').click();
    await expect(page.locator('[data-testid="options-leg-count"]')).toHaveText("2/4");

    await page.locator('[data-testid="options-strategy"]').click();
    await page.locator('[data-testid="options-strategy-none"]').click();

    await expect(page.locator('[data-testid="options-leg-count"]')).toHaveText("0/4");
    await expect(page.locator('[data-testid="options-legs-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-strategy"]')).toContainText("No strategy");
  });

  test("changing expiry refetches the chain exactly once", async ({ page }) => {
    const dock = await enterWithDock(page);
    await openDock(page);

    const before = dock.counts.chain;

    await page.locator('[data-testid="options-expiry-select"]').selectOption("2026-12-31");

    await expect.poll(() => dock.counts.chain, { timeout: 15000 }).toBe(before + 1);
    expect(dock.counts.underlying).toBe(1);
  });

  test("a non-F&O underlying shows the dock's own empty state", async ({ page }) => {
    await enterWithDock(page, { fno: false });
    await openDock(page);

    await expect(page.locator('[data-testid="options-dock-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-dock-empty"]')).toContainText(
      "No listed options for RELIANCE",
    );
  });

  test("429 on refresh keeps the chain painted and shows the paused chip", async ({ page }) => {
    const dock = await enterWithDock(page);
    await openDock(page);
    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();

    dock.setChainStatus(429);
    await page.locator('[data-testid="options-refresh"]').click();

    await expect(page.locator('[data-testid="options-refresh-paused"]')).toBeVisible({
      timeout: 15000,
    });
    // The last frame is still there — a 429 must never blank the chain.
    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-chain-row-1420"]')).toBeVisible();
  });

  test("closing the dock aborts polling and clears the surface", async ({ page }) => {
    const dock = await enterWithDock(page);
    await openDock(page);
    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();

    await page.locator('[data-testid="options-close"]').click();
    await expect(page.locator('[data-testid="options-dock"]')).toBeHidden({ timeout: 10000 });

    const settled = dock.counts.chain;
    await page.waitForTimeout(1200);
    expect(dock.counts.chain).toBe(settled);
  });

  test("narrow viewport opens a bottom sheet and the page never scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterWithDock(page);
    await openDock(page);

    await expect(page.locator('[data-testid="options-dock-sheet"]')).toBeVisible();
    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible();

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      sheetHeight: Math.round(
        document.querySelector('[data-testid="options-dock-sheet"]')!.getBoundingClientRect().height,
      ),
    }));
    // A horizontal page scrollbar under 400 px is the class of bug a desktop
    // screenshot never shows.
    expect(metrics.scrollWidth).toBe(metrics.clientWidth);
    // 62vh of 844 = 523 px, ±2 px for rounding.
    expect(Math.abs(metrics.sheetHeight - 844 * 0.62)).toBeLessThan(3);
  });
});
