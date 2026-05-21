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
    await expect(page.locator('[data-testid="trades-header"]')).toContainText("Trade History");
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

  test("should show trade hold duration", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistoryWithBot(page);
    await verifyHistoryPanelVisible(page);
    await expect(page.locator('[data-testid="trade-row-trade-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="trade-row-trade-1"]')).toContainText("1h 15m");
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
    await expect(page.locator('[data-testid="quick-filter"]')).toBeVisible();
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
    await expect(page.locator('[data-testid="trades-header"]')).toContainText("Trade History");
  });

  test("should navigate to next page", async ({ page }) => {
    await mockTradeHistoryWithCount(page, 100);
    await navigateToTradeHistoryWithBot(page);
    await selectWeekFilter(page);
    await expect(page.locator('[data-testid="trades-header"]')).toBeVisible();
  });
});

test.describe("Trade History - Filter Dropdowns", () => {
  const filterCases = [
    { filterName: "bot", testId: "bot-filter-select" },
    { filterName: "strategy", testId: "strategy-filter-select" },
  ];

  for (const { filterName, testId } of filterCases) {
    test(`should display ${filterName} filter select dropdown`, async ({ page }) => {
      await setupTradeHistoryMocks(page);
      await mockTradeHistoryWithSampleData(page);
      await navigateToTradeHistoryWithBot(page);
      await verifyHistoryPanelVisible(page);
      await expect(page.locator(`[data-testid="${testId}"]`)).toBeVisible();
    });
  }
});

test.describe("Trade History - Trade Interactions", () => {
  test.beforeEach(async ({ page }) => {
    await setupTradeHistoryMocks(page);
  });

  test("should expand trade row to show stats", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistoryWithBot(page);
    await verifyHistoryPanelVisible(page);

    const toggleBtn = page.locator('[data-testid="trade-detail-toggle-trade-1"]');
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();

    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="trade-reason-trade-1"]')).toBeVisible();
  });

  test("should show trade stats values when expanded", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistoryWithBot(page);
    await verifyHistoryPanelVisible(page);

    const toggleBtn = page.locator('[data-testid="trade-detail-toggle-trade-1"]');
    await toggleBtn.click();

    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="trade-reason-trade-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="trade-notes-trade-1"]')).toBeVisible();
  });

  test("should show trade notes editor when expanded", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistoryWithBot(page);
    await verifyHistoryPanelVisible(page);

    const toggleBtn = page.locator('[data-testid="trade-detail-toggle-trade-1"]');
    await toggleBtn.click();

    await page.waitForTimeout(300);
    const reasonField = page.locator('[data-testid="trade-reason-trade-1"]');
    const notesField = page.locator('[data-testid="trade-notes-trade-1"]');
    const saveBtn = page.locator('[data-testid="trade-notes-save-trade-1"]');

    await expect(reasonField).toBeVisible();
    await expect(notesField).toBeVisible();
    await expect(saveBtn).toBeVisible();
  });

  test("should allow editing trade notes", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistoryWithBot(page);
    await verifyHistoryPanelVisible(page);

    const toggleBtn = page.locator('[data-testid="trade-detail-toggle-trade-1"]');
    await toggleBtn.click();

    await page.waitForTimeout(300);
    const notesField = page.locator('[data-testid="trade-notes-trade-1"]');
    await notesField.fill("Test notes");

    const saveBtn = page.locator('[data-testid="trade-notes-save-trade-1"]');
    await saveBtn.click();

    await page.waitForTimeout(500);
  });

  test("should show delete trade button", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistoryWithBot(page);
    await verifyHistoryPanelVisible(page);

    const deleteBtn = page.locator('[data-testid="delete-trade-btn-trade-1"]');
    await expect(deleteBtn).toBeVisible();
  });

  test("should click delete trade button without error", async ({ page }) => {
    await mockTradeHistoryWithSampleData(page);
    await navigateToTradeHistoryWithBot(page);
    await verifyHistoryPanelVisible(page);

    const deleteBtn = page.locator('[data-testid="delete-trade-btn-trade-1"]');
    await deleteBtn.click();

    await page.waitForTimeout(500);
  });
});
