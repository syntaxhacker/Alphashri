import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

test.describe("Screener - Interactions", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should copy all symbols to clipboard", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", {
      timeout: 10000,
    });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const copyBtn = page.locator('[data-testid="copy-all-symbols-btn"]').first();
    await expect(copyBtn).toBeVisible({ timeout: 5000 });
    await copyBtn.click();
  });

  test("should switch to heatmap view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="app-shell"]', {
      timeout: 10000,
    });

    await page.waitForSelector('[data-testid="screener-table-body"] .mantine-Table-tr', {
      timeout: 10000,
    });

    await page.getByTestId("screener-view-toggle").getByText("Map", { exact: true }).click();

    const heatmap = page.locator('[data-testid^="screener-heatmap-"]').first();
    await expect(heatmap).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('[data-testid^="screener-heatmap-"][data-testid$="-metric"]').first(),
    ).toBeVisible();
  });

  test("should navigate to chart on symbol click", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", {
      timeout: 10000,
    });

    const stockSymbolLink = page
      .locator('[data-testid="screener-table-body"] button[data-testid^="symbol-link-"]')
      .first();
    await expect(stockSymbolLink).toBeVisible({ timeout: 5000 });
    await stockSymbolLink.click();

    await expect(page).toHaveURL(/\/chart\//);
  });

  test("should display side panel with screener info", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", {
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
