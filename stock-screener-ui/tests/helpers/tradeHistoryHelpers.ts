import { Page, Locator, expect } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupPaperTradingMocks,
  setupMultiStrategyBotMocks,
} from "../mocks/apiResponses";

/**
 * Setup all required mocks for trade history tests
 * Combines API mocks, user authentication, and paper trading mocks
 */
export async function setupTradeHistoryMocks(page: Page): Promise<void> {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupPaperTradingMocks(page);
  await setupMultiStrategyBotMocks(page);
}

/**
 * Navigate to the Paper Trading section
 */
export async function navigateToPaperTrading(page: Page): Promise<void> {
  // Navigate directly to paper trading URL
  await page.goto("/paper");
  await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 20000 });
  await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({ timeout: 30000 });
}

/**
 * Navigate to the Trade History tab within Paper Trading
 */
export async function navigateToTradeHistoryTab(page: Page): Promise<void> {
  const tabButton = page.locator('[data-testid="trade-history-tab"]');
  await tabButton.click();
  // Wait for the history panel to appear (it may take a moment for React to re-render)
  await page.waitForSelector('[data-testid="history-panel"]', { timeout: 20000 });
}

/**
 * Complete navigation from home to Trade History tab
 * Combines navigateToPaperTrading and navigateToTradeHistoryTab
 */
export async function navigateToTradeHistory(page: Page): Promise<void> {
  await page.goto("/");
  await navigateToPaperTrading(page);
  await navigateToTradeHistoryTab(page);
}

/**
 * Select a bot from the dropdown by its ID
 */
export async function selectBot(page: Page, botId: string): Promise<void> {
  const dropdown = page.locator(".bot-selector-dropdown");
  await dropdown.waitFor({ state: "visible" });
  await page.waitForFunction(
    (sel) => {
      const select = document.querySelector(sel);
      return select && select.querySelectorAll("option[value]").length > 1;
    },
    ".bot-selector-dropdown",
    { timeout: 10000 }
  );
  await dropdown.selectOption(botId);
  await page.waitForTimeout(500);
}

/**
 * Navigate to Trade History and select a specific bot
 */
export async function navigateToTradeHistoryWithBot(
  page: Page,
  botId: string = "550e8400-e29b-41d4-a716-446655440000",
): Promise<void> {
  await navigateToTradeHistory(page);
  await selectBot(page, botId);
}

/**
 * Verify that the history panel is visible
 */
export async function verifyHistoryPanelVisible(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="history-panel"]')).toBeVisible();
}

/**
 * Verify that the trades table is visible (if present)
 */
export async function verifyTradesTableVisible(page: Page): Promise<boolean> {
  const historyTable = page.locator('[data-testid^="trades-table"]');
  const count = await historyTable.count();
  if (count > 0) {
    await expect(historyTable.first()).toBeVisible();
    return true;
  }
  return false;
}

/**
 * Mock empty trade history response
 */
export async function mockEmptyTradeHistory(page: Page): Promise<void> {
  await page.route("**/api/paper/history*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ trades: [], count: 0 }),
    });
  });
}

/**
 * Mock trade history with a specific number of trades
 */
export async function mockTradeHistoryWithCount(page: Page, count: number): Promise<void> {
  const trades = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    symbol: `STOCK${i}`,
    side: "BUY",
    entry_price: 100 + i,
    exit_price: 105 + i,
    pnl: 5,
    timestamp: new Date().toISOString(),
    strategy_name: "ORB",
  }));

  await page.route("**/api/paper/history*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ trades, count }),
    });
  });
}

/**
 * Fill date range filters (if present)
 */
export async function fillDateRangeFilters(
  page: Page,
  fromDate: string,
  toDate: string,
): Promise<boolean> {
  const fromDateInput = page.locator('input[type="date"]').first();
  const toDateInput = page.locator('input[type="date"]').last();

  const fromCount = await fromDateInput.count();
  const toCount = await toDateInput.count();

  if (fromCount > 0 && toCount > 0) {
    await fromDateInput.fill(fromDate);
    await toDateInput.fill(toDate);
    return true;
  }
  return false;
}

/**
 * Click a button matching the given text pattern (if present)
 */
export async function clickButtonIfExists(page: Page, pattern: RegExp): Promise<boolean> {
  const button = page.locator("button, input").filter({ hasText: pattern });
  const count = await button.count();
  if (count > 0) {
    await button.click();
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}

/**
 * Check if pagination controls are visible
 */
export async function isPaginationVisible(page: Page): Promise<boolean> {
  const pagination = page.locator(".pagination, .pager");
  const count = await pagination.count();
  if (count > 0) {
    await expect(pagination).toBeVisible();
    return true;
  }
  return false;
}

/**
 * Click the Next page button (if present)
 */
export async function clickNextPage(page: Page): Promise<boolean> {
  const nextBtn = page.locator("button, input").filter({ hasText: /Next/ });
  const count = await nextBtn.count();
  if (count > 0) {
    await nextBtn.click();
    await page.waitForTimeout(300);
    return true;
  }
  return false;
}

/**
 * Common test setup: setup mocks and navigate to trade history with bot selected
 */
export async function setupTradeHistoryTest(page: Page, botId: string = "2"): Promise<void> {
  await setupTradeHistoryMocks(page);
  await navigateToTradeHistoryWithBot(page, botId);
}

/**
 * Common test setup without bot selection
 */
export async function setupTradeHistoryTestNoBot(page: Page): Promise<void> {
  await setupTradeHistoryMocks(page);
  await navigateToTradeHistory(page);
}
