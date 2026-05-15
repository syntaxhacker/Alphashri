import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";

const mockHeatmapResponse = {
  stocks: [
    { symbol: "RELIANCE", name: "Reliance Industries", pe_ratio: 22.5, market_cap: 15000000000000, price: 2850, change_pct: 1.2, sector: "Energy", pb_ratio: 2.5, dividend_yield: 0.8, perf_1y: 12.3, roe: 15.2, high_52w: 3000, low_52w: 2400 },
    { symbol: "TCS", name: "Tata Consultancy Services", pe_ratio: 28.0, market_cap: 12000000000000, price: 4200, change_pct: -0.5, sector: "Technology", pb_ratio: 8.1, dividend_yield: 0.5, perf_1y: 8.7, roe: 25.4, high_52w: 4500, low_52w: 3800 },
    { symbol: "HDFCBANK", name: "HDFC Bank", pe_ratio: 18.0, market_cap: 10000000000000, price: 1650, change_pct: 0.8, sector: "Financial Services", pb_ratio: 3.2, dividend_yield: 1.1, perf_1y: 5.2, roe: 18.9, high_52w: 1800, low_52w: 1400 },
    { symbol: "ICICIBANK", name: "ICICI Bank", pe_ratio: 16.5, market_cap: 9000000000000, price: 1400, change_pct: 0.3, sector: "Financial Services", pb_ratio: 2.8, dividend_yield: 0.9, perf_1y: 10.1, roe: 16.2, high_52w: 1500, low_52w: 1200 },
    { symbol: "INFY", name: "Infosys", pe_ratio: 24.0, market_cap: 8000000000000, price: 1800, change_pct: -0.2, sector: "Technology", pb_ratio: 7.5, dividend_yield: 0.6, perf_1y: -3.2, roe: 22.1, high_52w: 2000, low_52w: 1600 },
  ],
  cached: false,
};

const mockSectorsResponse = {
  sectors: [
    { name: "Energy", count: 5 },
    { name: "Technology", count: 10 },
    { name: "Financial Services", count: 15 },
  ],
};

test.describe("Heatmap Page", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);

    await page.route(apiRoute("heatmap/pe"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockHeatmapResponse),
      });
    });

    await page.route(apiRoute("heatmap/sectors"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockSectorsResponse),
      });
    });

    await page.goto("/heatmap");
  });

  test("should display heatmap page", async ({ page }) => {
    await expect(page.locator('[data-testid="heatmap-page"]')).toBeVisible();
  });

  test("should display title and badge", async ({ page }) => {
    await expect(page.locator('[data-testid="heatmap-title"]')).toBeVisible();
    await expect(page.locator('[data-testid="heatmap-badge"]')).toBeVisible();
  });

  test("should display sector filter", async ({ page }) => {
    await expect(page.locator('[data-testid="heatmap-sector-filter"]')).toBeVisible();
  });

  test("should display search input", async ({ page }) => {
    await expect(page.locator('[data-testid="heatmap-search"]')).toBeVisible();
  });

  test("should display metric selector", async ({ page }) => {
    await expect(page.locator('[data-testid="heatmap-metric"]')).toBeVisible();
  });

  test("should display view selector", async ({ page }) => {
    await expect(page.locator('[data-testid="heatmap-view"]')).toBeVisible();
  });

  test("should display stock count", async ({ page }) => {
    await expect(page.locator('[data-testid="heatmap-stock-count"]')).toContainText("5 stocks");
  });

  test("should display treemap by default", async ({ page }) => {
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="heatmap-page"] canvas').first()).toBeVisible();
  });

  test("should switch to list view", async ({ page }) => {
    await page.waitForTimeout(1000);
    await page.locator('[data-testid="heatmap-view"]').click();
    await page.getByRole("option", { name: "List" }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="heatmap-list-table"]')).toBeVisible({ timeout: 10000 });
  });

  test("should switch to scatter view", async ({ page }) => {
    await page.waitForTimeout(1000);
    await page.locator('[data-testid="heatmap-view"]').click();
    await page.getByRole("option", { name: "Scatter" }).click();
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="heatmap-page"] canvas').first()).toBeVisible();
  });

  test("should filter by sector", async ({ page }) => {
    await page.waitForTimeout(1000);
    await page.locator('[data-testid="heatmap-sector-filter"]').click();
    const option = page.getByRole("option", { name: /Energy/ });
    await expect(option).toBeVisible({ timeout: 3000 });
    await option.click();
    await expect(page.locator('[data-testid="heatmap-stock-count"]')).toContainText("1 stock");
  });

  test("should search by symbol", async ({ page }) => {
    await page.waitForTimeout(1000);
    await page.locator('[data-testid="heatmap-search"]').fill("TCS");
    await expect(page.locator('[data-testid="heatmap-stock-count"]')).toContainText("1 stock");
  });

  test("should display legend with metric range", async ({ page }) => {
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-testid="heatmap-legend-label"]')).toBeVisible();
    await expect(page.locator('[data-testid="heatmap-legend-min"]')).toBeVisible();
    await expect(page.locator('[data-testid="heatmap-legend-max"]')).toBeVisible();
  });

  test("should switch metric", async ({ page }) => {
    await page.waitForTimeout(1000);
    await page.locator('[data-testid="heatmap-metric"]').click();
    const option = page.getByRole("option", { name: "P/E Ratio" });
    await expect(option).toBeVisible({ timeout: 3000 });
    await option.click();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="heatmap-stock-count"]')).toContainText("5 stocks");
  });
});