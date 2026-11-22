import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  loginAsTestUser,
  setupPaperTradingMocks,
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
    // The quick filter defaults to Today, and the mocked trades are dated
    // 2026-03-02 — nothing matches today's date, so widen the window first.
    // It is a SegmentedControl (buttons), not a <select>.
    await page.getByTestId("quick-filter").getByRole("button", { name: "All" }).click();
    await expect(page.getByTestId("history-panel")).toContainText("TCS", { timeout: 5000 });

    const strategyFilter = page.getByTestId("strategy-filter-select");
    await expect(strategyFilter).toBeVisible();
    // Non-searchable Select -> native <select>: select by label rather than
    // opening a role=option popup that does not exist.
    await strategyFilter.locator("select").selectOption({ label: "ORB Conservative" });
    // Filter applied: only strategy 1's trade survives; the other strategy's
    // trade (strategy_id 2 -> "SR Breakout" in this bot's config) drops out.
    // Scope to the table body — every strategy name remains a legitimate
    // <option> in the filter control, which is not trade content.
    const tableBody = page.getByTestId("history-panel").locator("tbody");
    await expect(tableBody).toContainText("TCS", { timeout: 5000 });
    await expect(tableBody).not.toContainText("INFY", { timeout: 5000 });
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
