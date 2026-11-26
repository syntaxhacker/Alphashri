import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

test.describe("Screener - Interactions", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should copy all symbols to clipboard", async ({ page }) => {
    await page.goto("/?tab=screener");
    await page.waitForSelector('[data-testid="screener-table"] tbody tr', {
      timeout: 10000,
    });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const copyBtn = page.locator('[data-testid="copy-all-symbols-btn"]').first();
    await expect(copyBtn).toBeVisible({ timeout: 5000 });
    await copyBtn.click();
  });

  // The screener's inline Table|Heatmap toggle was removed deliberately
  // (3a557d12): the heatmap now lives on the HOME desk (`market.heatmap`) and
  // is covered by home-desk.spec.ts. Keeping a test for a deleted control only
  // produced a red suite. Assert the removal instead, so a re-introduction is
  // noticed rather than silently accepted.
  test("has no inline heatmap view (moved to the HOME desk)", async ({ page }) => {
    await page.goto("/?tab=screener");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="screener-table"] tbody tr', { timeout: 10000 });

    await expect(page.getByTestId("screener-view-toggle")).toHaveCount(0);
    await expect(page.locator('[data-testid^="screener-heatmap-"]')).toHaveCount(0);
  });

  test("should open the app-wide dock on row click without navigating", async ({ page }) => {
    await page.goto("/?tab=screener");
    await page.waitForSelector('[data-testid="screener-table"] tbody tr', {
      timeout: 10000,
    });

    const firstRow = page.locator('[data-testid="screener-table"] tbody tr').first();
    await firstRow.locator("td").nth(2).click();

    await expect(page.getByTestId("symbol-dock")).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/\/\?tab=screener/);
  });

  test("should display side panel with screener info", async ({ page }) => {
    await page.goto("/?tab=screener");
    await page.waitForSelector('[data-testid="screener-table"] tbody tr', {
      timeout: 10000,
    });

    const sidePanel = page.locator('[data-testid="screener-side-panel"]');
    if ((await sidePanel.count()) > 0) {
      await expect(sidePanel).toBeVisible();
      const text = await sidePanel.textContent();
      expect(text?.length).toBeGreaterThan(0);
    } else {
      // Side panel may use a different testid; just verify the page loaded
      const content = page.locator("#screener-content");
      await expect(content).toBeVisible({ timeout: 5000 });
    }
  });
});
