import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { clickSortHeader, expectSortIndicator } from "./helpers/tableHelpers";

test.describe("Table Sorting", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should sort by Score column when clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    await clickSortHeader(page, "score");
    await expectSortIndicator(page, "score", "desc");
  });

  test("should toggle sort direction when clicking same column twice", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    await clickSortHeader(page, "score");
    await expectSortIndicator(page, "score", "desc");

    await clickSortHeader(page, "score");
    await expectSortIndicator(page, "score", "asc");
  });

  test("should sort by Symbol column", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const symbolHeader = page
      .locator('[data-testid="screener-table"] thead th', { hasText: /^Symbol/ })
      .first();
    await symbolHeader.click({ force: true });
    await expect(symbolHeader).toContainText("▲", { timeout: 5000 });
  });

  test("should show clickable sort indicators on sortable columns", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const sortableHeaders = page.locator('[data-testid="screener-table"] thead th');
    const count = await sortableHeaders.count();

    expect(count).toBeGreaterThan(0);
  });
});
