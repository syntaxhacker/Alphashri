import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  mockTrendingResponse,
  loginAsTestUser,
  setupPaperTradingMocks,
  getCurrentConfig,
  mockStrategyConfig,
} from "../mocks/apiResponses";

test.describe("Alphashri", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should load the main page with title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Alphashri/);
  });

  test("should display data table", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 30000 });
    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible();
  });

  test("should display mock stock data", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("table tbody tr", { timeout: 30000 });

    // Check that mock data is displayed - use more specific selector
    const firstSymbol = mockTrendingResponse.approaching[0].symbol;
    await expect(page.getByRole("cell", { name: firstSymbol })).toBeVisible();
  });
});

test.describe("Paper Trading Settings", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await setupPaperTradingMocks(page);
  });

  test("should update Max Positions to 4, save, and persist on refresh", async ({ page }) => {
    // Navigate to the app
    await page.goto("/");

    // Click on Paper Trading in the nav
    await page.click("text=Paper Trading");

    // Wait for paper trading view to load
    await expect(page.locator('[data-testid="paper-trading-view"]')).toBeVisible({
      timeout: 10000,
    });

    // Click on Settings tab
    await page.click('[data-testid="tab-settings"]');

    // Wait for settings panel to load
    await expect(page.locator('[data-testid="settings-panel"]')).toBeVisible({
      timeout: 10000,
    });

    // Verify initial Max Positions value is 5 (from mock)
    const maxPositionsInput = page.locator('[data-testid="config-max-positions"]');
    await expect(maxPositionsInput).toHaveValue("5");

    // Clear and enter new value
    await maxPositionsInput.fill("4");

    // Verify the value was changed in the input
    await expect(maxPositionsInput).toHaveValue("4");

    // Trigger change event by pressing Enter or blurring
    await maxPositionsInput.press("Enter");

    // Wait for state to update and dirty flag to be set
    await page.waitForTimeout(100);

    // Wait for the save button to be enabled (not disabled) since config is now dirty
    const saveButton = page.locator('[data-testid="save-settings-button"]');
    await expect(saveButton).toBeEnabled({ timeout: 5000 });

    // Click the Save button
    await saveButton.click();

    // Wait for save to complete
    await page.waitForTimeout(500);

    // Verify the config was updated in the mock
    expect(getCurrentConfig().max_positions).toBe(4);

    // Refresh the page
    await page.reload();

    // Navigate back to Paper Trading > Settings
    await page.click("text=Paper Trading");
    await page.click('[data-testid="tab-settings"]');

    // Wait for settings panel to load
    await expect(page.locator('[data-testid="settings-panel"]')).toBeVisible({ timeout: 10000 });

    // Verify Max Positions is still 4 after refresh
    const maxPositionsAfterRefresh = page.locator('[data-testid="config-max-positions"]');
    await expect(maxPositionsAfterRefresh).toHaveValue("4");
  });

  test("should display all settings sections", async ({ page }) => {
    // Navigate to the app
    await page.goto("/");

    // Click on Paper Trading in the nav
    await page.click("text=Paper Trading");

    // Click on Settings tab
    await page.click('[data-testid="tab-settings"]');

    // Wait for settings panel to load
    await expect(page.locator('[data-testid="settings-panel"]')).toBeVisible({
      timeout: 10000,
    });

    // Verify all sections are visible (Mantine uses Divider with labels)
    await expect(page.locator("text=ORB Settings")).toBeVisible();
    await expect(page.locator("text=Risk Management")).toBeVisible();
    await expect(page.locator("text=Runner Settings")).toBeVisible();
    await expect(page.locator("text=Trading Costs")).toBeVisible();

    // Verify key inputs exist with correct default values
    await expect(page.locator('[data-testid="config-sl-pct"]')).toHaveValue("0.4");
    await expect(page.locator('[data-testid="config-tp-pct"]')).toHaveValue("1.2");
    await expect(page.locator('[data-testid="config-cooldown"]')).toHaveValue("30");
  });

  test("should reset settings to defaults", async ({ page }) => {
    // Navigate to the app
    await page.goto("/");

    // Click on Paper Trading in the nav
    await page.click("text=Paper Trading");

    // Click on Settings tab
    await page.click('[data-testid="tab-settings"]');

    // Wait for settings panel to load
    await expect(page.locator('[data-testid="settings-panel"]')).toBeVisible({
      timeout: 10000,
    });

    // Change Max Positions to 3
    const maxPositionsInput = page.locator('[data-testid="config-max-positions"]');
    await maxPositionsInput.fill("3");
    await expect(maxPositionsInput).toHaveValue("3");

    // Set up dialog handler before clicking reset
    page.on("dialog", (dialog) => dialog.accept());

    // Click the Reset button
    const resetButton = page.locator('[data-testid="reset-settings-button"]');
    await resetButton.click();

    // Wait for reset to complete
    await page.waitForTimeout(500);

    // Refresh to get the reset values from the mock
    await page.reload();

    // Navigate back to settings
    await page.click("text=Paper Trading");
    await page.click('[data-testid="tab-settings"]');

    // Wait for settings panel to load
    await expect(page.locator('[data-testid="settings-panel"]')).toBeVisible({ timeout: 10000 });

    // Verify Max Positions is back to default (5)
    const maxPositionsAfterReset = page.locator('[data-testid="config-max-positions"]');
    await expect(maxPositionsAfterReset).toHaveValue("5");
  });
});
