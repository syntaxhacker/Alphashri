import { test, expect, type Page } from "@playwright/test";
import { setupSectorTest, gotoSector } from "./helpers/sectorHelpers";

async function gotoCorrelation(page: Page) {
  await page.getByTestId("sector-nav-correlation").click();
  await expect(page.locator("#correlation")).toBeInViewport();
  await expect(page.getByTestId("sector-section-correlation")).toBeInViewport();
}

test.describe("Sector Correlation & Rotation", () => {
  test.beforeEach(async ({ page }) => {
    await setupSectorTest(page);
  });

  test("should display the Sector Correlation section anchor", async ({ page }) => {
    await gotoSector(page);
    const nav = page.getByTestId("sector-section-nav");
    await expect(nav).toBeVisible();
    const link = page.getByTestId("sector-nav-correlation");
    await expect(link).toHaveAttribute("href", "#correlation");
    await expect(link).toHaveText("Correlation");
    await expect(page.locator("#correlation")).toBeAttached();
    await expect(page.getByTestId("sector-section-correlation")).toHaveAttribute("tabindex", "-1");
  });

  test("should navigate to the correlation section and display heatmap", async ({ page }) => {
    await gotoSector(page);
    await gotoCorrelation(page);

    const heatmap = page.locator('[data-testid="sector-correlation-heatmap"]');
    await expect(heatmap).toBeVisible();

    // Heatmap is rendered via ECharts canvas; verify canvas is present
    const canvas = heatmap.locator("canvas");
    await expect(canvas).toBeVisible();
  });

  test("should display beta bar chart", async ({ page }) => {
    await gotoSector(page);
    await gotoCorrelation(page);

    const betaChart = page.locator('[data-testid="sector-beta-chart"]');
    await expect(betaChart).toBeVisible();
    await expect(betaChart).toContainText("Beta");
    await expect(betaChart).toContainText("Benchmark");
  });

  test("should display relative strength table with rankings", async ({ page }) => {
    await gotoSector(page);
    await gotoCorrelation(page);

    const table = page.locator('[data-testid="relative-strength-table"] table');
    await expect(table).toBeVisible();

    await expect(table.locator("th", { hasText: "Rank" })).toBeVisible();
    await expect(table.locator("th", { hasText: "Sector" })).toBeVisible();
    await expect(table.locator("th", { hasText: "5D RS" })).toBeVisible();
    await expect(table.locator("th", { hasText: "1M RS" })).toBeVisible();
    await expect(table.locator("th", { hasText: "3M RS" })).toBeVisible();
    await expect(table.locator("th", { hasText: "Beta" })).toBeVisible();
    await expect(table.locator("th", { hasText: "1M Change" })).toBeVisible();

    await expect(table).toContainText("NIFTY 50");
    await expect(table).toContainText("NIFTY BANK");
  });

  test("should display rotation timeline", async ({ page }) => {
    await gotoSector(page);
    await gotoCorrelation(page);

    const timeline = page.locator('[data-testid="rotation-timeline"]');
    await expect(timeline).toBeVisible();
    await expect(timeline).toContainText("Sector Rotation");
  });

  test("should switch between India and US markets", async ({ page }) => {
    await gotoSector(page);
    await gotoCorrelation(page);

    // Initially India - check table shows Indian sectors
    const table = page.locator('[data-testid="relative-strength-table"]');
    await expect(table).toContainText("NIFTY 50");
    await expect(table).toContainText("NIFTY BANK");

    // Switch to US. market-segment is a non-searchable Select -> native
    // <select>, so there is no role=option popup to open.
    await page.getByTestId("market-segment").locator("select").selectOption({ label: "US" });

    await expect(table).toContainText("SPY");
    await expect(table).toContainText("XLK");
  });

  test("should change lookback period and refresh data", async ({ page }) => {
    await gotoSector(page);
    await gotoCorrelation(page);

    const table = page.locator('[data-testid="relative-strength-table"]');
    await expect(table).toBeVisible({ timeout: 10000 });

    // Change lookback to 1M (also a native <select>)
    await page.getByTestId("lookback-segment").locator("select").selectOption({ label: "1M" });

    await expect(table).toBeVisible();
    await expect(table).toContainText("NIFTY 50");
  });

  test("should show last updated timestamp", async ({ page }) => {
    await gotoSector(page);
    await gotoCorrelation(page);

    // Look for timestamp indicator (clock icon nearby)
    const view = page.locator('[data-testid="sector-analysis-view"]');
    await expect(view).toBeVisible();
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
