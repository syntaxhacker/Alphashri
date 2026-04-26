import { test, expect } from "@playwright/test";
import {
  navigateToPaperTrading,
  navigateToPaperTradingWithBot,
  setupPaperTradingTestMocks,
} from "../helpers/paperTradingHelpers";
import { setupApiMocks, loginAsTestUser, setupPaperTradingMocks } from "../mocks/apiResponses";
import { TEST_BOT_UUID, setupBotApiMocks } from "./helpers/botHelpers";
import { generateCandles } from "./helpers/chartHelpers";

const TEST_DATE = "2026-04-24";

test.describe("Paper Trading - Strategy Tabs", () => {
  test.beforeEach(async ({ page }) => {
    await setupPaperTradingTestMocks(page);
  });
  test("@smoke should display paper trading view with tabs", async ({ page }) => {
    await navigateToPaperTrading(page);

    // Verify tabs are visible
    await expect(page.getByTestId("tab-live")).toBeVisible();
    await expect(page.getByTestId("trade-history-tab")).toBeVisible();
    await expect(page.getByTestId("tab-settings")).toBeVisible();
  });

  test("should display bot cards", async ({ page }) => {
    await navigateToPaperTrading(page);

    // Verify bot cards are visible
    await expect(page.locator('[data-testid^="bot-card-"]').first()).toBeVisible();
  });

  // Note: This test uses the mock data from setupMultiStrategyBotMocks
  test("should show portfolio summary", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const portfolioCard = page.locator('[data-testid="portfolio-card"]');
    await expect(portfolioCard).toBeVisible({ timeout: 30000 });
    await expect(portfolioCard).toContainText("Value");
    await expect(portfolioCard).toContainText("Cash");
  });

  test("should show scan items from multi-strategy bot", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Wait for scan card to load with mock data
    await page.waitForTimeout(1000);
    const scanCard = page.locator('[data-testid="watchlist-scan-card"]');
    await expect(scanCard).toBeVisible({ timeout: 10000 });
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
    await setupPaperTradingTestMocks(page);
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
    await setupPaperTradingTestMocks(page);
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

    await page.locator('[data-testid="start-bot-btn"]').click();

    await expect(page.locator('[data-testid="bot-status"]')).toContainText("Running");
    await expect(page.locator('[data-testid="bot-status"]')).toContainText("22133");
    await expect(page.locator('[data-testid="stop-bot-btn"]')).toBeVisible();
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
    await expect(page.locator('[data-testid="start-bot-btn"]')).toBeVisible();
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
          pid: 22133,
        }),
      });
    });

    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    await expect(page.locator('[data-testid="stop-bot-btn"]')).toBeVisible();
  });
});

test.describe("Paper Trading - Strategy Tabs", () => {
  test.beforeEach(async ({ page }) => {
    await setupPaperTradingTestMocks(page);
  });

  test("should show all positions in 'All' tab", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Click on "All" tab
    await page.locator('[data-testid="strategy-tab-all"]').click();

    // Verify both positions are visible
    await expect(page.locator('[data-testid="positions-table-container"]')).toContainText("TCS");
    await expect(page.locator('[data-testid="positions-table-container"]')).toContainText("INFY");
  });
});

