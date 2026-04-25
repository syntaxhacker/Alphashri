import { Page, expect } from "@playwright/test";
import { setupBotApiMocks } from "./botHelpers";

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
    qty: 10,
    entry_price: 3750,
    current_price: 3800,
    pnl: 500,
    pnl_pct: 1.33,
    strategy_name: "ORB Conservative",
    strategy_id: 1,
  },
  {
    id: 2,
    symbol: "INFY",
    side: "BUY",
    qty: 20,
    entry_price: 1480,
    current_price: 1500,
    pnl: 400,
    pnl_pct: 1.35,
    strategy_name: "ORB Aggressive",
    strategy_id: 2,
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

  await page.route(`**/api/bots/${botId}/scan`, async (route) => {
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

  await page.route("**/api/paper/positions", async (route) => {
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
            pnl: 500,
            pnl_pct: 1.33,
            margin_used: 37500,
            strategy_name: "ORB Conservative",
            strategy_id: 1,
            sl: 3700,
            tp: 3900,
            entry_time: "2026-03-02T09:30:00",
          },
          {
            id: 2,
            symbol: "INFY",
            side: "BUY",
            quantity: 20,
            entry_price: 1480,
            current_price: 1500,
            pnl: 400,
            pnl_pct: 1.35,
            margin_used: 29600,
            strategy_name: "ORB Aggressive",
            strategy_id: 2,
            sl: 1450,
            tp: 1520,
            entry_time: "2026-03-02T10:00:00",
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

  // Click the first available bot card — no waiting for specific cards to appear
  const firstBotCard = page.locator('[data-testid^="bot-card-"]').first();
  await firstBotCard.click();

  await page.getByTestId("tab-live").click();
  await page.waitForLoadState("networkidle");
}

export async function clickStrategyTab(page: Page, tabName: string): Promise<void> {
  if (tabName === "All") {
    await expect(page.getByTestId("strategy-tab-all")).toBeVisible();
    await page.getByTestId("strategy-tab-all").click();
  } else {
    const partial = tabName.replace(/\s+/g, "-").toLowerCase();
    const tab = page.locator(`[data-testid^="strategy-tab-${partial}"]`);
    await expect(tab.first()).toBeVisible();
    await tab.first().click();
  }
  await page.waitForLoadState("networkidle");
}
