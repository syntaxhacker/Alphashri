import { Page, Route, expect } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupPaperTradingMocks,
  setupMultiStrategyBotMocks,
  mockRoute,
  mockBots,
  mockScanItems,
  mockBotPositions,
} from "../mocks/apiResponses";

// Re-export for convenience
export { setupMultiStrategyBotMocks, setupApiMocks, loginAsTestUser, setupPaperTradingMocks };

/**
 * Setup all required mocks for multi-strategy tests
 */
export async function setupMultiStrategyMocks(page: Page): Promise<void> {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupPaperTradingMocks(page);
  await setupMultiStrategyBotMocks(page);
}

/**
 * Navigate to Paper Trading and select multi-strategy bot
 */
export async function navigateToMultiStrategyBot(page: Page, botId: string = "2"): Promise<void> {
  // Navigate directly to paper trading URL
  await page.goto("/paper");
  await page.waitForSelector(".sidemenu", { timeout: 15000 });
  await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({ timeout: 20000 });
  await page.locator(".bot-selector-dropdown").selectOption(botId);
  await page.waitForSelector(".portfolio-card", { timeout: 5000 });
}

/**
 * Click on a strategy tab by name
 */
export async function clickStrategyTab(page: Page, tabName: string): Promise<boolean> {
  const tab = page.locator(`.strategy-tab:has-text('${tabName}')`);
  if ((await tab.count()) > 0) {
    await tab.click();
    await page.waitForTimeout(300);
    return true;
  }
  return false;
}

/**
 * Get scan table headers
 */
export async function getScanTableHeaders(page: Page): Promise<string[] | null> {
  const scanTable = page.locator(".scan-table");
  if ((await scanTable.count()) > 0) {
    return await scanTable.locator("th").allTextContents();
  }
  return null;
}

/**
 * Check if strategy tabs are present and return count
 */
export async function getStrategyTabCount(page: Page): Promise<number> {
  return await page.locator(".strategy-tab").count();
}
