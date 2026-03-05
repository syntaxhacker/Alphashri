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
  test("should display paper trading view with tabs", async ({ page }) => {
    await navigateToPaperTrading(page);

    // Verify tabs are visible
    await expect(page.locator('button:has-text("Live Positions")')).toBeVisible();
    await expect(page.locator('button:has-text("Trade History")')).toBeVisible();
    await expect(page.locator('button:has-text("Settings")')).toBeVisible();
  });

  test("should display bot selector dropdown", async ({ page }) => {
    await navigateToPaperTrading(page);

    // Verify bot selector is visible
    await expect(page.locator(".bot-selector-dropdown")).toBeVisible();
  });

  // Skip: Requires real backend API for bot list
  test.skip("should list available bots in dropdown", async ({ page }) => {
    await navigateToPaperTrading(page);

    // Verify bots are listed in dropdown options
    const dropdown = page.locator(".bot-selector-dropdown");
    await expect(dropdown).toBeVisible();

    // Check that the option exists (it contains the bot name)
    const optionText = await dropdown.locator(`option[value='${TEST_BOT_UUID}']`).textContent();
    expect(optionText).toContain("Multi-ORB Test Bot");
  });

  // Skip: Requires real backend API for bot selection
  test.skip("should show portfolio summary", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Verify portfolio card is visible
    await expect(page.locator(".portfolio-card")).toBeVisible();

    // Verify portfolio values
    await expect(page.locator(".portfolio-card")).toContainText("Capital");
    await expect(page.locator(".portfolio-card")).toContainText("Cash");
  });

  // Skip: Requires real backend API for bot selection
  test.skip("should show scan items from multi-strategy bot", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Verify scan card is visible
    await expect(page.locator(".scan-card")).toBeVisible();

    // Verify scan table headers include Strategy column
    await expect(page.locator(".scan-table th:has-text('Strategy')")).toBeVisible();
  });

  // Skip: Requires real backend API for bot selection
  test.skip("should show positions with strategy tabs when multiple strategies have positions", async ({
    page,
  }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Verify positions table is visible
    await expect(page.locator(".positions-table")).toBeVisible();

    // Verify strategy tabs are visible (since we have positions from multiple strategies)
    await expect(page.locator(".strategy-tabs")).toBeVisible();
    await expect(page.locator(".strategy-tab:has-text('All')")).toBeVisible();
    await expect(page.locator(".strategy-tab:has-text('ORB Conservative')")).toBeVisible();
    await expect(page.locator(".strategy-tab:has-text('ORB Aggressive')")).toBeVisible();
  });

  test("should filter positions by strategy tab", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Click on "ORB Conservative" tab
    await page.locator(".strategy-tab:has-text('ORB Conservative')").click();

    // Wait for UI to update
    await page.waitForTimeout(200);

    // Verify TCS position is visible (from ORB Conservative)
    await expect(page.locator(".positions-table")).toContainText("TCS");
  });

  test("should show bot status running/pid when bot is running", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Verify bot status is shown (should show Running with PID from mock)
    await expect(page.locator(".bot-status")).toBeVisible();
  });

  test("should show auto-refresh toggle", async ({ page }) => {
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
    await expect(page.locator(".positions-empty")).toBeVisible();
    await expect(page.locator(".positions-empty")).toContainText("No open positions");
  });
});

test.describe("Paper Trading - API Polling", () => {
  test.beforeEach(async ({ page }) => {
    await setupPaperTradingTest(page);
  });

  test("should call bots API when selecting a bot", async ({ page }) => {
    let botsApiCalled = false;

    await page.route("**/api/bots", async (route) => {
      botsApiCalled = true;
      await route.continue();
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
    await page.locator(".strategy-tab:has-text('All')").click();

    // Wait for UI to update
    await page.waitForTimeout(200);

    // Verify both positions are visible
    await expect(page.locator(".positions-table")).toContainText("TCS");
    await expect(page.locator(".positions-table")).toContainText("INFY");
  });

  test("should filter scan items by selected strategy tab", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Click on "ORB Conservative" tab
    await page.locator(".strategy-tab:has-text('ORB Conservative')").click();

    // Wait for UI to update
    await page.waitForTimeout(200);

    // Verify scan table shows strategy column
    await expect(page.locator(".scan-table")).toBeVisible();
  });

  test("should show strategy P&L in tab badges", async ({ page }) => {
    await navigateToPaperTradingWithBot(page, TEST_BOT_UUID);

    // Verify strategy tabs show P&L badges
    const conservativeTab = page.locator(".strategy-tab:has-text('ORB Conservative')");
    await expect(conservativeTab).toBeVisible();

    // Verify P&L is shown in tab
    await expect(conservativeTab.locator(".tab-pnl")).toBeVisible();
  });
});
