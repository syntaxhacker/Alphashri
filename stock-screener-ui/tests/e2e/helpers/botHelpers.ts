import { Page, expect } from "@playwright/test";
import { apiRoute } from "../../mocks/routeHelper";
import { setupApiMocks, loginAsTestUser } from "../../mocks/apiResponses";

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

export async function mockPaperBotSnapshot(
  page: Page,
  options: { openPositions?: object[]; scanItems?: object[] } = {},
) {
  const { openPositions = [], scanItems = [] } = options;
  await page.route(apiRoute("paper/bot/snapshot"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        watchlist: [],
        open_positions: openPositions,
        scan_items: scanItems,
        signals: [],
      }),
    });
  });
}

// Shared /paper entry flow: open the page, select the first bot in the dropdown, land on the Live tab.
export async function gotoPaperAndSelectFirstBot(page: Page) {
  await page.goto("/paper");
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
  await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({ timeout: 20000 });

  await page.waitForSelector('[data-testid="bot-select"]', { state: "visible", timeout: 10000 });
  // bot-select is a non-searchable Select, which renders a native <select>:
  // there is no role=option popup to wait for. Pick the first real bot value.
  const botSelect = page.locator('[data-testid="bot-select"] select');
  await expect(botSelect).toBeVisible({ timeout: 5000 });
  const firstValue = await botSelect
    .locator("option")
    .first()
    .getAttribute("value");
  if (firstValue) await botSelect.selectOption(firstValue);

  await page.getByTestId("tab-live").click();
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

  await page.route(apiRoute("bots"), async (route) => {
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

  await page.route(apiRoute("bots/summary"), async (route) => {
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

  await page.route(apiRoute("bots/[a-f0-9-]+"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: botId,
        name: botName,
        is_active: true,
        is_running: isRunning,
        pid: isRunning ? 12345 : null,
        strategies: strategies.map((s) => ({
          id: String(s.id),
          name: s.name,
          strategy_type: "ORB",
          allocation: s.allocation,
        })),
      }),
    });
  });

  await page.route(apiRoute("bots/[a-f0-9-]+/start"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "success", pid: 12345 }),
    });
  });

  await page.route(apiRoute("bots/[a-f0-9-]+/stop"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "success" }),
    });
  });

  await page.route(apiRoute("bots/[a-f0-9-]+/status"), async (route) => {
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

  await page.route(apiRoute("bots/[a-f0-9-]+/portfolio"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        portfolio: {
          initial_capital: 1000000,
          cash: 950000,
          equity: 1006000,
          margin_used: 50000,
          unrealized_pnl: 1000,
          realized_pnl: 5000,
          total_value: 1006000,
          total_pnl: 6000,
          total_pnl_pct: 0.6,
          positions: positions.length,
          trades: 5,
          daily_pnl: 1000,
          daily_pnl_pct: 0.1,
          daily_trades: 2,
          open_positions: positions.length,
          total_positions: positions.length,
        },
      }),
    });
  });

  await mockPositionsRoute(page, "bots/[a-f0-9-]+/positions", positions);
  await mockPositionsRoute(page, "paper/positions", positions);

  await page.route(apiRoute("bots/[a-f0-9-]+/scan"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ bot_id: botId, scan_items: scanItems, count: scanItems.length }),
    });
  });

  await mockPaperBotSnapshot(page, { openPositions: positions, scanItems });
}

export async function expectPositionsVisible(page: Page, timeout: number = 15000) {
  await expect(page.locator('[data-testid="positions-table-container"]')).toBeVisible({ timeout });
}

export async function mockPositionsRoute(page: Page, urlPattern: string, positions: object[]) {
  await page.route(apiRoute(urlPattern), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ positions, count: positions.length }),
    });
  });
}

/** Mock the bot detail route. `running` may be a static boolean or a live getter. */
export async function mockBotDetailRoute(
  page: Page,
  botId: string,
  running: boolean | (() => boolean),
) {
  await page.route(apiRoute(`bots/${botId}`), async (route) => {
    const isRunning = typeof running === "function" ? running() : running;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: botId,
        name: "Multi-ORB Test Bot",
        is_active: true,
        strategies: [],
        running: isRunning,
        pid: isRunning ? 22133 : null,
      }),
    });
  });
}

/** Mock the bots/summary route. `running` may be a static boolean or a live getter. */
export async function mockBotSummaryRoute(
  page: Page,
  botId: string,
  running: boolean | (() => boolean),
  options: { positionCount?: number } = {},
) {
  const { positionCount = 0 } = options;
  await page.route(apiRoute("bots/summary"), async (route) => {
    const isRunning = typeof running === "function" ? running() : running;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: botId,
          name: "Multi-ORB Test Bot",
          is_active: true,
          running: isRunning,
          pid: isRunning ? 22133 : null,
          status: isRunning ? "running" : "stopped",
          position_count: positionCount,
          strategies: [],
        },
      ]),
    });
  });
}

export async function setupBotsMocks(page: Page): Promise<void> {
  await setupApiMocks(page);
  await loginAsTestUser(page);
}

export async function navigateToBotsView(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 });
  await page.locator('[data-testid="nav-bots"]').click();
  await page.waitForTimeout(500);
}

export async function gotoBotsView(page: Page): Promise<void> {
  await page.goto("/bots");
  await page.waitForSelector('[data-testid="bots-view"]', { timeout: 10000 });
  await page.waitForTimeout(2000);
}

export async function expectBotsViewVisible(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="bots-view"]')).toBeVisible();
}

export function getBotListItems(page: Page) {
  return page.locator('[data-testid^="bot-row-"]');
}

export function getBotStatus(page: Page) {
  return page.locator('[data-testid^="bot-row-"] [data-testid^="bot-status-"]');
}

export async function mockBotsListRoute(page: Page, bots: any[]) {
  await page.route(apiRoute("bots"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(bots),
    });
  });
}

export async function mockAvailableStrategiesRoute(page: Page, strategies: any[]) {
  await page.route(apiRoute("bots/available-strategies"), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(strategies),
    });
  });
}

export async function gotoBotsViewAndWait(page: Page) {
  await gotoBotsView(page);
  await page.waitForSelector('[data-testid="bot-row-"]', { timeout: 10000 }).catch(() => {});
}

export async function mockCreateBotRoute(
  page: Page,
  botId: string,
  botName: string,
  maxPositions: number = 10,
  maxCapitalPct: number = 0.8,
) {
  await page.route(apiRoute("bots"), async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: botId,
          name: botName,
          is_active: true,
          max_total_positions: maxPositions,
          max_total_capital_pct: maxCapitalPct,
          strategies: body?.strategies ?? [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          running: false,
          pid: null,
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    }
  });
}

export async function createBotAndSave(page: Page, botName: string, addStrategyCount: number = 1) {
  await gotoBotsViewAndWait(page);
  await page.locator('[data-testid="create-bot-btn"]').click();
  await expect(page.locator('[data-testid="bot-config-form"]')).toBeVisible();
  await page.locator('[data-testid="bot-name-input"]').fill(botName);
  for (let i = 0; i < addStrategyCount; i++) {
    await page.locator('[data-testid="add-strategy-btn"]').click();
  }
  if (addStrategyCount > 1) {
    await expect(page.locator('[data-testid="strategy-allocation-row"]')).toHaveCount(
      addStrategyCount,
    );
  }
  await page.locator('[data-testid="save-bot-config-btn"]').click();
  await expect(page.locator('[data-testid="bot-config-form"]')).toBeHidden();
}
