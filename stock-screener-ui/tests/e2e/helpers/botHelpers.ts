import { Page, expect } from "@playwright/test";

export const TEST_BOT_UUID = "550e8400-e29b-41d4-a716-446655440000";

export interface LivePositionOverrides {
  symbol?: string;
  side?: string;
  quantity?: number;
  entry_price?: number;
  current_price?: number;
  pnl?: number;
  pnl_pct?: number;
  stop_loss?: number;
  take_profit?: number;
}

export function createLivePosition(overrides: LivePositionOverrides = {}): LivePositionOverrides & {
  symbol: string;
  side: string;
  quantity: number;
  entry_price: number;
  current_price: number;
  pnl: number;
  pnl_pct: number;
} {
  return {
    symbol: "TCS",
    side: "BUY",
    quantity: 10,
    entry_price: 3750,
    current_price: 3800,
    pnl: 500,
    pnl_pct: 1.33,
    stop_loss: 3700,
    take_profit: 3900,
    ...overrides,
  };
}

export interface SetupBotApiMocksOptions {
  botId?: string;
  botName?: string;
  strategies?: { id: number; name: string; allocation: number }[];
  positions?: object[];
  scanItems?: object[];
  isRunning?: boolean;
}

export async function setupBotApiMocks(page: Page, options: SetupBotApiMocksOptions = {}) {
  const {
    botId = TEST_BOT_UUID,
    botName = "Test Bot",
    strategies = [
      { id: 1, name: "ORB Conservative", allocation: 0.5 },
      { id: 2, name: "SR Breakout", allocation: 0.3 },
      { id: 3, name: "52W Chaser", allocation: 0.2 },
    ],
    positions = [],
    scanItems = [],
    isRunning = false,
  } = options;

  await page.route("**/api/bots", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: botId,
          name: botName,
          strategies: strategies.map((s) => ({ id: s.id, name: s.name, allocation: s.allocation })),
          is_active: true,
          is_running: false,
        },
      ]),
    });
  });

  await page.route("**/api/bots/summary", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: botId,
          name: botName,
          is_active: true,
          running: isRunning,
          pid: isRunning ? 12345 : null,
          status: isRunning ? "running" : "stopped",
          position_count: positions.length,
          strategies: strategies.map((s) => ({
            id: String(s.id),
            name: s.name,
            strategy_type: "ORB",
          })),
        },
      ]),
    });
  });

  await page.route(`**/api/bots/${botId}/start`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "success", pid: 12345 }),
    });
  });

  await page.route(`**/api/bots/${botId}/stop`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "success" }),
    });
  });

  await page.route(`**/api/bots/${botId}/status`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        is_running: isRunning,
        pid: isRunning ? 12345 : null,
        portfolio: { cash: 100000, equity: 105000 },
        positions: [],
        strategies: strategies.map((s) => ({
          id: s.id,
          name: s.name,
          pnl: Math.floor(Math.random() * 5000),
        })),
      }),
    });
  });

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
        positions: [],
      }),
    });
  });

  await page.route(`**/api/bots/${botId}/positions`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ positions, count: positions.length }),
    });
  });

  await page.route("**/api/paper/positions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ positions, count: positions.length }),
    });
  });

  await page.route(`**/api/bots/${botId}/scan*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ bot_id: botId, scan_items: scanItems, count: scanItems.length }),
    });
  });

  await page.route("**/api/paper/bot/snapshot", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        watchlist: [],
        open_positions: positions,
        scan_items: scanItems,
        signals: [],
      }),
    });
  });
}

export async function expectPositionsVisible(page: Page, timeout: number = 15000) {
  await expect(page.locator('[data-testid="positions-table-container"]')).toBeVisible({ timeout });
}