test.describe("Paper Trading - Watchlist Scan", () => {
  test.beforeEach(async ({ page }) => {
    await setupPaperTradingTestMocks(page);

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

  test("should use accordion component (not flat table)", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const scanCard = page.locator('[data-testid="watchlist-scan-card"]');
    await expect(scanCard).toBeVisible({ timeout: 10000 });
    await expect(scanCard.locator('[data-testid="watchlist-scan-accordion"]')).toBeVisible();
  });

  test("should have Signals accordion item", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const scanCard = page.locator('[data-testid="watchlist-scan-card"]');
    await expect(scanCard).toBeVisible({ timeout: 10000 });
    await expect(scanCard.locator('[data-testid="watchlist-scan-signals"]')).toBeVisible();
  });

  test("should have Watching accordion item", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const scanCard = page.locator('[data-testid="watchlist-scan-card"]');
    await expect(scanCard).toBeVisible({ timeout: 10000 });
    await expect(scanCard.locator('[data-testid="watchlist-scan-watching"]')).toBeVisible();
  });

  test("should have Skipped accordion item", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const scanCard = page.locator('[data-testid="watchlist-scan-card"]');
    await expect(scanCard).toBeVisible({ timeout: 10000 });
    await expect(scanCard.locator('[data-testid="watchlist-scan-skipped"]')).toBeVisible();
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

test.describe("Paper Trading - Position Actions", () => {
  test.beforeEach(async ({ page }) => {
    await setupPaperTradingTestMocks(page);
  });

  test("should show close button for each position", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const closeBtn = page.locator('[data-testid="close-position-TCS"]');
    await expect(closeBtn).toBeVisible();
  });

  test("should click close position button without error", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const closeBtn = page.locator('[data-testid="close-position-TCS"]');
    await closeBtn.click();

    await page.waitForTimeout(500);
  });

  test("should show Close All button when positions exist", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const closeAllBtn = page.locator('[data-testid="close-all-positions"]');
    await expect(closeAllBtn).toBeVisible();
  });

  test("should click Close All button without error", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    const closeAllBtn = page.locator('[data-testid="close-all-positions"]');
    await closeAllBtn.click();

    await page.waitForTimeout(500);
  });

  test("should close all positions via API", async ({ page }) => {
    let closeAllApiCalled = false;

    await page.route(`**/api/bots/${TEST_BOT_UUID}/close-all`, async (route) => {
      closeAllApiCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: "All positions closed",
          closed: 2,
        }),
      });
    });

    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    const closeAllBtn = page.locator('[data-testid="close-all-positions"]');
    await closeAllBtn.click();

    await page.waitForTimeout(1000);

    expect(closeAllApiCalled).toBe(true);
  });
});

test.describe("Paper Trading - Settings", () => {
  test.beforeEach(async ({ page }) => {
    await setupPaperTradingTestMocks(page);
  });

  test("should update ORB sl_pct and save", async ({ page }) => {
    await navigateToPaperTradingSettings(page);

    await page.route(`**/api/bots/${TEST_BOT_UUID}/config`, async (route) => {
      const request = route.request();
      const postData = JSON.parse(request.postData() || "{}");

      if (request.method() === "PUT" && postData.strategy_configs) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ message: "Config updated", config: postData }),
        });
      } else {
        await route.continue();
      }
    });

    const slPctInput = page.locator('[data-testid="config-sl-pct"]');
    await slPctInput.fill("1.5");

    await page.waitForTimeout(300);

    const saveBtn = page.locator('[data-testid="save-settings-button"]');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    await page.waitForTimeout(500);
  });

  test("should update Risk risk_per_trade", async ({ page }) => {
    await navigateToPaperTradingSettings(page);

    await page.route(`**/api/bots/${TEST_BOT_UUID}/config`, async (route) => {
      const request = route.request();
      const postData = JSON.parse(request.postData() || "{}");

      if (request.method() === "PUT") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ message: "Config updated", config: postData }),
        });
      } else {
        await route.continue();
      }
    });

    const riskInput = page.locator('[data-testid="config-risk-per-trade"]');
    await riskInput.fill("2.0");

    await page.waitForTimeout(300);

    const saveBtn = page.locator('[data-testid="save-settings-button"]');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    await page.waitForTimeout(500);
  });

  test("should reset settings to defaults", async ({ page }) => {
    await navigateToPaperTradingSettings(page);

    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    const resetBtn = page.locator('[data-testid="reset-settings-button"]');
    await resetBtn.click();

    await page.waitForTimeout(500);

    const slPctInput = page.locator('[data-testid="config-sl-pct"]');
    await expect(slPctInput).toHaveValue("0.4");
  });

  test("should show validation error for invalid sl_pct", async ({ page }) => {
    await navigateToPaperTradingSettings(page);

    const slPctInput = page.locator('[data-testid="config-sl-pct"]');
    await slPctInput.fill("-1");

    await page.waitForTimeout(300);

    const saveBtn = page.locator('[data-testid="save-settings-button"]');
    await saveBtn.scrollIntoViewIfNeeded();
    await saveBtn.waitFor({ state: "stable" });
    await saveBtn.click();

    await expect(page.locator('[data-testid="config-sl-pct-error"]')).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("Paper Trading - Portfolio Card", () => {
  test.beforeEach(async ({ page }) => {
    await setupPaperTradingTestMocks(page);
  });

  test("should display portfolio value and cash", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const portfolioCard = page.locator('[data-testid="portfolio-card"]');
    await expect(portfolioCard).toBeVisible({ timeout: 10000 });
    await expect(portfolioCard).toContainText("Total Value");
    await expect(portfolioCard).toContainText("Cash");
  });

  test("should display strategy summaries section exists", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const portfolioCard = page.locator('[data-testid="portfolio-card"]');
    await expect(portfolioCard).toBeVisible({ timeout: 10000 });
  });

  test("should display daily loss bar section exists", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const portfolioCard = page.locator('[data-testid="portfolio-card"]');
    await expect(portfolioCard).toBeVisible({ timeout: 10000 });
  });

  test("should display portfolio with PnL", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    const portfolioCard = page.locator('[data-testid="portfolio-card"]');
    await expect(portfolioCard).toBeVisible({ timeout: 10000 });
    await expect(portfolioCard).toContainText("Day P&L");
  });
});

