import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupPaperTradingMocks,
  setupMultiStrategyBotMocks,
} from "../mocks/apiResponses";

test.describe("Paper Chart - Intraday Toggle", () => {
  test("should have intraday switch OFF by default when chart loads", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupMultiStrategyBotMocks(page);

    await page.goto("/paper");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
    await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({
      timeout: 20000,
    });

    const switchElement = page.locator('[data-testid="intraday-switch"]');
    await expect(switchElement).toBeVisible();

    const isChecked = await switchElement.evaluate(
      (el: Element) => (el as HTMLInputElement).checked,
    );
    expect(isChecked).toBe(false);
  });

  test("should show intraday switch in chart header", async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupMultiStrategyBotMocks(page);

    await page.goto("/paper");
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
    await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({
      timeout: 20000,
    });

    const switchElement = page.locator('[data-testid="intraday-switch"]');
    await expect(switchElement).toBeVisible();
  });
});
