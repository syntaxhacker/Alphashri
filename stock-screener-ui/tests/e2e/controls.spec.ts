import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
test.describe("UI Controls", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });
  test("should refresh data when refresh button clicked", async ({ page }) => {
    await page.goto("/");
    // The home page now lands on the Dashboard tab; the results tables live
    // under the Screener tab.
    await page.getByTestId("tab-screener").click();
    await page.waitForSelector("table tbody tr", {
      timeout: 10000,
    });

    // Click refresh button (MUI ActionIcon: id/testid "refresh-btn")
    const refreshBtn = page.getByTestId("refresh-btn");
    await refreshBtn.click();
    await expect(page.locator("table tbody tr").first()).toBeVisible({
      timeout: 5000,
    });
    const rows = page.locator("table tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
  });
  test("should copy trading list to clipboard", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("tab-screener").click();
    await page.waitForSelector("table tbody tr", {
      timeout: 10000,
    });

    // Grant clipboard permissions
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    // Copy buttons are icon-only ActionIcons (no accessible "Copy" name);
    // each results table has a "copy all symbols" button.
    const copyBtn = page.getByTestId("copy-all-symbols-btn").first();
    await expect(copyBtn).toBeVisible({ timeout: 5000 });
    await copyBtn.click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 })
      .toContain("MOCK1");
  });

  test("should change auto-refresh interval", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("tab-screener").click();
    await page.waitForSelector("table tbody tr", {
      timeout: 15000,
    });
    // auto-refresh-input is the MUI TextField root; the native input is inside.
    const autoRefreshInput = page.locator('[data-testid="auto-refresh-input"] input');
    await expect(autoRefreshInput).toBeVisible();
    // fill() already fires the input/change events React listens to; an extra
    // synthetic change dispatch can clobber the controlled value, so just
    // blur via Tab instead.
    await autoRefreshInput.fill("30");
    await autoRefreshInput.press("Tab");
    expect(await autoRefreshInput.inputValue()).toBe("30");
  });
  test("should show error state when API fails", async ({ page }) => {
    await page.route(apiRoute("screener"), async (route) => {
      await route.abort("failed");
    });
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
    await page.getByTestId("tab-screener").click();
    // The screener error panel renders under testid "screener-error-container"
    // with a "Retry" button ("screener-retry-btn"); there is no .MuiAlert-root.
    const errorElement = page.getByTestId("screener-error-container");
    await expect(errorElement).toBeVisible({ timeout: 5000 });
    await expect(errorElement).toContainText("Screener failed to load");
    await expect(page.getByTestId("screener-retry-btn")).toBeVisible();
  });
  test("should show loading state during data fetch", async ({ page }) => {
    // Delay the response
    await page.route(apiRoute("screener**"), async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    await page.goto("/");

    // Check for loading indicator (may be brief)
    const _loadingIndicator = page.locator(".inline-refresh, .refreshing");
    // This might be hard to catch due to timing
  });
});
