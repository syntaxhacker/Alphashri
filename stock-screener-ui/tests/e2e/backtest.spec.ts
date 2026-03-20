import { test, expect, Page } from "@playwright/test";
import { setupApiMocks, testUser } from "../mocks/apiResponses";

async function setupBacktestMocks(page: Page) {
  await page.route("**/api/backtest/strategies", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        strategies: [
          { id: "orb", name: "ORB Strategy", type: "orb", params: [] },
          { id: "52w_chaser", name: "52W Chaser", type: "52w_chaser", params: [] },
        ],
      }),
    });
  });

  await page.route("**/api/strategies/variations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "default", name: "Default ORB", strategy_type: "orb" },
        { id: "conservative", name: "Conservative ORB", strategy_type: "orb" },
      ]),
    });
  });

  await page.route("**/api/backtest/costs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        costs: {
          brokerage_pct: 0.0003,
          min_brokerage: 20,
          stt_pct: 0.00025,
          exchange_pct: 0.0000297,
          sebi_pct: 0.000001,
          stamp_pct: 0.00003,
          gst_pct: 0.18,
        },
      }),
    });
  });
}

async function loginAndSetupMocks(page: Page) {
  await setupApiMocks(page);
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
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(testUser),
    });
  });
  await setupBacktestMocks(page);
}

test.describe("Backtest View - Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSetupMocks(page);

    // Mock symbol search API
    await page.route("**/api/symbols/search**", async (route) => {
      const url = route.request().url();
      const queryMatch = url.match(/[?&]q=([^&]+)/);
      const query = queryMatch ? queryMatch[1].toLowerCase() : "";

      const symbols = [
        { symbol: "RELIANCE", name: "Reliance Industries Ltd" },
        { symbol: "TCS", name: "Tata Consultancy Services" },
        { symbol: "INFY", name: "Infosys Ltd" },
        { symbol: "HDFC", name: "HDFC Bank Ltd" },
      ];

      const results = symbols.filter(
        (s) => s.symbol.toLowerCase().includes(query) || s.name.toLowerCase().includes(query),
      );

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results, query, total: results.length }),
      });
    });

    await page.route("**/api/backtest/run**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              symbol: "RELIANCE",
              trades: 10,
              wins: 6,
              losses: 4,
              win_rate: 60,
              gross_pnl: 6000,
              total_costs: 1000,
              net_pnl: 5000,
              pf: 1.5,
              tp_exits: 5,
              sl_exits: 3,
              eod_exits: 2,
            },
          ],
          totals: {
            gross_pnl: 6000,
            total_costs: 1000,
            net_pnl: 5000,
            trades: 10,
            win_rate: 60,
          },
          run_time: "2024-01-01T00:00:00Z",
        }),
      });
    });

    // Mock chart data endpoint
    await page.route("**/api/backtest/chart/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol: "RELIANCE",
          candles: [],
          orb_zones: [],
          pivot_levels: [],
          trades: [],
          date_range: { start: "2024-01-01", end: "2024-01-31" },
          total_candles: 100,
          total_trades: 10,
        }),
      });
    });
  });

  test("should display symbol multiselect", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    await expect(page.locator('[data-testid="symbol-multiselect"]')).toBeVisible();
  });

  test("should add symbol to list", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    // Click to focus on MultiSelect
    const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
    await symbolSelect.click();
    await expect(page.locator(".mantine-MultiSelect-dropdown")).toBeVisible({ timeout: 5000 });

    // Type in the searchable input
    await page.keyboard.type("RELIANCE", { delay: 50 });
    await page.waitForSelector(".mantine-MultiSelect-option", { timeout: 5000 });

    // Click on the option from dropdown
    const options = page.locator(".mantine-MultiSelect-option");
    await options.first().click();

    const runBtn = page.locator('[data-testid="run-backtest-btn"]');
    await runBtn.click();
    // Wait for results to be displayed
    await expect(page.locator('[data-testid="results-table-wrapper"]')).toBeVisible({
      timeout: 15000,
    });
  });

  test.beforeEach(async ({ page }) => {
    await loginAndSetupMocks(page);
  });

  test("should display strategy config section", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    const strategyConfig = page.locator('[data-testid="strategy-config"]');
    await expect(strategyConfig).toBeVisible();
  });

  test("should display days input", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    const daysInput = page.locator('[data-testid="days-input"]');
    await expect(daysInput).toBeVisible();
  });

  test("should display include costs checkbox", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    const costsCheckbox = page.locator('[data-testid="include-costs-checkbox"]');
    await expect(costsCheckbox).toBeVisible();
  });

  test("should have reset button", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    const resetBtn = page.locator('[data-testid="reset-btn"]');
    await expect(resetBtn).toBeVisible();
  });
});

