import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

test.describe("Screener - URL Params", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should restore screener from URL param on page load", async ({ page }) => {
    await page.goto("/?screener=builtin%3Abuyer_interest_enhanced");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    await expect(
      page.locator('[data-testid="screener-nav-option-buyer_interest_enhanced"]'),
    ).toBeVisible({ timeout: 5000 });

    // Verify the correct section title is shown (not fallback "Approaching")
    await expect(page.getByText(/Buyer Interest\+ \(\d+\)/)).toBeVisible({ timeout: 5000 });
  });

  test("should update URL when screener nav is clicked", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    await page.click('[data-testid="screener-nav-option-buyer_interest_enhanced"]', {
      force: true,
    });

    await expect(page).toHaveURL(/screener=/);
  });

  test("should update URL param when switching to trending", async ({ page }) => {
    await page.goto("/?screener=builtin%3Abuyer_interest_enhanced");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    await page.click('[data-testid="screener-nav-option-trending"]', {
      force: true,
    });

    await expect(page).toHaveURL(/screener=trending/);
  });

  test("should preserve URL screener param across tab switches", async ({ page }) => {
    await page.goto("/?screener=builtin%3Abuyer_interest_enhanced");
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    await page.click('[data-testid="tab-config"]');
    await page.waitForLoadState("networkidle");

    await page.click('[data-testid="tab-screener"]');
    await page.waitForSelector(".mantine-Table-tr", { timeout: 10000 });

    await expect(page).toHaveURL(/screener=/);
  });
});
