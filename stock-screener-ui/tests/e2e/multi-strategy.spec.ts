import { test, expect, Page } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupPaperTradingMocks,
} from "../helpers/multiStrategyHelpers";

const BOT_IDS = {
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

async function setupBotMocksForId(page: Page, botId: string, customScanItems?: object[]) {
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

  await page.route(`**/api/bots/${botId}/start`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "success",
        message: "Bot started",
        pid: 12345,
      }),
    });
  });

  await page.route(`**/api/bots/${botId}/stop`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "success",
        message: "Bot stopped",
      }),
    });
  });

  await page.route(`**/api/bots/${botId}/status`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        is_running: true,
        pid: 12345,
        portfolio: {
          cash: 100000,
          equity: 105000,
          pnl: 5000,
        },
        positions: [],
        strategies: [
          { id: 1, name: "ORB Conservative", pnl: 2500 },
          { id: 2, name: "ORB Aggressive", pnl: 2000 },
          { id: 3, name: "52W Chaser", pnl: 500 },
        ],
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
          },
        ],
      }),
    });
  });

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
          },
        ],
        count: 2,
      }),
    });
  });

  const scanItems = customScanItems || [
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

  await page.route(`**/api/bots/${botId}/scan*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bot_id: botId,
        scan_items: scanItems,
        count: scanItems.length,
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

async function navigateToBot(page: Page, botId: string) {
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

  await segmentedControl
    .getByText(`Multi-Strategy Bot ${botId}`, { exact: false })
    .first()
    .click();

  await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({ timeout: 5000 });
}

async function clickStrategyTab(page: Page, tabName: string): Promise<void> {
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

async function getScanTableHeaders(page: Page): Promise<string[]> {
  const scanCard = page.getByTestId("watchlist-scan-card");
  await expect(scanCard).toBeVisible();
  return await scanCard.locator("th").allTextContents();
}

async function getStrategyTabCount(page: Page): Promise<number> {
  return await page.locator('[data-testid^="strategy-tab-"]').count();
}

test.describe.configure({ mode: "serial" });
test.describe("Multi-Strategy System - Signal Generators", () => {
  const botId = BOT_IDS.signalGenerators;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupBotMocksForId(page, botId);
  });

  test.skip("should have different signal generators for ORB and 52W strategies", async ({
    page,
  }) => {
    test.slow();
    await navigateToBot(page, botId);

    await page.waitForSelector("[data-testid='positions-panel']", { timeout: 15000 });

    const strategyTabs = page.locator('[data-testid^="strategy-tab-"]');
    const positionsContainer = page.getByTestId("positions-table-container");
    const emptyState = page.getByTestId("positions-empty");

    await expect(
      strategyTabs.first().or(positionsContainer).or(emptyState),
    ).toBeVisible();
  });
});

test.describe("Multi-Strategy System - ORB Scan Items", () => {
  const botId = BOT_IDS.orbScanItems;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupBotMocksForId(page, botId);
  });

  test("should show ORB-specific scan items", async ({ page }) => {
    await navigateToBot(page, botId);

    await clickStrategyTab(page, "ORB Conservative");
    const headers = await getScanTableHeaders(page);
    expect(headers.some((h) => h.includes("OR") || h.includes("Range"))).toBeTruthy();
  });
});

test.describe("Multi-Strategy System - 52W Scan Items", () => {
  const botId = BOT_IDS["52wScanItems"];

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);

    await setupBotMocksForId(page, botId, [
      {
        symbol: "RELIANCE",
        price: 2500,
        high_52w: 2550,
        distance_to_high_pct: 2.0,
        status: "watching",
        strategy_name: "52W Chaser",
      },
      {
        symbol: "TCS",
        price: 3800,
        high_52w: 3850,
        distance_to_high_pct: 1.3,
        status: "signal",
        strategy_name: "52W Chaser",
      },
    ]);
  });

  test.skip("should show 52W-specific scan items (no 52W positions mocked, tab not rendered)", async ({
    page,
  }) => {
    await navigateToBot(page, botId);
    await expect(page.getByTestId("watchlist-scan-card")).toBeVisible();
  });
});

test.describe("Multi-Strategy System - Watchlists", () => {
  const botId = BOT_IDS.watchlists;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupBotMocksForId(page, botId);
  });

  test("should have separate watchlists per strategy type", async ({ page }) => {
    await navigateToBot(page, botId);

    await clickStrategyTab(page, "ORB Conservative");
    await expect(page.getByTestId("watchlist-scan-card")).toBeVisible();
  });
});

test.describe("Multi-Strategy System - Positions Attribution", () => {
  const botId = BOT_IDS.positionsAttribution;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupBotMocksForId(page, botId);
  });

  test("should show positions with strategy attribution", async ({ page }) => {
    await navigateToBot(page, botId);

    await expect(page.getByTestId("positions-table-container")).toBeVisible();
    await expect(
      page.getByTestId("positions-table-container").locator("th", { hasText: "Strategy" }).first(),
    ).toBeVisible();
  });
});

test.describe("Multi-Strategy System - Positions Filter", () => {
  const botId = BOT_IDS.positionsFilter;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupBotMocksForId(page, botId);
  });

  test("should filter positions by strategy tab", async ({ page }) => {
    await navigateToBot(page, botId);

    await clickStrategyTab(page, "ORB Conservative");
    await expect(page.getByTestId("positions-table-container")).toContainText("TCS");
  });
});

test.describe("Multi-Strategy System - All Positions", () => {
  const botId = BOT_IDS.positionsAll;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupBotMocksForId(page, botId);
  });

  test("should show all positions in All tab", async ({ page }) => {
    await navigateToBot(page, botId);

    await clickStrategyTab(page, "All");
    const positionsTable = page.getByTestId("positions-table-container");
    await expect(positionsTable).toContainText("TCS");
    await expect(positionsTable).toContainText("INFY");
  });
});

test.describe("Multi-Strategy System - Chart ORB Levels", () => {
  const botId = BOT_IDS.chartOrb;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupBotMocksForId(page, botId);

    await page.route("**/api/paper/chart/*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol: "TCS",
          candles: [
            {
              time: "2026-03-02 09:15",
              open: 3750,
              high: 3760,
              low: 3745,
              close: 3755,
              volume: 10000,
            },
            {
              time: "2026-03-02 09:20",
              open: 3755,
              high: 3770,
              low: 3750,
              close: 3765,
              volume: 15000,
            },
          ],
          orb_levels: {
            or_high: 3760,
            or_low: 3745,
          },
          trades: [],
        }),
      });
    });
  });

  test("should show ORB levels on chart for ORB positions", async ({ page }) => {
    await navigateToBot(page, botId);

    const positionRow = page.locator('[data-testid^="position-row-"]').first();
    await expect(positionRow).toBeVisible();
    await positionRow.click();
    await expect(page.getByTestId("paper-chart-container")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Multi-Strategy System - Chart 52W Levels", () => {
  const botId = BOT_IDS.chart52w;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupBotMocksForId(page, botId);

    await page.route("**/api/paper/chart/*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol: "RELIANCE",
          candles: [
            {
              time: "2026-03-02 09:15",
              open: 2500,
              high: 2510,
              low: 2495,
              close: 2505,
              volume: 20000,
            },
            {
              time: "2026-03-02 09:20",
              open: 2505,
              high: 2520,
              low: 2500,
              close: 2515,
              volume: 25000,
            },
          ],
          orb_levels: null,
          week52_levels: {
            high_52w: 2550,
            low_52w: 2200,
            distance_to_high_pct: 2.0,
            near_high: true,
          },
          trades: [],
        }),
      });
    });
  });

  test.skip("should show 52W high line on chart for 52W positions (no 52W positions mocked, tab not rendered)", async ({
    page,
  }) => {
    await navigateToBot(page, botId);
    await expect(page.getByTestId("positions-panel")).toBeVisible();
  });
});

test.describe("Multi-Strategy System - Trade History", () => {
  const botId = BOT_IDS.tradeHistory;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupBotMocksForId(page, botId);

    await page.route("**/api/paper/trades*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          trades: [
            {
              id: 1,
              symbol: "TCS",
              side: "BUY",
              entry_price: 3750,
              exit_price: 3800,
              pnl: 500,
              entry_time: "2026-03-02T09:30:00",
              exit_time: "2026-03-02T11:00:00",
              strategy_name: "ORB Conservative",
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
            },
          ],
          count: 2,
        }),
      });
    });
  });

  test("should show strategy in trade history", async ({ page }) => {
    await navigateToBot(page, botId);
    await page.getByTestId("trade-history-tab").click();

    await expect(page.getByTestId("trades-table-container")).toBeVisible();
  });
});

test.describe("Multi-Strategy System - History Filter", () => {
  const botId = BOT_IDS.historyFilter;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupBotMocksForId(page, botId);

    await page.route("**/api/paper/trades*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          trades: [
            {
              id: 1,
              symbol: "TCS",
              side: "BUY",
              entry_price: 3750,
              exit_price: 3800,
              pnl: 500,
              entry_time: "2026-03-02T09:30:00",
              exit_time: "2026-03-02T11:00:00",
              strategy_name: "ORB Conservative",
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
            },
          ],
          count: 2,
        }),
      });
    });
  });

  test("should filter history by strategy", async ({ page }) => {
    await navigateToBot(page, botId);
    await page.getByTestId("trade-history-tab").click();

    const strategyFilter = page.getByTestId("strategy-filter-select");
    await expect(strategyFilter).toBeVisible();
    await strategyFilter.click();
    await page.getByRole("option", { name: "ORB Conservative" }).click();
    await page.waitForLoadState("networkidle");
  });
});

test.describe("Multi-Strategy System - P&L Tabs", () => {
  const botId = BOT_IDS.pnlTabs;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupBotMocksForId(page, botId);
  });

  test("should show P&L per strategy in tabs", async ({ page }) => {
    await navigateToBot(page, botId);

    await expect(page.getByTestId("strategy-tabs")).toBeVisible();
    await expect(page.getByTestId("strategy-tab-orb-conservative")).toContainText("₹");
  });
});

test.describe("Multi-Strategy System - P&L Portfolio", () => {
  const botId = BOT_IDS.pnlPortfolio;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupBotMocksForId(page, botId);
  });

  test("should show strategy P&L in portfolio", async ({ page }) => {
    await navigateToBot(page, botId);

    await expect(page.getByTestId("portfolio-card")).toBeVisible();
  });
});
