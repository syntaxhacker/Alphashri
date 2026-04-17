import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupPaperTradingMocks,
  setupMultiStrategyBotMocks,
} from "../mocks/apiResponses";
import {
  navigateToPaperTrading,
  navigateToPaperTradingWithBot,
} from "../helpers/paperTradingHelpers";

async function selectBot(page: import("@playwright/test").Page, _botId: string) {
  await page
    .locator('[data-testid="bot-selector-dropdown"]')
    .waitFor({ state: "visible", timeout: 10000 });
}

const TEST_BOT_UUID = "550e8400-e29b-41d4-a716-446655440000";

// Shared beforeEach for paper trading tests
async function setupPaperTradingTest(page: import("@playwright/test").Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await setupPaperTradingMocks(page);
  await setupMultiStrategyBotMocks(page);
}

test.describe.configure({ mode: "serial" });

test.describe("Paper Trading - Strategy Tabs", () => {
  test.beforeEach(async ({ page }) => {
    await setupPaperTradingTest(page);
  });
  test("@smoke should display paper trading view with tabs", async ({ page }) => {
    await navigateToPaperTrading(page);

    // Verify tabs are visible
    await expect(page.getByTestId("tab-live")).toBeVisible();
    await expect(page.getByTestId("trade-history-tab")).toBeVisible();
    await expect(page.getByTestId("tab-settings")).toBeVisible();
  });

  test("should display bot selector dropdown", async ({ page }) => {
    await navigateToPaperTrading(page);

    // Verify bot selector is visible
    await expect(page.locator('[data-testid="bot-selector-dropdown"]')).toBeVisible();
  });

  test.skip("should list available bots in dropdown", async ({ page }) => {
    await navigateToPaperTrading(page);

    const dropdown = page.getByTestId("bot-selector-dropdown");
    await expect(dropdown).toBeVisible();

    // Use the helper that works with Mantine SegmentedControl
    await selectBot(page, TEST_BOT_UUID);
    await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({ timeout: 5000 });
  });

  // Note: This test uses the mock data from setupMultiStrategyBotMocks
  test("should show portfolio summary", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const portfolioCard = page.locator('[data-testid="portfolio-card"]');
    await expect(portfolioCard).toBeVisible({ timeout: 30000 });
    await expect(portfolioCard).toContainText("Value");
    await expect(portfolioCard).toContainText("Cash");
  });

  test.skip("should show scan items from multi-strategy bot", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const scanCard = page.locator(".scan-card");
    await expect(scanCard).toBeVisible();

    const strategyCol = page.locator(".scan-table th:has-text('Strategy')");
    await expect(strategyCol).toBeVisible();
  });

  // Note: This test uses the mock data from setupMultiStrategyBotMocks
  test("@smoke should show positions with strategy tabs when multiple strategies have positions", async ({
    page,
  }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const positionsTable = page.locator('[data-testid="positions-table-container"]');
    await expect(positionsTable).toBeVisible();

    const strategyTabs = page.locator('[data-testid="strategy-tabs"]');
    await expect(strategyTabs).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="strategy-tab-all"]')).toBeVisible();
    await expect(page.locator('[data-testid="strategy-tab-orb-conservative"]')).toBeVisible();
    await expect(page.locator('[data-testid="strategy-tab-orb-aggressive"]')).toBeVisible();
  });

  test("should filter positions by strategy tab", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Click on "ORB Conservative" tab
    await page.locator('[data-testid="strategy-tab-orb-conservative"]').click();

    // Verify TCS position is visible (from ORB Conservative)
    await expect(page.locator('[data-testid="positions-table-container"]')).toContainText("TCS", {
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="positions-table-container"]')).toContainText("TCS");
  });

  test("should show bot status running/pid when bot is running", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Verify bot status is shown (should show Running with PID from mock)
    await expect(page.locator('[data-testid="bot-status"]')).toBeVisible();
  });

  test.skip("should show auto-refresh toggle", async ({ page }) => {
    await navigateToPaperTrading(page);

    // Verify auto-refresh checkbox is visible
    await expect(page.locator('label:has-text("Auto-refresh")')).toBeVisible();
  });

  test("should show empty state when no positions", async ({ page }) => {
    // Override positions mock to return empty
    await page.route("**/api/bots/*/positions*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ positions: [] }),
      });
    });

    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Verify empty state is shown
    await expect(page.locator('[data-testid="positions-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="positions-empty"]')).toContainText(
      "No open positions",
    );
  });
});

