import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

test.describe("Filter Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should have score filter input", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const minScoreInput = page.getByTestId("min-score-input");
    await expect(minScoreInput).toBeVisible();
  });

  test("should have price filter input", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const maxPriceInput = page.getByTestId("max-price-input");
    await expect(maxPriceInput).toBeVisible();
  });

  test("should have sector filter dropdown", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const sectorSelect = page.getByTestId("sector-select");
    await expect(sectorSelect).toBeVisible();
  });

  test("should have reset filters button", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const resetBtn = page.getByTestId("reset-filters-btn");
    await expect(resetBtn).toBeVisible();
  });

  test("should change filter value when input is modified", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const minScoreInput = page.getByTestId("min-score-input");
    await minScoreInput.fill("50");
    await page.waitForTimeout(300);

    const value = await minScoreInput.inputValue();
    expect(value).toBe("50");
  });

  test("should click reset filters button", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    const resetBtn = page.getByTestId("reset-filters-btn");
    await resetBtn.click();
    await page.waitForTimeout(300);

    const rows = page.locator("table tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
  });
});
