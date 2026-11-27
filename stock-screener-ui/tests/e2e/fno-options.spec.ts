import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupFnoScreenerMocks,
  setupOptionDockMocks,
} from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import { collectConsoleErrors } from "./helpers/flowsB";

const SYM = "RELIANCE";

async function enterFnoPage(page: import("@playwright/test").Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupFnoScreenerMocks(page);
  await setupOptionDockMocks(page);

  // The chart page never throws on fetch failure, but mock its endpoints so the
  // navigation test never reaches the real backend.
  await page.route(apiRoute("chart-patterns/timeframes"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ timeframe: "1D", label: "1D", minutes: 1, display: "1 Day" }]),
    });
  });
  await page.route(apiRoute(`chart-patterns/symbol/${SYM}/chart`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ hits: [], candles: [], trend_lines: [], note: null }),
    });
  });

  await page.goto("/screener/fno");
  await expect(page.locator('[data-testid="fno-table"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator(`[data-testid="fno-row-${SYM}"]`)).toBeVisible({ timeout: 15000 });
}

test.describe("F&O screener symbol actions", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    collectConsoleErrors(page);
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("renders the options and chart icons plus a target=_blank TradingView anchor", async ({
    page,
  }) => {
    await enterFnoPage(page);

    const firstRow = page.locator(`[data-testid="fno-row-${SYM}"]`);

    await expect(
      firstRow.locator(`[data-testid="symbol-options-${SYM}"]`),
    ).toBeVisible();
    await expect(firstRow.locator(`[data-testid="symbol-chart-${SYM}"]`)).toBeVisible();

    const tv = firstRow.locator(`[data-testid="symbol-tv-${SYM}"]`);
    await expect(tv).toBeVisible();
    await expect(tv).toHaveAttribute("target", "_blank");
    await expect(tv).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("opens the options dock in options mode with the chain and underlying symbol", async ({
    page,
  }) => {
    await enterFnoPage(page);

    await page.locator(`[data-testid="symbol-options-${SYM}"]`).click();

    // The dock rail opens in options mode; the lazy options panel then renders
    // the chain table. Poll for the chain table (cold chunk load can take a
    // moment on the first open) rather than asserting a fixed delay.
    await expect(page.locator('[data-testid="symbol-dock"][data-mode="options"]')).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator('[data-testid="options-chain-table"]')).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator('[data-testid="options-dock-symbol"]')).toHaveText(SYM);
  });

  test("clicking the symbol body opens the app-wide chart dock without navigating", async ({
    page,
  }) => {
    await enterFnoPage(page);

    await expect(page).toHaveURL(/\/screener\/fno/);

    await page.locator(`[data-testid="fno-cell-symbol-${SYM}"]`).click();

    await expect(page.locator('[data-testid="symbol-dock"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page).toHaveURL(/\/screener\/fno/);
  });

  test("clicking the chart icon opens the same dock as the symbol text", async ({ page }) => {
    await enterFnoPage(page);

    await page.locator(`[data-testid="symbol-chart-${SYM}"]`).click();

    await expect(page.locator('[data-testid="symbol-dock"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(page).toHaveURL(/\/screener\/fno/);
  });

  test("clicking the options icon neither navigates nor expands the row", async ({ page }) => {
    await enterFnoPage(page);

    const expand = page.locator(`[data-testid="fno-expand-${SYM}"]`);
    await expect(expand).toHaveAttribute("aria-expanded", "false");

    await page.locator(`[data-testid="symbol-options-${SYM}"]`).click();

    // The click landed on the options icon (the dock opened).
    await expect(page.locator('[data-testid="symbol-dock"][data-mode="options"]')).toBeVisible({
      timeout: 15000,
    });

    // No in-app navigation.
    await expect(page).toHaveURL(/\/screener\/fno/);
    // The row stays collapsed.
    await expect(expand).toHaveAttribute("aria-expanded", "false");
  });
});