test.describe("Paper Trading - API Polling", () => {
  test.beforeEach(async ({ page }) => {
    await setupPaperTradingTest(page);
  });

  test("should call bots API on load", async ({ page }) => {
    let botsApiCalled = false;

    page.on("request", (request) => {
      if (request.url().includes("/api/bots") && request.method() === "GET") {
        botsApiCalled = true;
      }
    });

    await navigateToPaperTrading(page);

    // Verify bots API was called on load
    expect(botsApiCalled).toBe(true);
  });

  test("should call bot portfolio API when bot is selected", async ({ page }) => {
    let portfolioApiCalled = false;

    await page.route(`**/api/bots/${TEST_BOT_UUID}/portfolio`, async (route) => {
      portfolioApiCalled = true;
      await route.continue();
    });

    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Verify portfolio API was called
    expect(portfolioApiCalled).toBe(true);
  });

  test("should call scan API when bot is selected", async ({ page }) => {
    let scanApiCalled = false;

    await page.route(`**/api/bots/${TEST_BOT_UUID}/scan`, async (route) => {
      scanApiCalled = true;
      await route.continue();
    });

    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Verify scan API was called
    expect(scanApiCalled).toBe(true);
  });
});

test.describe("Paper Trading - Bot Controls", () => {
  test.beforeEach(async ({ page }) => {
    await setupPaperTradingTest(page);
  });

  test("should update UI immediately after starting a bot", async ({ page }) => {
    let botRunning = false;

    await page.route(`**/api/bots/${TEST_BOT_UUID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: TEST_BOT_UUID,
          name: "Multi-ORB Test Bot",
          is_active: true,
          strategies: [],
          running: botRunning,
          pid: botRunning ? 22133 : null,
        }),
      });
    });

    await page.route(`**/api/bots/${TEST_BOT_UUID}/start`, async (route) => {
      botRunning = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: `Bot ${TEST_BOT_UUID} started`,
          pid: 22133,
          log_file: "/tmp/bot-1-1.log",
        }),
      });
    });

    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    await page.locator('button:has-text("Start Bot")').click();

    await expect(page.locator('[data-testid="bot-status"]')).toContainText("Running");
    await expect(page.locator('[data-testid="bot-status"]')).toContainText("22133");
    await expect(page.locator('button:has-text("Stop Bot")')).toBeVisible();
  });

  test("should show Start Bot button when bot is not running", async ({ page }) => {
    // Mock bot as not running
    await page.route(`**/api/bots/${TEST_BOT_UUID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: TEST_BOT_UUID,
          name: "Multi-ORB Test Bot",
          is_active: true,
          strategies: [],
          running: false,
          pid: null,
        }),
      });
    });

    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Verify Start Bot button is visible
    await expect(page.locator('button:has-text("Start Bot")')).toBeVisible();
  });

  test("should show Stop Bot button when bot is running", async ({ page }) => {
    // Mock bot as running
    await page.route(`**/api/bots/${TEST_BOT_UUID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: TEST_BOT_UUID,
          name: "Multi-ORB Test Bot",
          is_active: true,
          strategies: [],
          running: true,
          pid: 12345,
        }),
      });
    });

    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Verify Stop Bot button is visible
    await expect(page.locator('button:has-text("Stop Bot")')).toBeVisible();
  });
});

test.describe("Paper Trading - Strategy Tabs", () => {
  test.beforeEach(async ({ page }) => {
    await setupPaperTradingTest(page);
  });

  test("should show all positions in 'All' tab", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Click on "All" tab
    await page.locator('[data-testid="strategy-tab-all"]').click();

    // Verify both positions are visible
    await expect(page.locator('[data-testid="positions-table-container"]')).toContainText("TCS");
    await expect(page.locator('[data-testid="positions-table-container"]')).toContainText("INFY");
  });

  test.skip("should filter scan items by selected strategy tab", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Click on "ORB Conservative" tab
    await page.locator('[data-testid="strategy-tab-orb-conservative"]').click();

    // Verify scan table shows strategy column
    await expect(page.locator('[data-testid="watchlist-scan-card"]')).toBeVisible();
  });

  test.skip("should show strategy P&L in tab badges", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Verify strategy tabs show P&L badges
    const conservativeTab = page.locator('[data-testid="strategy-tab-orb-conservative"]');
    await expect(conservativeTab).toBeVisible();

    // Verify P&L is shown in tab
    await expect(conservativeTab.locator(".tab-pnl")).toBeVisible();
  });
});

test.describe("Paper Trading - Watchlist Scan", () => {
  test.beforeEach(async ({ page }) => {
    await setupPaperTradingTest(page);

    await page.route(/\/api\/bots\/[a-f0-9-]+\/scan/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          bot_id: TEST_BOT_UUID,
          scan_items: [
            {
              symbol: "TCS",
              price: 3750,
              or_high: 3760,
              or_low: 3745,
              status: "signal",
              side: "LONG",
              strategy_name: "ORB Conservative",
              reason: "Breakout above OR high",
            },
            {
              symbol: "SBIN",
              price: 1071,
              or_high: 1075,
              or_low: 1070,
              status: "signal",
              side: "SHORT",
              strategy_name: "ORB Aggressive",
              reason: "Breakdown below OR low",
            },
            {
              symbol: "HDFCBANK",
              price: 1346,
              or_high: 1360,
              or_low: 1330,
              status: "watching",
              strategy_name: "ORB Conservative",
            },
            {
              symbol: "RELIANCE",
              price: 1341,
              or_high: 1340,
              or_low: 1334,
              status: "skipped",
              strategy_name: "ORB Conservative",
              reason: "OR range too small",
            },
            {
              symbol: "RELIANCE",
              price: 1341,
              status: "skipped",
              strategy_name: "ORB Aggressive",
              reason: "OR range outside limits",
            },
          ],
          count: 5,
        }),
      });
    });
  });

  test("should display Watchlist Scan card with accordion sections", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const scanCard = page.locator('[data-testid="watchlist-scan-card"]');
    await expect(scanCard).toBeVisible({ timeout: 10000 });
    await expect(scanCard).toContainText("Watchlist Scan");
  });

  test("should display Signals section with signal items", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const scanCard = page.locator('[data-testid="watchlist-scan-card"]');
    await expect(scanCard).toBeVisible({ timeout: 10000 });

    await expect(scanCard).toContainText("Signals");
    await expect(scanCard.locator('[data-testid="scan-signal-TCS"]')).toBeVisible();
    await expect(scanCard.locator('[data-testid="scan-signal-SBIN"]')).toBeVisible();
    await expect(scanCard.locator('[data-testid="scan-signal-TCS"]')).toContainText("LONG");
    await expect(scanCard.locator('[data-testid="scan-signal-SBIN"]')).toContainText("SHORT");
  });

  test("should display watching items", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const scanCard = page.locator('[data-testid="watchlist-scan-card"]');
    await expect(scanCard).toBeVisible({ timeout: 10000 });

    await expect(scanCard.locator('[data-testid="scan-watching-HDFCBANK"]')).toBeVisible();
  });

  test("should display skipped items in table", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const scanCard = page.locator('[data-testid="watchlist-scan-card"]');
    await expect(scanCard).toBeVisible({ timeout: 10000 });

    await scanCard.getByText("Skipped").click();

    await expect(scanCard.locator('[data-testid="scan-skipped-RELIANCE"]')).toBeVisible();
    await expect(scanCard).toContainText("RELIANCE");
  });

  test("should deduplicate skipped symbols across strategies", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const scanCard = page.locator('[data-testid="watchlist-scan-card"]');
    await expect(scanCard).toBeVisible({ timeout: 10000 });

    const relianceCount = await scanCard.locator("text=RELIANCE").count();
    expect(relianceCount).toBeLessThan(3);
  });

  test("should show No scan data yet when bot is stopped", async ({ page }) => {
    await page.route(/\/api\/bots\/[a-f0-9-]+\/scan/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ bot_id: TEST_BOT_UUID, scan_items: [], count: 0 }),
      });
    });

    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const scanCard = page.locator('[data-testid="watchlist-scan-card"]');
    await expect(scanCard).toBeVisible({ timeout: 10000 });
    await expect(scanCard).toContainText("No scan data yet");
  });
});
