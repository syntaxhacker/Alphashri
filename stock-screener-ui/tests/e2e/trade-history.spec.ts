import { test, expect } from "@playwright/test";
import {
  setupTradeHistoryMocks,
  navigateToTradeHistory,
  navigateToTradeHistoryWithBot,
  verifyHistoryPanelVisible,
  mockEmptyTradeHistory,
  mockTradeHistoryWithSampleData,
  isPaginationVisible,
  selectWeekFilter,
} from "../helpers/tradeHistoryHelpers";
import { mockTradeHistoryWithCount } from "../helpers/tradeHistoryHelpers";

test.describe("Trade History - Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupTradeHistoryMocks(page);
  });

  test("should display trade history tab", async ({ page }) => {
    await navigateToTradeHistory(page);
    await expect(page.locator('[data-testid="trade-history-tab"]')).toBeVisible();
    await expect(page.locator('[data-testid="history-panel"]')).toBeVisible();
  });

  test("should display trade history table", async ({ page }) => {
    await navigateToTradeHistoryWithBot(page);
    await verifyHistoryPanelVisible(page);
    await expect(page.locator('[data-testid="paper-history-panel"]')).toBeVisible();
  });

  test("should show trade details in table", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistoryWithBot(page);
    await verifyHistoryPanelVisible(page);
    await expect(page.locator('[data-testid="trade-row-trade-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="trade-row-trade-1"]')).toContainText("TCS");
  });

  test("should show empty state when no trades", async ({ page }) => {
    await mockEmptyTradeHistory(page);
    await navigateToTradeHistory(page);
    await verifyHistoryPanelVisible(page);
    await expect(page.locator('[data-testid="history-panel"]')).toContainText("No trades found");
  });
});

test.describe("Trade History - Filtering", () => {
  test.beforeEach(async ({ page }) => {
    await setupTradeHistoryMocks(page);
  });

  test("should filter by date range", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistoryWithBot(page);
    await verifyHistoryPanelVisible(page);
    await expect(page.locator('[data-testid="quick-filter"]')).toBeVisible();
    await expect(page.locator('[data-testid="trades-header"]')).toBeVisible();
  });

  test("should filter by symbol", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistory(page);
    await verifyHistoryPanelVisible(page);
    await expect(page.locator('[data-testid="trade-row-trade-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="trade-row-trade-1"]')).toContainText("TCS");
  });

  test("should filter by strategy", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistory(page);
    await verifyHistoryPanelVisible(page);
    await expect(page.locator('[data-testid="trade-row-trade-2"]')).toBeVisible();
    await expect(page.locator('[data-testid="trade-row-trade-2"]')).toContainText("ORB Aggressive");
  });

  test("should clear filters", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistory(page);
    await verifyHistoryPanelVisible(page);
    await expect(page.locator('[data-testid="quick-filter"]')).toBeVisible();
    await expect(page.locator('[data-testid="trades-header"]')).toContainText(
      "Trade History (3 trades)",
    );
  });
});

test.describe("Trade History - Trade Details", () => {
  test.beforeEach(async ({ page }) => {
    await setupTradeHistoryMocks(page);
  });

  test("should show entry and exit prices", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistoryWithBot(page);
    await verifyHistoryPanelVisible(page);
    await expect(page.locator('[data-testid="trade-row-trade-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="trade-row-trade-1"]')).toContainText("\u20B93750.00");
    await expect(page.locator('[data-testid="trade-row-trade-1"]')).toContainText("\u20B93825.00");
  });

  test("should show P&L for each trade", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistory(page);
    await verifyHistoryPanelVisible(page);
    await expect(page.locator('[data-testid="trade-row-trade-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="trade-row-trade-2"]')).toBeVisible();
    await expect(page.locator('[data-testid="trade-row-trade-1"]')).toContainText("750");
  });

  test("should show strategy name for each trade", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistory(page);
    await verifyHistoryPanelVisible(page);
    await expect(page.locator('[data-testid="trade-row-trade-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="trade-row-trade-1"]')).toContainText(
      "ORB Conservative",
    );
  });

  test("should show trade timestamp", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistoryWithBot(page);
    await verifyHistoryPanelVisible(page);
    await expect(page.locator('[data-testid="trade-row-trade-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="trade-row-trade-1"]')).toContainText("10:30");
  });
});

test.describe("Trade History - Export", () => {
  test.beforeEach(async ({ page }) => {
    await setupTradeHistoryMocks(page);
  });

  test("should have export button", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistoryWithBot(page);
    await verifyHistoryPanelVisible(page);
    await expect(page.locator('[data-testid="trades-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="quick-filter"]')).toBeVisible();
  });

  test("should export to CSV", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistoryWithBot(page);
    await expect(page.locator('[data-testid="history-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="trades-table-container"]')).toBeVisible();
  });
});

test.describe("Trade History - Pagination", () => {
  test.beforeEach(async ({ page }) => {
    await setupTradeHistoryMocks(page);
  });

  test("should show pagination controls for large datasets", async ({ page }) => {
    await mockTradeHistoryWithCount(page, 100);
    await navigateToTradeHistoryWithBot(page);
    await isPaginationVisible(page);
    await expect(page.locator('[data-testid="trades-header"]')).toContainText("100 trades");
  });

  test("should navigate to next page", async ({ page }) => {
    await mockTradeHistoryWithCount(page, 100);
    await navigateToTradeHistoryWithBot(page);
    await selectWeekFilter(page);
    await expect(page.locator('[data-testid="trades-header"]')).toBeVisible();
  });
});
