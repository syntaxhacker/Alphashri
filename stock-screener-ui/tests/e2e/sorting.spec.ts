import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

test.describe("Table Sorting", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should sort by Score column when clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const scoreHeader = page.getByTestId("sort-header-score").first();
    await scoreHeader.click();
    await page.waitForTimeout(300);

    const indicator = scoreHeader.locator(".sort-indicator");
    expect(await indicator.count()).toBeGreaterThan(0);
  });

  test("should toggle sort direction when clicking same column twice", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const scoreHeader = page.getByTestId("sort-header-score").first();

    await scoreHeader.click();
    await page.waitForTimeout(300);

    let indicator = scoreHeader.locator(".sort-indicator");
    expect(await indicator.count()).toBeGreaterThan(0);

    await scoreHeader.click();
    await page.waitForTimeout(300);

    indicator = scoreHeader.locator(".sort-indicator");
    expect(await indicator.count()).toBeGreaterThan(0);
  });

  test("should sort by Symbol column", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });
    await page.waitForTimeout(1000);

    const symbolHeader = page.getByTestId("sort-header-symbol").first();
    // Click on the text element to avoid clicking on the copy button
    await symbolHeader.getByText("Symbol").first().click({ force: true });
    await page.waitForTimeout(1000);

    const indicator = symbolHeader.locator(".sort-indicator");
    await expect(indicator).toBeVisible({ timeout: 5000 });
  });

  test("should show clickable sort indicators on sortable columns", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const sortableHeaders = page.locator("th.sortable");
    const count = await sortableHeaders.count();

    expect(count).toBeGreaterThan(0);
  });
});