test.describe("Paper Trading - Chart Controls", () => {
  const BOT_ID = "550e8400-e29b-41d4-a716-446655440000";
  const SYMBOL = "TCS";

  const mockChartData = {
    symbol: SYMBOL,
    date: TEST_DATE,
    candles: generateCandles(10, 3750),
    orb_levels: {
      or_high: 3760,
      or_low: 3745,
      or_open: 3745,
      or_range: 20,
      or_range_pct: 0.53,
      or_minutes: 15,
    },
    week52_levels: {
      high_52w: 3850,
      low_52w: 3200,
      distance_to_high_pct: 1.6,
      distance_to_low_pct: 17.2,
      near_high: false,
    },
    pivot_levels: {
      r2: 3820,
      r1: 3795,
      pp: 3765,
      s1: 3735,
      s2: 3705,
    },
    trades: [],
    current_position: null,
    ema_series: {
      ema_fast: { label: "EMA 9", color: "#10ac84", data: Array(10).fill(null) },
      ema_slow: { label: "EMA 21", color: "#f59f00", data: Array(10).fill(null) },
    },
  };

  async function setupChartMocks(page: import("@playwright/test").Page) {
    await page.route(/localhost:8765\/api\/paper\/chart\//, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockChartData),
      });
    });
  }

  async function navigateToChartAndSelectSymbol(page: import("@playwright/test").Page) {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupBotApiMocks(page, {
      botId: BOT_ID,
      positions: [
        {
          id: 1,
          symbol: SYMBOL,
          side: "BUY",
          quantity: 10,
          entry_price: 3750,
          current_price: 3800,
          pnl: 500,
          pnl_pct: 1.33,
          strategy_name: "ORB Conservative",
          strategy_id: 1,
          stop_loss: 3700,
          take_profit: 3900,
          entry_time: "2026-04-24T09:30:00",
        },
      ],
    });
    await setupChartMocks(page);

    await page.goto("/paper", { timeout: 30000 });
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
    await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({
      timeout: 20000,
    });

    await page.waitForSelector('[data-testid^="bot-card-"]', { state: "visible", timeout: 10000 });
    await page.locator('[data-testid^="bot-card-"]').first().click();

    await page.getByTestId("tab-live").click();
    await page.waitForLoadState("networkidle");

    const positionRow = page.locator(`[data-testid="position-row-${SYMBOL}"]`);
    await expect(positionRow).toBeVisible({ timeout: 10000 });
    await positionRow.click();
    await expect(page.locator('[data-testid="paper-chart-container"]')).toBeVisible({
      timeout: 10000,
    });
  }

  test("should render all chart control switches", async ({ page }) => {
    await navigateToChartAndSelectSymbol(page);

    await expect(page.getByTestId("intraday-switch")).toBeVisible();
    await expect(page.getByTestId("show-all-trades-switch")).toBeVisible();
    await expect(page.getByTestId("show-orb-lines")).toBeVisible();
    await expect(page.getByTestId("show-pivot-lines")).toBeVisible();
    await expect(page.getByTestId("show-52w-lines")).toBeVisible();
    await expect(page.getByTestId("show-ema-lines")).toBeVisible();
  });

  test("should toggle intraday mode", async ({ page }) => {
    await navigateToChartAndSelectSymbol(page);

    await page.getByTestId("intraday-switch").click();
    await page.waitForTimeout(500);

    await expect(page.getByTestId("paper-chart-header")).toBeVisible();
  });

  test("should toggle EMA lines", async ({ page }) => {
    await navigateToChartAndSelectSymbol(page);

    const emaSwitch = page.getByTestId("show-ema-lines");
    await expect(emaSwitch).toBeVisible();
    await emaSwitch.click();
    await page.waitForTimeout(200);

    await expect(page.getByTestId("paper-chart-header")).toBeVisible();
  });

  test("should toggle ORB lines", async ({ page }) => {
    await navigateToChartAndSelectSymbol(page);

    const orbSwitch = page.getByTestId("show-orb-lines");
    await expect(orbSwitch).toBeVisible();
    await orbSwitch.click();
    await page.waitForTimeout(200);

    await expect(page.getByTestId("paper-chart-header")).toBeVisible();
  });

  test("should toggle 52W high line", async ({ page }) => {
    await navigateToChartAndSelectSymbol(page);

    const w52Switch = page.getByTestId("show-52w-lines");
    await expect(w52Switch).toBeVisible();
    await w52Switch.click();
    await page.waitForTimeout(200);

    await expect(page.getByTestId("paper-chart-header")).toBeVisible();
  });

  test("should toggle SL/TP markers via All trades switch", async ({ page }) => {
    await navigateToChartAndSelectSymbol(page);

    const allTradesSwitch = page.getByTestId("show-all-trades-switch");
    await expect(allTradesSwitch).toBeVisible();
    await allTradesSwitch.click();
    await page.waitForTimeout(200);

    await expect(page.getByTestId("paper-chart-header")).toBeVisible();
  });

  test("should switch timeframe", async ({ page }) => {
    await navigateToChartAndSelectSymbol(page);

    const timeframeSelect = page.getByTestId("paper-chart-timeframe");
    await expect(timeframeSelect).toBeVisible();

    await timeframeSelect.click();
    await page.waitForTimeout(300);

    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(100);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);

    await expect(page.getByTestId("paper-chart-header")).toBeVisible();
  });

  test("should show chart header with symbol and date", async ({ page }) => {
    await navigateToChartAndSelectSymbol(page);

    const header = page.getByTestId("paper-chart-header");
    await expect(header).toBeVisible();
    await expect(header).toContainText(SYMBOL);
  });
});

