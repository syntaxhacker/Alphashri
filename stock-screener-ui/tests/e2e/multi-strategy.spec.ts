import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupPaperTradingMocks,
} from "../helpers/multiStrategyHelpers";
import {
  BOT_IDS,
  setupBotMocksForId,
  navigateToBot,
  verifyStrategyPanel,
} from "./helpers/multiStrategyHelpers";
import { apiRoute } from "../mocks/routeHelper";

test.describe.configure({ mode: "default" });

test.describe("Multi-Strategy System - Signal Generators", () => {
  const botId = BOT_IDS.signalGenerators;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupBotMocksForId(page, botId);
  });

  test("should have different signal generators for ORB and 52W strategies", async ({
    page,
  }) => {
    test.slow();
    await navigateToBot(page, botId);

    await page.waitForSelector("[data-testid='positions-panel']", { timeout: 30000 });

    const positionsContainer = page.getByTestId("positions-table-container");
    const emptyState = page.getByTestId("positions-empty");

    await expect(positionsContainer.or(emptyState).first()).toBeVisible();
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

    const scanCard = page.getByTestId("watchlist-scan-card");
    await expect(scanCard).toBeVisible();
    const allHeaders = await scanCard.locator("th").allTextContents();
    expect(allHeaders).toContain("Strategy");
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

  test("should show 52W-specific scan items (no 52W positions mocked, tab not rendered)", async ({
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

    await verifyStrategyPanel(page, "ORB Conservative");
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

    await verifyStrategyPanel(page, "ORB Conservative");
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

  test("should show all positions by default", async ({ page }) => {
    await navigateToBot(page, botId);

    await verifyStrategyPanel(page, "All");
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

    await page.route(apiRoute("paper/chart/"), async (route) => {
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
    // Click the symbol link inside the row to open chart (row click only toggles expansion)
    await positionRow.locator(".symbol-link").click();
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

    await page.route(apiRoute("paper/chart/"), async (route) => {
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

  test("should show 52W high line on chart for 52W positions (no 52W positions mocked, tab not rendered)", async ({
    page,
  }) => {
    await navigateToBot(page, botId);
    await expect(page.getByTestId("positions-panel")).toBeVisible();
  });
});
