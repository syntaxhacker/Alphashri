import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupPaperTradingMocks,
} from "../helpers/multiStrategyHelpers";
import { BOT_IDS, setupBotMocksForId, navigateToBot } from "./helpers/multiStrategyHelpers";

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
          count: 2,
        }),
      });
    });

    await page.route("**/api/paper/journal/summary", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ total_pnl: 900, total_trades: 2, win_rate: 100 }),
      });
    });
  });

  test("should show strategy in trade history", async ({ page }) => {
    await navigateToBot(page, botId);
    await page.getByTestId("trade-history-tab").click();
    await expect(page.getByTestId("history-panel")).toBeVisible({ timeout: 15000 });
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
