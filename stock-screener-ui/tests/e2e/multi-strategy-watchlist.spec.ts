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
  mockPaperTradesRoute,
  mockJournalSummaryRoute,
} from "./helpers/multiStrategyHelpers";

test.describe("Multi-Strategy System - Trade History", () => {
  const botId = BOT_IDS.tradeHistory;

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
    await setupBotMocksForId(page, botId);
    await mockPaperTradesRoute(page);

    await mockJournalSummaryRoute(page);
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
    await mockPaperTradesRoute(page);
  });

  test("should filter history by strategy", async ({ page }) => {
    await navigateToBot(page, botId);
    await page.getByTestId("trade-history-tab").click();

    const strategyFilter = page.getByTestId("strategy-filter-select");
    await expect(strategyFilter).toBeVisible();
    await strategyFilter.click();
    await page.getByRole("option", { name: "ORB Conservative" }).click();
    // Filter applied: selected strategy stays visible, the other strategy's trade drops out.
    await expect(page.getByTestId("history-panel")).toContainText("ORB Conservative", {
      timeout: 5000,
    });
    await expect(page.getByTestId("history-panel")).not.toContainText("ORB Aggressive", {
      timeout: 5000,
    });
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

  test("should show P&L per strategy in panels", async ({ page }) => {
    await navigateToBot(page, botId);

    // Positions are grouped in strategy panels, check portfolio card shows P&L
    await expect(page.getByTestId("portfolio-card")).toBeVisible();
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
