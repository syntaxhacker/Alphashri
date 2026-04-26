import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupPaperTradingMocks,
  setupMultiStrategyBotMocks,
} from "../mocks/apiResponses";

test.describe("Paper Chart - Intraday Toggle", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupMultiStrategyBotMocks(page);
  });

  test("should display paper trading view with live tab", async ({ page }) => {
    await page.goto("/paper");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
    await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator('[data-testid="tab-live"]')).toBeVisible();
  });

  test("should have live and history tabs", async ({ page }) => {
    await page.goto("/paper");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
    await expect(page.locator('[data-testid="tab-live"]')).toBeVisible();
    await expect(page.locator('[data-testid="trade-history-tab"]')).toBeVisible();
  });
});
