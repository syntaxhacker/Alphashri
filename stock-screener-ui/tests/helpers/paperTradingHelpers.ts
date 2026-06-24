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

  // Wait for positions data to load - either table (with data) or empty state
  const positionsTable = page.locator('[data-testid="positions-table-container"]');
  const positionsEmpty = page.locator('[data-testid="positions-empty"]');
  await Promise.race([
    positionsTable.waitFor({ state: "visible", timeout: 20000 }),
    positionsEmpty.waitFor({ state: "visible", timeout: 20000 }),
  ]).catch(() => {});

  // First bot is auto-selected via loadInitialData; confirm with keyboard
  const botSelect = page.locator('[data-testid="bot-select"]');
  await expect(botSelect).toBeVisible({ timeout: 10000 });

  // Open the select dropdown and press Enter to confirm current selection
  await botSelect.click();
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");

  // Wait a moment for the selection to register and API calls to start
  await page.waitForTimeout(500);

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
  await expect(page.locator('[data-testid="tab-live"]')).toBeVisible();
  await expect(page.locator('[data-testid="trade-history-tab"]')).toBeVisible();
  await expect(page.locator('[data-testid="tab-settings"]')).toBeVisible();
}

/**
 * Get bot selector cards
 */
export function getBotSelector(page: Page) {
  return page.locator('[data-testid="bot-select"]');
}
