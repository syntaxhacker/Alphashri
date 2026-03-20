import { Page, expect } from "@playwright/test";
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
  await page.goto("/paper", { timeout: 30000 });
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
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

  // Wait for bot selector to be visible
  const segmentedControl = page.locator('[data-testid="bot-selector-dropdown"]');
  await segmentedControl.waitFor({ state: "visible", timeout: 15000 });

  // For Mantine SegmentedControl with radio buttons, click the label with the bot name
  // If botId is a UUID or "2", click "Multi-Strategy Bot", otherwise click "Default"
  const botName = botId === "default" || botId === "1" ? "Default" : "Multi-Strategy Bot";

  // Wait for the option to be available and click it
  const botLabel = segmentedControl.locator(`label:has-text("${botName}")`);
  const count = await botLabel.count();

  if (count > 0) {
    await botLabel.first().click({ timeout: 10000 });
  } else {
    // Fallback: click directly on the visible text within the control
    await segmentedControl.getByText(botName, { exact: false }).first().click({ timeout: 10000 });
  }

  // Wait a moment for the selection to register and API calls to start
  await page.waitForTimeout(500);

  // Wait for positions to load (either data appears or empty state)
  await page.waitForFunction(
    () => {
      const loadingText = document.body.textContent;
      return !loadingText?.includes("Loading positions...");
    },
    { timeout: 10000 },
  );

  // Additional wait for UI to settle
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
