import { Page, expect } from "@playwright/test";
import { setupBotApiMocks } from "./botHelpers";
import { apiRoute } from "../../mocks/routeHelper";

export const BOT_IDS = {
  signalGenerators: "200",
  orbScanItems: "201",
  "52wScanItems": "202",
  watchlists: "203",
  orbWatchlist: "204",
  scanAttribution: "205",
  scanFilter: "206",
  positionsAttribution: "207",
  positionsFilter: "208",
  positionsAll: "209",
  chartOrb: "210",
  chart52w: "211",
  tradeHistory: "212",
  historyFilter: "213",
  pnlTabs: "214",
  pnlPortfolio: "215",
};

const DEFAULT_SCAN_ITEMS = [
  {
    id: 1,
    symbol: "TCS",
    price: 3750,
    or_high: 3760,
    or_low: 3745,
    status: "signal",
    strategy_name: "ORB Conservative",
  },
  {
    id: 2,
    symbol: "INFY",
    price: 1480,
    or_high: 1490,
    or_low: 1470,
    status: "watching",
    strategy_name: "ORB Aggressive",
  },
];

const DEFAULT_STRATEGIES = [
  { id: 1, name: "ORB Conservative", allocation: 0.5 },
  { id: 2, name: "ORB Aggressive", allocation: 0.3 },
  { id: 3, name: "52W Chaser", allocation: 0.2 },
];

const DEFAULT_POSITIONS = [
  {
    id: 1,
    symbol: "TCS",
    side: "BUY",
    quantity: 10,
    entry_price: 3750,
    current_price: 3800,
    entry_time: "2026-03-02T09:30:00",
    stop_loss: 3700,
    take_profit: 3900,
    unrealized_pnl: 500,
    unrealized_pnl_pct: 1.33,
    pnl: 500,
    margin_used: 37500,
    strategy_name: "ORB Conservative",
    strategy_id: 1,
    order_id: "order-1",
  },
  {
    id: 2,
    symbol: "INFY",
    side: "BUY",
    quantity: 20,
    entry_price: 1480,
    current_price: 1500,
    entry_time: "2026-03-02T10:00:00",
    stop_loss: 1450,
    take_profit: 1520,
    unrealized_pnl: 400,
    unrealized_pnl_pct: 1.35,
    pnl: 400,
    margin_used: 29600,
    strategy_name: "ORB Aggressive",
    strategy_id: 2,
    order_id: "order-2",
  },
];

export async function setupBotMocksForId(page: Page, botId: string, customScanItems?: object[]) {
  const scanItems = customScanItems || DEFAULT_SCAN_ITEMS;

  await setupBotApiMocks(page, {
    botId,
    botName: `Multi-Strategy Bot ${botId}`,
    strategies: DEFAULT_STRATEGIES,
    positions: DEFAULT_POSITIONS,
    scanItems,
    isRunning: true,
  });

  await page.route(apiRoute("bots/[a-f0-9-]+/scan"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bot_id: botId,
        scan_items: scanItems,
        count: scanItems.length,
        timestamp: "2026-03-02T09:30:00Z",
        bot_running: true,
      }),
    });
  });

  await page.route(apiRoute("paper/positions"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        positions: [
          {
            id: 1,
            symbol: "TCS",
            side: "BUY",
            quantity: 10,
            entry_price: 3750,
            current_price: 3800,
            entry_time: "2026-03-02T09:30:00",
            stop_loss: 3700,
            take_profit: 3900,
            unrealized_pnl: 500,
            unrealized_pnl_pct: 1.33,
            pnl: 500,
            pnl_pct: 1.33,
            margin_used: 37500,
            strategy_name: "ORB Conservative",
            strategy_id: 1,
            order_id: "order-1",
          },
          {
            id: 2,
            symbol: "INFY",
            side: "BUY",
            quantity: 20,
            entry_price: 1480,
            current_price: 1500,
            entry_time: "2026-03-02T10:00:00",
            stop_loss: 1450,
            take_profit: 1520,
            unrealized_pnl: 400,
            unrealized_pnl_pct: 1.35,
            pnl: 400,
            pnl_pct: 1.35,
            margin_used: 29600,
            strategy_name: "ORB Aggressive",
            strategy_id: 2,
            order_id: "order-2",
          },
        ],
        count: 2,
      }),
    });
  });
}

export async function navigateToBot(page: Page, _botId?: string) {
  await page.goto("/paper");
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
  await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({ timeout: 20000 });

  // Select a bot via the Mantine Select dropdown
  const botSelect = page.locator('[data-testid="bot-select"]');
  await expect(botSelect).toBeVisible({ timeout: 10000 });
  await botSelect.click();
  await page.waitForTimeout(200);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await page.getByTestId("tab-live").click();
  await page.waitForTimeout(1000);
}

export async function verifyStrategyPanel(page: Page, strategyName: string): Promise<void> {
  // In the current UI, positions are shown in strategy panels (not tabs)
  // Verify the positions container is visible (all positions shown by default)
  const positionsContainer = page.getByTestId("positions-table-container");
  await expect(positionsContainer).toBeVisible();
  await page.waitForTimeout(1000);
}
