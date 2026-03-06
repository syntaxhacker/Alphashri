import { Page } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupPaperTradingMocks,
  setupMultiStrategyBotMocks,
} from "../mocks/apiResponses";

/**
 * Setup all required mocks for paper trading tests
 */
export async function setupPaperTradingTestMocks(page: Page): Promise<void> {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupPaperTradingMocks(page);
  await setupMultiStrategyBotMocks(page);
}

/**
 * Navigate to Paper Trading view
 */
export async function navigateToPaperTrading(page: Page): Promise<void> {
  // Navigate directly to paper trading URL
  await page.goto("/paper");
  await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 15000 });
  await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({ timeout: 20000 });
}

/**
 * Navigate to Paper Trading and select a bot
 */
export async function navigateToPaperTradingWithBot(
  page: Page,
  botId: string = "2",
): Promise<void> {
  await navigateToPaperTrading(page);

  // Wait for bot selector to be populated
  const dropdown = page.locator(".bot-selector-dropdown");
  await dropdown.waitFor({ state: "visible", timeout: 10000 });

  // Wait for options to be populated (bots API call completes)
  await page.waitForFunction(
    (selector) => {
      const select = document.querySelector(selector);
      return select && select.querySelectorAll("option[value]").length > 0;
    },
    ".bot-selector-dropdown",
    { timeout: 10000 },
  );

  await dropdown.selectOption(botId);
  await page.waitForTimeout(500);
}

/**
 * Verify tabs are visible
 */
export async function verifyPaperTradingTabs(page: Page): Promise<void> {
  await expect(page.locator('button:has-text("LivePositions")')).toBeVisible();
  await expect(page.locator('button:has-text("Trade History")')).toBeVisible();
  await expect(page.locator('button:has-text("Settings")')).toBeVisible();
}

/**
 * Click on a tab in Paper Trading view
 */
export async function clickPaperTradingTab(page: Page, tabName: string): Promise<void> {
  const tab = page.locator(`button:has-text("${tabName}")`);
  await page.waitForTimeout(300);
}



/**
 * Get bot selector dropdown
 */
export function getBotSelector(page: Page) {
  return page.locator(".bot-selector-dropdown");
}

/**
 * Get portfolio card
 */
export function getPortfolioCard(page: Page) {
  return page.locator(".portfolio-card");
}

// Import expect for use in helper functions
import { expect } from "@playwright/test";
