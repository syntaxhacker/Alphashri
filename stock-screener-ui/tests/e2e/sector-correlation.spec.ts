import { test, expect } from "@playwright/test";
import { setupSectorTest, gotoSector } from "./helpers/sectorHelpers";

test.describe("Sector Correlation & Rotation", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
  });

  test("should display Sector Correlation tab", async ({ page }) => {
    await gotoSector(page);
    const tabs = page.locator('[data-testid="sector-analysis-view"]').locator('[role="tablist"]');
    await expect(tabs.locator('[role="tab"]:has-text("Sector Correlation")')).toBeVisible();
  });

  test("should navigate to correlation tab and display heatmap", async ({ page }) => {
    await gotoSector(page);
    await page.locator('[role="tab"]:has-text("Sector Correlation")').click();

    // Check heatmap panel is rendered and visible
    const heatmap = page.locator('[data-testid="sector-correlation-heatmap"]');
    await expect(heatmap).toBeVisible();

    // Heatmap is rendered via ECharts canvas; verify canvas is present
    const canvas = heatmap.locator("canvas");
    await expect(canvas).toBeVisible();
  });

  test("should display beta bar chart", async ({ page }) => {
    await gotoSector(page);
    await page.locator('[role="tab"]:has-text("Sector Correlation")').click();

    const betaChart = page.locator('[data-testid="sector-beta-chart"]');
    await expect(betaChart).toBeVisible();
    await expect(betaChart).toContainText("Beta");
    await expect(betaChart).toContainText("Benchmark");
  });

  test("should display relative strength table with rankings", async ({ page }) => {
    await gotoSector(page);
    await page.locator('[role="tab"]:has-text("Sector Correlation")').click();

    const table = page.locator('[data-testid="relative-strength-table"] table');
    await expect(table).toBeVisible();

    // Check table headers
    await expect(table.locator("th", { hasText: "Rank" })).toBeVisible();
    await expect(table.locator("th", { hasText: "Sector" })).toBeVisible();
    await expect(table.locator("th", { hasText: "5D RS" })).toBeVisible();
    await expect(table.locator("th", { hasText: "1M RS" })).toBeVisible();
    await expect(table.locator("th", { hasText: "3M RS" })).toBeVisible();
    await expect(table.locator("th", { hasText: "Beta" })).toBeVisible();
    await expect(table.locator("th", { hasText: "1M Change" })).toBeVisible();

    // Check sector data
    await expect(table).toContainText("NIFTY 50");
    await expect(table).toContainText("NIFTY BANK");
  });

  test("should display rotation timeline", async ({ page }) => {
    await gotoSector(page);
    await page.locator('[role="tab"]:has-text("Sector Correlation")').click();

    const timeline = page.locator('[data-testid="rotation-timeline"]');
    await expect(timeline).toBeVisible();
    await expect(timeline).toContainText("Sector Rotation");
  });

  test("should switch between India and US markets", async ({ page }) => {
    await gotoSector(page);
    await page.locator('[role="tab"]:has-text("Sector Correlation")').click();

    // Initially India - check table shows Indian sectors
    const table = page.locator('[data-testid="relative-strength-table"]');
    await expect(table).toContainText("NIFTY 50");
    await expect(table).toContainText("NIFTY BANK");

    // Switch to US - use the market select control
    await page.getByTestId("market-segment").click();
    await page.getByRole("option", { name: "US" }).click();

    // US sector ETFs should appear in table
    await expect(table).toContainText("SPY");
    await expect(table).toContainText("XLK");
  });

  test("should change lookback period and refresh data", async ({ page }) => {
    await gotoSector(page);
    await page.locator('[role="tab"]:has-text("Sector Correlation")').click();

    // Wait for initial data load
    const table = page.locator('[data-testid="relative-strength-table"]');
    await expect(table).toBeVisible({ timeout: 10000 });

    // Change lookback to 1M
    await page.getByTestId("lookback-segment").click();
    await page.getByRole("option", { name: "1M" }).click();

    // Data should still render
    await expect(table).toBeVisible();
    await expect(table).toContainText("NIFTY 50");
  });

  test("should show last updated timestamp", async ({ page }) => {
    await gotoSector(page);
    await page.locator('[role="tab"]:has-text("Sector Correlation")').click();

    // Look for timestamp indicator (clock icon nearby)
    const view = page.locator('[data-testid="sector-analysis-view"]');
    await expect(view).toBeVisible();
    // Wait until the last-updated timestamp has been rendered
    await expect
      .poll(async () =>
        view.evaluate((el) => /\d{1,2}:\d{2}:\d{2}\s*(AM|PM)/.test(el.innerText)),
      )
      .toBe(true);
    // Timestamp format like "12:34:56 PM"
    const hasTime = await view.evaluate((el) => {
      const text = el.innerText;
      return /\d{1,2}:\d{2}:\d{2}\s*(AM|PM)/.test(text);
    });
    expect(hasTime).toBe(true);
  });
});
