import { test, expect } from "@playwright/test";
import { collectConsoleErrors, enterValueScanApp } from "./helpers/flowsB";

/**
 * Deep Value tab (GET /api/value/scan).
 * The panel is fully mocked - no network, no backend required.
 */
test.describe("Deep Value tab", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    collectConsoleErrors(page);
    await enterValueScanApp(page);
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("shows the Deep Value tab on the screener page", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="screener-page"]', { timeout: 15000 });

    const tab = page.locator('[data-testid="tab-deepvalue"]');
    await expect(tab).toBeVisible();
    await expect(tab).toHaveText("Deep Value");
  });

  test("renders the value table with rows and a score", async ({ page }) => {
    await page.goto("/?tab=deepvalue");
    await page.waitForSelector('[data-testid="deep-value-panel"]', { timeout: 15000 });

    const table = page.locator('[data-testid="value-table"]');
    await expect(table).toBeVisible();
    await expect(table).toContainText("SBI Life Insurance");
    await expect(table).toContainText("87");
  });

  test("switches market and refetches", async ({ page }) => {
    await page.goto("/?tab=deepvalue");
    await page.waitForSelector('[data-testid="value-table"]', { timeout: 15000 });

    const [request] = await Promise.all([
      page.waitForRequest(
        (req) => req.url().includes("/api/value/scan") && req.url().includes("market=usa"),
        { timeout: 15000 },
      ),
      page.locator('[data-testid="value-market-tab-usa"]').click(),
    ]);
    expect(request.url()).toContain("market=usa");
  });

  test("applies a preset and sends it to the api", async ({ page }) => {
    await page.goto("/?tab=deepvalue");
    await page.waitForSelector('[data-testid="value-table"]', { timeout: 15000 });

    const [request] = await Promise.all([
      page.waitForRequest(
        (req) => req.url().includes("/api/value/scan") && req.url().includes("preset="),
        { timeout: 15000 },
      ),
      page.locator('[data-testid="value-preset-select"]').click(),
      page.getByRole("option", { name: /DEEP/i }).click(),
    ]);
    expect(request.url()).toContain("preset=DEEP");
  });
});
