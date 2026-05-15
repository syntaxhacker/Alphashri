import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
test.describe("Screener - Section Labels", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });
  test("should show dynamic section labels for non-52W screener", async ({ page }) => {
    await page.goto("/?screener=builtin%3Abuyer_interest_enhanced");
    await page.waitForSelector(".mantine-Table-tr", {
      timeout: 10000,
    });
    await expect(page.getByText(/Buyer Interest\+ \(\d+\)/)).toBeVisible();
  });
  test("should show approaching/touched for trending screener", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", {
      timeout: 10000,
    });
    await expect(page.getByText("Approaching")).toBeVisible();
  });
  test("should keep nav active after API resolves", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", {
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="screener-nav-option-trending"]')).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="screener-nav-option-trending"]')).toBeVisible();
  });
  test("should show touched section when data has touched stocks", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", {
      timeout: 10000,
    });
    await expect(page.getByText(/Touched \(\d+\)/)).toBeVisible();
  });
});
