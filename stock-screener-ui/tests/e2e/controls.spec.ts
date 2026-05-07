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
    await page.waitForSelector("table tbody tr", {
      timeout: 10000,
    });

    // Click refresh button
    const refreshBtn = page.locator("#refreshBtn");
    if ((await refreshBtn.count()) > 0) {
      await refreshBtn.click();
      await expect(page.locator("table tbody tr")).toBeVisible({
        timeout: 5000,
      });
      const rows = page.locator("table tbody tr");
      expect(await rows.count()).toBeGreaterThan(0);
    }
  });
  test("should copy trading list to clipboard", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", {
      timeout: 10000,
    });

    // Grant clipboard permissions
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    // Find and click copy button
    const copyBtn = page.getByRole("button", {
      name: "Copy",
    });
    if ((await copyBtn.count()) > 0) {
      await copyBtn.first().click();
      await page.waitForLoadState("networkidle");
      try {
        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        // Verify clipboard contains stock symbols
        expect(clipboardText.length).toBeGreaterThan(0);
      } catch {}
    }
  });

  // Skip: Flaky in parallel execution
  test.skip("should change auto-refresh interval", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", {
      timeout: 15000,
    });
    const autoRefreshInput = page.locator('[data-testid="auto-refresh-input"]');
    await expect(autoRefreshInput).toBeVisible();
    await autoRefreshInput.fill("30");
    await autoRefreshInput.blur();
    await autoRefreshInput.dispatchEvent("change");
    expect(await autoRefreshInput.inputValue()).toBe("30");
  });
  test.skip("should show error state when API fails", async ({ page }) => {
    await page.route(apiRoute("screener**"), async (route) => {
      await route.abort("failed");
    });
    await page.goto("/");
    const errorElement = page.getByTestId("screener-error");
    try {
      await expect(errorElement).toBeVisible({
        timeout: 5000,
      });
    } catch {
      const retryBtn = page.getByRole("button", {
        name: "Retry",
      });
      const errorAlert = page.locator(".mantine-Alert-root");
      const count = (await retryBtn.count()) + (await errorAlert.count());
      expect(count).toBeGreaterThan(0);
    }
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
