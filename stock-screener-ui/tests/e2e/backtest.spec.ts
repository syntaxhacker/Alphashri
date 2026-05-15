import { test, expect } from "@playwright/test";
import { testUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import {
  setupFullBacktestMocks,
  mockBacktestStrategies,
  gotoBacktest,
  selectSymbolAndRun,
  waitForBacktestResult,
} from "./helpers/backtestHelpers";

test.describe("Backtest View - Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupFullBacktestMocks(page);
  });

  test("should display symbol multiselect", async ({ page }) => {
    await gotoBacktest(page);
    await expect(page.locator('[data-testid="symbol-multiselect"]')).toBeVisible();
  });

  test("should add symbol to list", async ({ page }) => {
    await gotoBacktest(page);
    const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
    await symbolSelect.click();
    await expect(page.locator(".mantine-MultiSelect-dropdown")).toBeVisible({ timeout: 5000 });
    await page.keyboard.type("RELIANCE", { delay: 50 });
    await page.waitForSelector(".mantine-MultiSelect-option", { timeout: 5000 });
    const options = page.locator(".mantine-MultiSelect-option");
    await options.first().click();
    const runBtn = page.locator('[data-testid="run-backtest-btn"]');
    await runBtn.click();
    await expect(page.locator('[data-testid="results-table-wrapper"]')).toBeVisible({
      timeout: 15000,
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("alphashri_token", "test_access_token_12345");
      localStorage.setItem("alphashri_refresh_token", "test_refresh_token_12345");
      localStorage.setItem(
        "alphashri_user",
        JSON.stringify({
          id: 1,
          email: "test@alphashri.dev",
          display_name: "TestUser",
          initial_capital: 1000000,
          created_at: "2026-01-01T00:00:00",
        }),
      );
    });
    await page.route(apiRoute("auth/me"), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(testUser),
      });
    });
    await mockBacktestStrategies(page);
  });

  test("should display strategy config section", async ({ page }) => {
    await gotoBacktest(page);
    await expect(page.locator('[data-testid="strategy-config"]')).toBeVisible();
  });

  test("should display days input", async ({ page }) => {
    await gotoBacktest(page);
    await expect(page.locator('[data-testid="days-input"]')).toBeVisible();
  });

  test("should display include costs checkbox", async ({ page }) => {
    await gotoBacktest(page);
    await expect(page.locator('[data-testid="include-costs-checkbox"]')).toBeVisible();
  });

  test("should have reset option in run menu", async ({ page }) => {
    await gotoBacktest(page);

    const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
    await symbolSelect.click();
    await expect(page.locator(".mantine-MultiSelect-dropdown")).toBeVisible({ timeout: 5000 });
    await page.keyboard.type("RELIANCE", { delay: 50 });
    await page.waitForSelector(".mantine-MultiSelect-option", { timeout: 5000 });
    const option = page.locator(".mantine-MultiSelect-option").first();
    if (await option.isVisible()) {
      await option.click();
    }

    const runMenuBtn = page.locator('[data-testid="run-menu-btn"]');
    await expect(runMenuBtn).toBeEnabled({ timeout: 5000 });
    await runMenuBtn.click();

    const resetBtn = page.locator('[data-testid="reset-btn"]');
    await expect(resetBtn).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Backtest View - Run Backtest", () => {
  test.beforeEach(async ({ page }) => {
    await setupFullBacktestMocks(page);
  });

  test("should have run backtest button", async ({ page }) => {
    await gotoBacktest(page);
    await expect(page.locator('[data-testid="run-backtest-btn"]')).toBeVisible();
  });

  test("should run backtest and display results", async ({ page }) => {
    await gotoBacktest(page);
    await selectSymbolAndRun(page);
    await waitForBacktestResult(page);
  });
});

test.describe("Backtest View - Charts", () => {
  test.beforeEach(async ({ page }) => {
    await setupFullBacktestMocks(page);
  });

  test("should display chart tabs after backtest", async ({ page }) => {
    await gotoBacktest(page);
    await selectSymbolAndRun(page);
    await waitForBacktestResult(page, "chart-tabs");
  });

  test("should display zoom select after backtest", async ({ page }) => {
    await gotoBacktest(page);
    await selectSymbolAndRun(page);
    await waitForBacktestResult(page, "results-summary");
    await expect(page.locator('[data-testid="chart-zoom-select"]')).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Backtest View - Summary", () => {
  test.beforeEach(async ({ page }) => {
    await setupFullBacktestMocks(page);
  });

  test("should display results summary after backtest", async ({ page }) => {
    await gotoBacktest(page);
    await selectSymbolAndRun(page);
    await waitForBacktestResult(page, "results-summary");
  });
});
