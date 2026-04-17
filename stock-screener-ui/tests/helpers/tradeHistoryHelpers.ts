import { Page, expect } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupPaperTradingMocks,
  setupMultiStrategyBotMocks,
} from "../mocks/apiResponses";

export async function setupTradeHistoryMocks(page: Page): Promise<void> {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupPaperTradingMocks(page);
  await setupMultiStrategyBotMocks(page);
}

export async function navigateToPaperTrading(page: Page): Promise<void> {
  await page.goto("/paper");
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 20000 });
  await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({ timeout: 30000 });
}

export async function navigateToTradeHistoryTab(page: Page): Promise<void> {
  const tabButton = page.locator('[data-testid="trade-history-tab"]');
  await tabButton.click();
  await page.waitForSelector('[data-testid="history-panel"]', { timeout: 20000 });
}

export async function navigateToTradeHistory(page: Page): Promise<void> {
  await page.goto("/");
  await navigateToPaperTrading(page);
  await navigateToTradeHistoryTab(page);
}

export async function navigateToLiveTab(page: Page): Promise<void> {
  const tabButton = page.locator('[data-testid="tab-live"]');
  await tabButton.click();
  await page.waitForSelector('[data-testid="paper-left-panel"]', { timeout: 20000 });
}

export async function selectBot(page: Page, botId: string): Promise<void> {
  const livePanel = page.locator('[data-testid="paper-left-panel"]');
  const isLiveView = await livePanel.isVisible().catch(() => false);

  if (!isLiveView) {
    await navigateToLiveTab(page);
  }

  const segmentedControl = page.locator('[data-testid="bot-selector-dropdown"]');
  await segmentedControl.waitFor({ state: "visible", timeout: 10000 });

  const botInput = segmentedControl.locator(`input[value="${botId}"]`);
  await expect(botInput).toBeAttached({ timeout: 5000 });
  await botInput.evaluate((el) => (el as HTMLInputElement).click());
  await page.waitForTimeout(500);
}

export async function navigateToTradeHistoryWithBot(
  page: Page,
  botId: string = "550e8400-e29b-41d4-a716-446655440000",
): Promise<void> {
  await navigateToPaperTrading(page);
  await selectBot(page, botId);
  await navigateToTradeHistoryTab(page);
}

export async function verifyHistoryPanelVisible(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="history-panel"]')).toBeVisible();
}

export async function verifyTradesTableVisible(page: Page): Promise<void> {
  const historyTable = page.locator('[data-testid="trades-table-container"]');
  await expect(historyTable).toBeVisible();
}

export async function mockEmptyTradeHistory(page: Page): Promise<void> {
  await page.route("**/api/paper/trades*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ trades: [], total_trades: 0 }),
    });
  });
}

export async function mockTradeHistoryWithCount(page: Page, count: number): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const trades = Array.from({ length: count }, (_, i) => ({
    trade_id: `trade-${i + 1}`,
    symbol: `STOCK${i}`,
    side: i % 2 === 0 ? "BUY" : "SELL",
    quantity: 10,
    entry_price: 100 + i,
    exit_price: 105 + i,
    exit_time: `${today}T${String(9 + (i % 6)).padStart(2, "0")}:${String((i * 15) % 60).padStart(2, "0")}:00`,
    exit_reason: i % 3 === 0 ? "TP" : i % 3 === 1 ? "SL" : "EOD",
    net_pnl: i % 2 === 0 ? 50 : -20,
    strategy_name: i % 2 === 0 ? "ORB Conservative" : "ORB Aggressive",
    bot_name: "Multi-Strategy Bot",
    bot_id: "550e8400-e29b-41d4-a716-446655440000",
  }));

  await page.route("**/api/paper/trades*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ trades, total_trades: count }),
    });
  });
}

export async function mockTradeHistoryWithSampleData(page: Page): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const trades = [
    {
      trade_id: "trade-1",
      symbol: "TCS",
      side: "BUY",
      quantity: 10,
      entry_price: 3750,
      exit_price: 3825,
      exit_time: `${today}T10:30:00`,
      exit_reason: "TP",
      net_pnl: 750,
      strategy_name: "ORB Conservative",
      bot_name: "Multi-Strategy Bot",
      bot_id: "550e8400-e29b-41d4-a716-446655440000",
    },
    {
      trade_id: "trade-2",
      symbol: "INFY",
      side: "BUY",
      quantity: 20,
      entry_price: 1480,
      exit_price: 1455,
      exit_time: `${today}T11:15:00`,
      exit_reason: "SL",
      net_pnl: -500,
      strategy_name: "ORB Aggressive",
      bot_name: "Multi-Strategy Bot",
      bot_id: "550e8400-e29b-41d4-a716-446655440000",
    },
    {
      trade_id: "trade-3",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 5,
      entry_price: 2450,
      exit_price: 2520,
      exit_time: `${today}T14:00:00`,
      exit_reason: "TP",
      net_pnl: 350,
      strategy_name: "ORB Conservative",
      bot_name: "Multi-Strategy Bot",
      bot_id: "550e8400-e29b-41d4-a716-446655440000",
    },
  ];

  await page.route("**/api/paper/trades*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ trades, total_trades: trades.length }),
    });
  });
}

export async function fillDateRangeFilters(
  page: Page,
  fromDate: string,
  toDate: string,
): Promise<void> {
  const fromDateInput = page.locator('[data-testid="filter-from-date"]');
  const toDateInput = page.locator('[data-testid="filter-to-date"]');

  await expect(fromDateInput).toBeVisible();
  await expect(toDateInput).toBeVisible();
  await fromDateInput.fill(fromDate);
  await toDateInput.fill(toDate);
}

export async function clickButtonIfExists(page: Page, pattern: RegExp): Promise<void> {
  const button = page.locator('[data-testid="quick-filter"] input').filter({ hasText: pattern });
  await expect(button.first()).toBeVisible({ timeout: 5000 });
  await button.first().click();
  await page.waitForTimeout(500);
}

export async function selectWeekFilter(page: Page): Promise<void> {
  const quickFilter = page.locator('[data-testid="quick-filter"]');
  await expect(quickFilter).toBeVisible();
  await quickFilter.locator("label", { hasText: "Week" }).click();
  await page.waitForTimeout(500);
}

export async function isPaginationVisible(page: Page): Promise<void> {
  const pagination = page.locator('[data-testid="trades-header"]');
  await expect(pagination).toBeVisible();
}

export async function setupTradeHistoryTest(page: Page, botId: string = "2"): Promise<void> {
  await setupTradeHistoryMocks(page);
  await navigateToTradeHistoryWithBot(page, botId);
}

export async function setupTradeHistoryTestNoBot(page: Page): Promise<void> {
  await setupTradeHistoryMocks(page);
  await navigateToTradeHistory(page);
}
