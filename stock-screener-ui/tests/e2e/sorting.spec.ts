import { test, expect } from "@playwright/test";
import { setupApiMocks } from "../mocks/apiResponses";

test.describe("Table Sorting", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test("should sort by Score column when clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    // Click on Score header to sort (use first() since there are 2 tables)
    const scoreHeader = page.locator("th").filter({ hasText: "Score" }).first();
    await scoreHeader.click();
    await page.waitForTimeout(300);

    // Verify sort indicator appears
    const indicator = scoreHeader.locator(".sort-indicator");
    expect(await indicator.count()).toBeGreaterThan(0);
  });

  test("should toggle sort direction when clicking same column twice", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const scoreHeader = page.locator("th").filter({ hasText: "Score" }).first();

    // First click - descending
    await scoreHeader.click();
    await page.waitForTimeout(300);

    // Verify descending indicator
    let indicator = scoreHeader.locator(".sort-indicator.desc");
    expect(await indicator.count()).toBeGreaterThan(0);

    // Second click - ascending
    await scoreHeader.click();
    await page.waitForTimeout(300);

    // Verify ascending indicator
    indicator = scoreHeader.locator(".sort-indicator.asc");
    expect(await indicator.count()).toBeGreaterThan(0);
  });

  test("should sort by Symbol column", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    // Click on Symbol column header
    const symbolHeader = page.locator("th").filter({ hasText: "Symbol" }).first();
    await symbolHeader.click();
    await page.waitForTimeout(300);

    // Verify sort indicator is visible
    const indicator = symbolHeader.locator(".sort-indicator");
    expect(await indicator.count()).toBeGreaterThan(0);
  });

  test("should show clickable sort indicators on sortable columns", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    // Check that sortable headers have the sortable class
    const sortableHeaders = page.locator("th.sortable");
    const count = await sortableHeaders.count();

    // Should have multiple sortable columns
    expect(count).toBeGreaterThan(0);
  });
});
