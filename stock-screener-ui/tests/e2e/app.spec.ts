import { test, expect } from "@playwright/test";
import { mockTrendingResponse, setupPaperTradingMocks, setupMultiStrategyBotMocks } from "../mocks/apiResponses";
import {
  setupScreenerApp,
  openScreenerTable,
  navigateToPaperTradingSettings,
} from "./helpers/flowsB";

test.describe("Alphashri", () => {
  test.beforeEach(async ({ page }) => {
    await setupScreenerApp(page);
  });

  test("@smoke should load the main page with title", async ({ page }) => {
    await page.goto("/?tab=screener");
    await expect(page).toHaveTitle(/Alphashri/);
  });

  test("should display data table", async ({ page }) => {
    await openScreenerTable(page, 30000);
    const rows = page.locator('[data-testid="screener-table"] tbody tr');
    await expect(rows.first()).toBeVisible();
  });

  test("should display mock stock data", async ({ page }) => {
    await openScreenerTable(page, 30000);

    // Check that mock data is displayed - use more specific selector
    const firstSymbol = mockTrendingResponse.approaching[0].symbol;
    await expect(page.locator(`[data-testid="symbol-cell-${firstSymbol}"]`)).toBeVisible();
  });
});

test.describe.configure({ mode: "parallel" });

test.describe("Paper Trading Settings", () => {
  test.beforeEach(async ({ page }) => {
    await setupPaperTradingMocks(page);
    await setupMultiStrategyBotMocks(page);
  });

  test("should update Max Positions to 4, save, and persist on refresh", async ({ page }) => {
    await navigateToPaperTradingSettings(page);

    const maxPositionsInput = page.locator('[data-testid="config-max-positions"] input');
    await expect(maxPositionsInput).toBeVisible({ timeout: 5000 });
    await expect(maxPositionsInput).toHaveValue("5");

    await maxPositionsInput.fill("4");
    await expect(maxPositionsInput).toHaveValue("4");
    await expect(page.locator('[data-testid="save-settings-button"]')).toBeEnabled();

    const saveButton = page.locator('[data-testid="save-settings-button"]');
    await expect(saveButton).toBeEnabled({ timeout: 10000 });
    await saveButton.click({ force: true });
    await expect(saveButton).toContainText("Saved", { timeout: 10000 });

    // Navigate fresh to paper trading settings after reload
    await navigateToPaperTradingSettings(page);

    const maxPositionsAfterRefresh = page.locator('[data-testid="config-max-positions"] input');
    await expect(maxPositionsAfterRefresh).toHaveValue("4");
  });

  test("should display all settings sections", async ({ page }) => {
    await navigateToPaperTradingSettings(page);

    await expect(page.locator("text=ORB Settings")).toBeVisible();
    await expect(page.locator("text=Risk Management")).toBeVisible();
    await expect(page.locator("text=Runner Settings")).toBeVisible();
    await expect(page.locator("text=Trading Costs")).toBeVisible();

    await expect(page.locator('[data-testid="config-sl-pct"] input')).toHaveValue("0.4");
    await expect(page.locator('[data-testid="config-tp-pct"] input')).toHaveValue("1.2");
    await expect(page.locator('[data-testid="config-cooldown"] input')).toHaveValue("30");
  });

  test("should reset settings to defaults", async ({ page }) => {
    await navigateToPaperTradingSettings(page);

    const maxPositionsInput = page.locator('[data-testid="config-max-positions"] input');
    await maxPositionsInput.fill("3");
    await expect(maxPositionsInput).toHaveValue("3");

    page.on("dialog", (dialog) => dialog.accept());

    const resetButton = page.locator('[data-testid="reset-settings-button"]');
    await resetButton.click();
    await navigateToPaperTradingSettings(page);

    const maxPositionsAfterReset = page.locator('[data-testid="config-max-positions"] input');
    await expect(maxPositionsAfterReset).toHaveValue("5");
  });
});