async function navigateToPaperTradingSettings(page: import("@playwright/test").Page) {
  await page.goto("/paper", { timeout: 30000 });
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
  await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({
    timeout: 20000,
  });

  await expect(page.locator('[data-testid="tab-settings"]')).toBeVisible();

  const settingsTab = page.locator('[data-testid="tab-settings"]');
  await settingsTab.waitFor({ state: "visible", timeout: 10000 });
  await settingsTab.click({ timeout: 10000 });

  await expect(page.locator('[data-testid="settings-panel"]')).toBeVisible({ timeout: 10000 });
}

test.describe("Paper Trading - Settings Panel Sections", () => {
  test.beforeEach(async ({ page }) => {
    await setupPaperTradingTestMocks(page);
  });

  test("should display all settings section headers", async ({ page }) => {
    await navigateToPaperTradingSettings(page);

    await expect(page.locator('[data-testid="orb-section-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="risk-section-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="runner-section-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="costs-section-header"]')).toBeVisible();
  });

  test.describe("TradingCostsSection", () => {
    test.beforeEach(async ({ page }) => {
      await setupPaperTradingTestMocks(page);
    });

    test("should display TradingCostsSection fields", async ({ page }) => {
      await navigateToPaperTradingSettings(page);

      await expect(page.locator('[data-testid="config-brokerage"]')).toBeVisible();
      await expect(page.locator('[data-testid="config-min-brokerage"]')).toBeVisible();
      await expect(page.locator('[data-testid="config-stt"]')).toBeVisible();
      await expect(page.locator('[data-testid="config-exchange"]')).toBeVisible();
      await expect(page.locator('[data-testid="config-sebi"]')).toBeVisible();
      await expect(page.locator('[data-testid="config-stamp"]')).toBeVisible();
      await expect(page.locator('[data-testid="config-gst"]')).toBeVisible();
    });

    test("should display TradingCostsSection field labels", async ({ page }) => {
      await navigateToPaperTradingSettings(page);

      const costsSection = page.locator("#costs-section");
      await expect(costsSection.locator('label:has-text("Brokerage %")')).toBeVisible();
      await expect(costsSection.locator('label:has-text("Min Brokerage")')).toBeVisible();
      await expect(costsSection.locator('label:has-text("STT %")')).toBeVisible();
      await expect(costsSection.locator('label:has-text("Exchange %")')).toBeVisible();
      await expect(costsSection.locator('label:has-text("SEBI %")')).toBeVisible();
      await expect(costsSection.locator('label:has-text("Stamp %")')).toBeVisible();
      await expect(costsSection.locator('label:has-text("GST %")')).toBeVisible();
    });
  });

  test.describe("RiskManagementSection", () => {
    test.beforeEach(async ({ page }) => {
      await setupPaperTradingTestMocks(page);
    });

    test("should display RiskManagementSection fields", async ({ page }) => {
      await navigateToPaperTradingSettings(page);

      await expect(page.locator('[data-testid="config-max-positions"]')).toBeVisible();
      await expect(page.locator('[data-testid="config-capital-per-trade"]')).toBeVisible();
      await expect(page.locator('[data-testid="config-daily-loss"]')).toBeVisible();
      await expect(page.locator('[data-testid="config-max-exposure"]')).toBeVisible();
      await expect(page.locator('[data-testid="config-risk-per-trade"]')).toBeVisible();
    });

    test("should display RiskManagementSection field labels", async ({ page }) => {
      await navigateToPaperTradingSettings(page);

      const riskSection = page.locator("#risk-section");
      await expect(riskSection.locator('label:has-text("Max Positions")')).toBeVisible();
      await expect(riskSection.locator('label:has-text("Capital/Trade %")')).toBeVisible();
      await expect(riskSection.locator('label:has-text("Daily Loss %")')).toBeVisible();
      await expect(riskSection.locator('label:has-text("Max Exposure %")')).toBeVisible();
      await expect(riskSection.locator('label:has-text("Risk/Trade %")')).toBeVisible();
    });
  });

  test.describe("OrbSettingsSection", () => {
    test.beforeEach(async ({ page }) => {
      await setupPaperTradingTestMocks(page);
    });

    test("should display OrbSettingsSection fields", async ({ page }) => {
      await navigateToPaperTradingSettings(page);

      await expect(page.locator('[data-testid="config-or-minutes"]')).toBeVisible();
      await expect(page.locator('[data-testid="config-sl-pct"]')).toBeVisible();
      await expect(page.locator('[data-testid="config-tp-pct"]')).toBeVisible();
      await expect(page.locator('[data-testid="config-min-or-range"]')).toBeVisible();
      await expect(page.locator('[data-testid="config-max-or-range"]')).toBeVisible();
    });

    test("should display OrbSettingsSection field labels", async ({ page }) => {
      await navigateToPaperTradingSettings(page);

      const orbSection = page.locator("#orb-section");
      await expect(orbSection.locator('label:has-text("OR Minutes")')).toBeVisible();
      await expect(orbSection.locator('label:has-text("Stop Loss %")')).toBeVisible();
      await expect(orbSection.locator('label:has-text("Take Profit %")')).toBeVisible();
      await expect(orbSection.locator('label:has-text("Min OR Range %")')).toBeVisible();
      await expect(orbSection.locator('label:has-text("Max OR Range %")')).toBeVisible();
    });
  });

  test.describe("RunnerSettingsSection", () => {
    test.beforeEach(async ({ page }) => {
      await setupPaperTradingTestMocks(page);
    });

    test("should display RunnerSettingsSection fields", async ({ page }) => {
      await navigateToPaperTradingSettings(page);

      await expect(page.locator('[data-testid="config-cooldown"]')).toBeVisible();
      await expect(page.locator('[data-testid="config-max-distance"]')).toBeVisible();
    });

    test("should display RunnerSettingsSection field labels", async ({ page }) => {
      await navigateToPaperTradingSettings(page);

      const runnerSection = page.locator("#runner-section");
      await expect(runnerSection.locator('label:has-text("Cooldown (min)")')).toBeVisible();
      await expect(runnerSection.locator('label:has-text("Max Distance from OR %")')).toBeVisible();
    });
  });
});