test.describe("Backtest View - Run Backtest", () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSetupMocks(page);

    // Mock symbol search API
    await page.route("**/api/symbols/search**", async (route) => {
      const url = route.request().url();
      const queryMatch = url.match(/[?&]q=([^&]+)/);
      const query = queryMatch ? queryMatch[1].toLowerCase() : "";

      const symbols = [
        { symbol: "RELIANCE", name: "Reliance Industries Ltd" },
        { symbol: "TCS", name: "Tata Consultancy Services" },
        { symbol: "INFY", name: "Infosys Ltd" },
        { symbol: "HDFC", name: "HDFC Bank Ltd" },
      ];

      const results = symbols.filter(
        (s) => s.symbol.toLowerCase().includes(query) || s.name.toLowerCase().includes(query),
      );

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results, query, total: results.length }),
      });
    });

    await page.route("**/api/backtest/run**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              symbol: "RELIANCE",
              trades: 10,
              wins: 6,
              losses: 4,
              win_rate: 60,
              gross_pnl: 6000,
              total_costs: 1000,
              net_pnl: 5000,
              pf: 1.5,
              tp_exits: 5,
              sl_exits: 3,
              eod_exits: 2,
            },
          ],
          totals: {
            gross_pnl: 6000,
            total_costs: 1000,
            net_pnl: 5000,
            trades: 10,
            win_rate: 60,
          },
          run_time: "2024-01-01T00:00:00Z",
        }),
      });
    });

    await page.route("**/api/backtest/chart/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol: "RELIANCE",
          candles: [],
          orb_zones: [],
          pivot_levels: [],
          trades: [],
          date_range: { start: "2024-01-01", end: "2024-01-31" },
          total_candles: 100,
          total_trades: 10,
        }),
      });
    });
  });

  test("should have run backtest button", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    await expect(page.locator('[data-testid="run-backtest-btn"]')).toBeVisible();
  });

  test("should run backtest and display results", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    // Click to focus on MultiSelect
    const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
    await symbolSelect.click();

    await expect(page.locator(".mantine-MultiSelect-dropdown")).toBeVisible({ timeout: 5000 });

    // Type in the searchable input
    await page.keyboard.type("RELIANCE", { delay: 50 });
    await page.waitForSelector(".mantine-MultiSelect-option", { timeout: 5000 });

    // Wait for first option to be visible and click
    const option = page.locator(".mantine-MultiSelect-option").first();
    await option.waitFor({ state: "visible", timeout: 5000 });
    await option.click();

    const runBtn = page.locator('[data-testid="run-backtest-btn"]');
    await expect(runBtn).toBeEnabled({ timeout: 5000 });
    await runBtn.click();

    // Wait for backtest to complete with proper error handling
    try {
      await page.waitForSelector('[data-testid="results-table-wrapper"]', { timeout: 15000 });
    } catch (e) {
      const errorAlert = page.locator('[data-testid="backtest-error"]');
      if (await errorAlert.isVisible()) {
        const errorText = await errorAlert.textContent();
        throw new Error(`Backtest failed with error: ${errorText}`);
      }
      throw e;
    }
    await expect(page.locator('[data-testid="results-table-wrapper"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="backtest-error"]')).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe("Backtest View - Charts", () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSetupMocks(page);

    // Mock symbol search API
    await page.route("**/api/symbols/search**", async (route) => {
      const url = route.request().url();
      const queryMatch = url.match(/[?&]q=([^&]+)/);
      const query = queryMatch ? queryMatch[1].toLowerCase() : "";

      const symbols = [
        { symbol: "RELIANCE", name: "Reliance Industries Ltd" },
        { symbol: "TCS", name: "Tata Consultancy Services" },
        { symbol: "INFY", name: "Infosys Ltd" },
        { symbol: "HDFC", name: "HDFC Bank Ltd" },
      ];

      const results = symbols.filter(
        (s) => s.symbol.toLowerCase().includes(query) || s.name.toLowerCase().includes(query),
      );

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results, query, total: results.length }),
      });
    });

    await page.route("**/api/backtest/run**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              symbol: "RELIANCE",
              trades: 10,
              wins: 6,
              losses: 4,
              win_rate: 60,
              gross_pnl: 6000,
              total_costs: 1000,
              net_pnl: 5000,
              pf: 1.5,
              tp_exits: 5,
              sl_exits: 3,
              eod_exits: 2,
            },
          ],
          totals: { gross_pnl: 6000, total_costs: 1000, net_pnl: 5000, trades: 10, win_rate: 60 },
          run_time: "2024-01-01T00:00:00Z",
        }),
      });
    });

    await page.route("**/api/backtest/chart/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol: "RELIANCE",
          candles: [],
          orb_zones: [],
          pivot_levels: [],
          trades: [],
          date_range: { start: "2024-01-01", end: "2024-01-31" },
          total_candles: 100,
          total_trades: 10,
        }),
      });
    });
  });

  test("should display chart tabs after backtest", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    // Click to focus on MultiSelect
    const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
    await symbolSelect.click();

    await expect(page.locator(".mantine-MultiSelect-dropdown")).toBeVisible({ timeout: 5000 });

    // Type in the searchable input
    await page.keyboard.type("RELIANCE", { delay: 50 });
    await page.waitForSelector(".mantine-MultiSelect-option", { timeout: 5000 });

    // Wait for first option to be visible and click
    const option = page.locator(".mantine-MultiSelect-option").first();
    await option.waitFor({ state: "visible", timeout: 5000 });
    await option.click();

    const runBtn = page.locator('[data-testid="run-backtest-btn"]');
    await expect(runBtn).toBeEnabled({ timeout: 5000 });
    await runBtn.click();

    // Wait for backtest to complete
    try {
      await page.waitForSelector('[data-testid="chart-tabs"]', { timeout: 15000 });
    } catch (e) {
      const errorAlert = page.locator('[data-testid="backtest-error"]');
      if (await errorAlert.isVisible()) {
        const errorText = await errorAlert.textContent();
        throw new Error(`Backtest failed with error: ${errorText}`);
      }
      throw e;
    }
    await expect(page.locator('[data-testid="chart-tabs"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="backtest-error"]')).not.toBeVisible({ timeout: 3000 });
  });

  test("should display zoom select after backtest", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    // Select symbol
    const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
    await symbolSelect.click();
    await expect(page.locator(".mantine-MultiSelect-dropdown")).toBeVisible({ timeout: 5000 });
    await page.keyboard.type("RELIANCE", { delay: 50 });
    await page.waitForSelector(".mantine-MultiSelect-option", { timeout: 5000 });

    const options = page.locator(".mantine-MultiSelect-option");
    await options.first().waitFor({ state: "visible", timeout: 5000 });
    await options.first().click();

    // Wait for run button to be enabled and click
    const runBtn = page.locator('[data-testid="run-backtest-btn"]');
    await expect(runBtn).toBeEnabled({ timeout: 5000 });
    await runBtn.click();

    // Wait for backtest results to load
    try {
      await page.waitForSelector('[data-testid="results-summary"]', { timeout: 15000 });
    } catch (e) {
      const errorAlert = page.locator('[data-testid="backtest-error"]');
      if (await errorAlert.isVisible()) {
        const errorText = await errorAlert.textContent();
        throw new Error(`Backtest failed with error: ${errorText}`);
      }
      throw e;
    }
    await expect(page.locator('[data-testid="results-summary"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="backtest-error"]')).not.toBeVisible({ timeout: 3000 });

    // Now chart-zoom-select should be visible
    await expect(page.locator('[data-testid="chart-zoom-select"]')).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Backtest View - Summary", () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSetupMocks(page);

    // Mock symbol search API
    await page.route("**/api/symbols/search**", async (route) => {
      const url = route.request().url();
      const queryMatch = url.match(/[?&]q=([^&]+)/);
      const query = queryMatch ? queryMatch[1].toLowerCase() : "";

      const symbols = [
        { symbol: "RELIANCE", name: "Reliance Industries Ltd" },
        { symbol: "TCS", name: "Tata Consultancy Services" },
        { symbol: "INFY", name: "Infosys Ltd" },
        { symbol: "HDFC", name: "HDFC Bank Ltd" },
      ];

      const results = symbols.filter(
        (s) => s.symbol.toLowerCase().includes(query) || s.name.toLowerCase().includes(query),
      );

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results, query, total: results.length }),
      });
    });

    await page.route("**/api/backtest/run**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              symbol: "RELIANCE",
              trades: 10,
              wins: 6,
              losses: 4,
              win_rate: 60,
              gross_pnl: 6000,
              total_costs: 1000,
              net_pnl: 5000,
              pf: 1.5,
              tp_exits: 5,
              sl_exits: 3,
              eod_exits: 2,
            },
          ],
          totals: { gross_pnl: 6000, total_costs: 1000, net_pnl: 5000, trades: 10, win_rate: 60 },
          run_time: "2024-01-01T00:00:00Z",
        }),
      });
    });

    await page.route("**/api/backtest/chart/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          symbol: "RELIANCE",
          candles: [],
          orb_zones: [],
          pivot_levels: [],
          trades: [],
          date_range: { start: "2024-01-01", end: "2024-01-31" },
          total_candles: 100,
          total_trades: 10,
        }),
      });
    });
  });

  test("should display results summary after backtest", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    // Mock backtest run endpoint (correct endpoint)
    await page.route("**/api/backtest/run**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              symbol: "RELIANCE",
              trades: 10,
              wins: 6,
              losses: 4,
              win_rate: 60,
              gross_pnl: 6000,
              total_costs: 1000,
              net_pnl: 5000,
              pf: 1.5,
              tp_exits: 5,
              sl_exits: 3,
              eod_exits: 2,
            },
          ],
          totals: {
            gross_pnl: 6000,
            total_costs: 1000,
            net_pnl: 5000,
            trades: 10,
            win_rate: 60,
          },
          run_time: "2024-01-01T00:00:00Z",
        }),
      });
    });

    // Select symbol
    const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
    await symbolSelect.click();
    await expect(page.locator(".mantine-MultiSelect-dropdown")).toBeVisible({ timeout: 5000 });
    await page.keyboard.type("RELIANCE", { delay: 50 });
    await page.waitForSelector(".mantine-MultiSelect-option", { timeout: 5000 });

    const options = page.locator(".mantine-MultiSelect-option");
    await options.first().waitFor({ state: "visible", timeout: 5000 });
    await options.first().click();

    // Wait for run button to be enabled and click
    const runBtn = page.locator('[data-testid="run-backtest-btn"]');
    await expect(runBtn).toBeEnabled({ timeout: 5000 });
    await runBtn.click();

    // Wait for results summary to appear
    try {
      await page.waitForSelector('[data-testid="results-summary"]', { timeout: 15000 });
    } catch (e) {
      const errorAlert = page.locator('[data-testid="backtest-error"]');
      if (await errorAlert.isVisible()) {
        const errorText = await errorAlert.textContent();
        throw new Error(`Backtest failed with error: ${errorText}`);
      }
      throw e;
    }
    await expect(page.locator('[data-testid="results-summary"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="backtest-error"]')).not.toBeVisible({ timeout: 3000 });
  });
});
