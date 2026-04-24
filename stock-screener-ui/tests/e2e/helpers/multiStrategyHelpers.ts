import { Page, expect } from "@playwright/test";

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

async function mockBotListEndpoint(page: Page, botId: string) {
  await page.route("**/api/bots", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: botId,
          name: `Multi-Strategy Bot ${botId}`,
          strategies: [
            { id: 1, name: "ORB Conservative", allocation: 0.5 },
            { id: 2, name: "ORB Aggressive", allocation: 0.3 },
            { id: 3, name: "52W Chaser", allocation: 0.2 },
          ],
          is_active: true,
          is_running: false,
        },
      ]),
    });
  });
}

async function mockBotControlEndpoints(page: Page, botId: string) {
  await page.route(`**/api/bots/${botId}/start`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "success", message: "Bot started", pid: 12345 }),
    });
  });

  await page.route(`**/api/bots/${botId}/stop`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "success", message: "Bot stopped" }),
    });
  });

  await page.route(`**/api/bots/${botId}/status`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        is_running: true,
        pid: 12345,
        portfolio: { cash: 100000, equity: 105000, pnl: 5000 },
        positions: [],
        strategies: [
          { id: 1, name: "ORB Conservative", pnl: 2500 },
          { id: 2, name: "ORB Aggressive", pnl: 2000 },
          { id: 3, name: "52W Chaser", pnl: 500 },
        ],
      }),
    });
  });
}

async function mockBotPortfolioEndpoint(page: Page, botId: string) {
  await page.route(`**/api/bots/${botId}/portfolio`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cash: 100000,
        equity: 105000,
        pnl: 5000,
        margin_used: 50000,
        daily_pnl: 1000,
        positions: [
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
            entry_price: 1480,
            exit_price: 1500,
            pnl: 400,
            entry_time: "2026-03-02T10:00:00",
            exit_time: "2026-03-02T14:00:00",
            strategy_name: "ORB Aggressive",
            strategy_id: 2,
          },
        ],
      }),
    });
  });
}

async function mockBotPositionsEndpoint(page: Page, botId: string) {
  await page.route(`**/api/bots/${botId}/positions`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        positions: [
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
        ],
        count: 2,
      }),
    });
  });
}

async function mockScanItemsEndpoint(page: Page, botId: string, scanItems: object[]) {
  await page.route(`**/api/bots/${botId}/scan*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ bot_id: botId, scan_items: scanItems, count: scanItems.length }),
    });
  });
}

async function mockPaperPositionsEndpoint(page: Page) {
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

async function mockBotSnapshotEndpoint(page: Page, botId: string, scanItems: object[]) {
  await page.route("**/api/paper/bot/snapshot", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        watchlist: [],
        open_positions: [
          {
            id: 1,
            symbol: "TCS",
            side: "BUY",
            quantity: 10,
            entry_price: 3750,
            current_price: 3800,
            pnl: 500,
            strategy_name: "ORB Conservative",
          },
          {
            id: 2,
            symbol: "INFY",
            side: "BUY",
            quantity: 20,
            entry_price: 1480,
            current_price: 1500,
            pnl: 400,
            strategy_name: "ORB Aggressive",
          },
        ],
        scan_items: scanItems,
        signals: [],
      }),
    });
  });
}

export async function setupBotMocksForId(page: Page, botId: string, customScanItems?: object[]) {
  const scanItems = customScanItems || DEFAULT_SCAN_ITEMS;

  await mockBotListEndpoint(page, botId);
  await mockBotControlEndpoints(page, botId);
  await mockBotPortfolioEndpoint(page, botId);
  await mockBotPositionsEndpoint(page, botId);
  await mockScanItemsEndpoint(page, botId, scanItems);
  await mockPaperPositionsEndpoint(page);
  await mockBotSnapshotEndpoint(page, botId, scanItems);
}

export async function navigateToBot(page: Page, botId: string) {
  await page.goto("/paper");
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
  await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({ timeout: 20000 });

  const segmentedControl = page.locator('[data-testid="bot-selector-dropdown"]');
  await segmentedControl.waitFor({ state: "visible", timeout: 10000 });

  await page.waitForFunction(
    () => {
      const control = document.querySelector('[data-testid="bot-selector-dropdown"]');
      if (!control) return false;
      const radios = control.querySelectorAll('input[type="radio"]');
      return radios.length >= 1;
    },
    { timeout: 20000 },
  );

  await segmentedControl.getByText(`Multi-Strategy Bot ${botId}`, { exact: false }).first().click();

  await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({ timeout: 5000 });
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
