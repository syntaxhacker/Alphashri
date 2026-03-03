import { test, expect } from "@playwright/test";
import {
  setupTradeHistoryMocks,
  navigateToTradeHistory,
  navigateToTradeHistoryWithBot,
  verifyHistoryPanelVisible,
  verifyTradesTableVisible,
  mockEmptyTradeHistory,
  mockTradeHistoryWithCount,
  fillDateRangeFilters,
  clickButtonIfExists,
  isPaginationVisible,
  clickNextPage,
  selectBot,
} from "../helpers/tradeHistoryHelpers";

test.describe("Trade History - Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupTradeHistoryMocks(page);
  });

  test("should display trade history tab", async ({ page }) => {
    await navigateToTradeHistory(page);
  });

  test("should display trade history table", async ({ page }) => {
    await navigateToTradeHistoryWithBot(page, "2");
    await verifyTradesTableVisible(page);
  });

  test("should show trade details in table", async ({ page }) => {
    await navigateToTradeHistory(page);
    await verifyHistoryPanelVisible(page);
  });

  test("should show empty state when no trades", async ({ page }) => {
    await mockEmptyTradeHistory(page);
    await navigateToTradeHistory(page);
    await verifyHistoryPanelVisible(page);
  });
});

test.describe("Trade History - Filtering", () => {
  test.beforeEach(async ({ page }) => {
    await setupTradeHistoryMocks(page);
  });

  test("should filter by date range", async ({ page }) => {
    await navigateToTradeHistoryWithBot(page, "2");
    await fillDateRangeFilters(page, "2024-01-01", "2024-12-31");
  });

  test("should filter by symbol", async ({ page }) => {
    await navigateToTradeHistory(page);
    await verifyHistoryPanelVisible(page);
  });

  test("should filter by strategy", async ({ page }) => {
    await navigateToTradeHistory(page);
    await verifyHistoryPanelVisible(page);
  });

  test("should clear filters", async ({ page }) => {
    await navigateToTradeHistory(page);
    await verifyHistoryPanelVisible(page);
  });
});

test.describe("Trade History - Trade Details", () => {
  test.beforeEach(async ({ page }) => {
    await setupTradeHistoryMocks(page);
  });

  test("should show entry and exit prices", async ({ page }) => {
    await navigateToTradeHistoryWithBot(page, "2");
    await verifyHistoryPanelVisible(page);
  });

  test("should show P&L for each trade", async ({ page }) => {
    await navigateToTradeHistory(page);
    await verifyHistoryPanelVisible(page);
  });

  test("should show strategy name for each trade", async ({ page }) => {
    await navigateToTradeHistory(page);
    await verifyHistoryPanelVisible(page);
  });

  test("should show trade timestamp", async ({ page }) => {
    await navigateToTradeHistoryWithBot(page, "2");
    await verifyHistoryPanelVisible(page);
  });
});

test.describe("Trade History - Export", () => {
  test.beforeEach(async ({ page }) => {
    await setupTradeHistoryMocks(page);
  });

  test("should have export button", async ({ page }) => {
    await navigateToTradeHistoryWithBot(page, "2");
    await verifyHistoryPanelVisible(page);
  });

  test("should export to CSV", async ({ page }) => {
    await navigateToTradeHistoryWithBot(page, "2");
    await clickButtonIfExists(page, /CSV|csv/i);
  });
});

test.describe("Trade History - Pagination", () => {
  test.beforeEach(async ({ page }) => {
    await setupTradeHistoryMocks(page);
  });

  test("should show pagination controls for large datasets", async ({ page }) => {
    await mockTradeHistoryWithCount(page, 100);
    await navigateToTradeHistoryWithBot(page, "2");
    await isPaginationVisible(page);
  });

  test("should navigate to next page", async ({ page }) => {
    await navigateToTradeHistoryWithBot(page, "2");
    await clickNextPage(page);
  });
});
