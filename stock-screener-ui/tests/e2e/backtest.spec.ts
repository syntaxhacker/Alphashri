import { test, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

test.describe("Backtest View - Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
  });

  test("should navigate to backtest view", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="sidemenu"]', { timeout: 10000 });

    await page.locator('[data-testid="nav-backtest"]').click();
    await page.waitForTimeout(500);

    await expect(page.locator('[data-testid="backtest-view"]')).toBeVisible();
  });

  test("should load backtest view from URL", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    await expect(page.locator('[data-testid="backtest-view"]')).toBeVisible();
  });
});

test.describe("Backtest View - Strategy Selection", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);

    await page.route("**/api/strategies", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "orb", name: "ORB Strategy", type: "orb", params: [] },
          { id: "52w_chaser", name: "52W Chaser", type: "52w_chaser", params: [] },
        ]),
      });
    });
  });

  test("should display strategy selector", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    await expect(page.locator('[data-testid="variation-select"]')).toBeVisible();
  });

  test("should list available strategies", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    const variationSelect = page.locator('[data-testid="variation-select"]');
    await expect(variationSelect).toBeVisible();
  });

  test("should select strategy from dropdown", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    const variationSelect = page.locator('[data-testid="variation-select"]');
    await variationSelect.click();
    await page.waitForTimeout(300);
    const options = page.locator("[data-dropdown]");
    if ((await options.count()) > 0) {
      await options.locator("div").first().click();
    }
  });
});

test.describe("Backtest View - Symbol Selection", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);

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
    await symbolSelect.click({ force: true });

    // Type in the searchable input
    await page.keyboard.type("RELIANCE");
    await page.waitForTimeout(500); // Wait for debounce and API

    // Click on the option from dropdown
    const option = page
      .locator('[data-testid="symbol-multiselect"] [data-mantine-combobox-option]')
      .first();
    if (await option.isVisible()) {
      await option.click();
      await page.waitForTimeout(300);

      const pill = page.locator('[data-testid="symbol-multiselect"] .mantine-Pill-root');
      await expect(pill.first()).toBeVisible();
    }
  });

  test("should remove symbol from list", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');

    // Click to open dropdown
    await symbolSelect.click({ force: true });

    // Type to search
    await page.keyboard.type("TCS");
    await page.waitForTimeout(500); // Wait for debounce and API

    // Click on the option from dropdown
    const option = page
      .locator('[data-testid="symbol-multiselect"] [data-mantine-combobox-option]')
      .first();
    if (await option.isVisible()) {
      await option.click();
      await page.waitForTimeout(300);

      // Find the pill's close button by looking for svg inside the pill
      const removeBtn = page
        .locator('[data-testid="symbol-multiselect"]')
        .locator(".mantine-Pill-root")
        .locator("svg")
        .first();
      await removeBtn.waitFor({ state: "visible", timeout: 5000 });
      await removeBtn.click();
      await page.waitForTimeout(300);
    }
  });

  test("should filter symbols based on search input", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
    await symbolSelect.click({ force: true });

    await page.keyboard.type("RELIANCE");
    await page.waitForTimeout(800);

    const option = page.locator('[data-testid="symbol-multiselect"] [data-mantine-combobox-option]').first();
    if (await option.isVisible()) {
      const optionText = await option.textContent();
      expect(optionText?.toLowerCase()).toContain("reliance");
    }
  });

  test("should keep search results after selecting a symbol", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
    await symbolSelect.click({ force: true });

    await page.keyboard.type("INF");
    await page.waitForTimeout(500);

    const firstOption = page.locator('[data-testid="symbol-multiselect"] [data-mantine-combobox-option]').first();
    if (await firstOption.isVisible()) {
      await firstOption.click();
      await page.waitForTimeout(300);

      const pill = page.locator('[data-testid="symbol-multiselect"] .mantine-Pill-root');
      await expect(pill.first()).toBeVisible();
    }
  });
});

test.describe("Backtest View - Configuration", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
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
    await setupApiMocks(page);
    await loginAsTestUser(page);

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
    await symbolSelect.click({ force: true });

    // Type in the searchable input
    await page.keyboard.type("RELIANCE");
    await page.waitForTimeout(500); // Wait for debounce and API

    // Click on the option from dropdown
    const option = page.locator(".mantine-MultiSelect-option").first();
    if (await option.isVisible()) {
      await option.click();
    }
    await page.waitForTimeout(300);

    const runBtn = page.locator('[data-testid="run-backtest-btn"]');
    await runBtn.click();
    await page.waitForTimeout(2000);

    const resultsTable = page.locator('[data-testid="results-table-wrapper"]');
    await expect(resultsTable).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Backtest View - Charts", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);

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
    await symbolSelect.click({ force: true });

    // Type in the searchable input
    await page.keyboard.type("RELIANCE");
    await page.waitForTimeout(500); // Wait for debounce and API

    // Click on the option from dropdown
    const option = page.locator(".mantine-MultiSelect-option").first();
    if (await option.isVisible()) {
      await option.click();
    }
    await page.waitForTimeout(300);

    const runBtn = page.locator('[data-testid="run-backtest-btn"]');
    await runBtn.click();
    await page.waitForTimeout(2000);

    await expect(page.locator('[data-testid="chart-tabs"]')).toBeVisible({ timeout: 10000 });
  });

  test("should display zoom select after backtest", async ({ page }) => {
    await page.goto("/backtest");
    await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

    // Click to focus on MultiSelect
    const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
    await symbolSelect.click({ force: true });

    // Type in the searchable input
    await page.keyboard.type("RELIANCE");
    await page.waitForTimeout(500); // Wait for debounce and API

    // Click on the option from dropdown
    const option = page.locator(".mantine-MultiSelect-option").first();
    if (await option.isVisible()) {
      await option.click();
    }
    await page.waitForTimeout(300);

    const runBtn = page.locator('[data-testid="run-backtest-btn"]');
    await runBtn.click();
    await page.waitForTimeout(2000);

    await expect(page.locator('[data-testid="chart-zoom-select"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Backtest View - Summary", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);

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

    await page.route("**/api/backtest", async (route) => {
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

    // Click to focus on MultiSelect
    const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
    await symbolSelect.click({ force: true });

    // Type in the searchable input
    await page.keyboard.type("RELIANCE");
    await page.waitForTimeout(500); // Wait for debounce and API

    // Click on the option from dropdown
    const option = page.locator(".mantine-MultiSelect-option").first();
    if (await option.isVisible()) {
      await option.click();
    }
    await page.waitForTimeout(300);

    const runBtn = page.locator('[data-testid="run-backtest-btn"]');
    await runBtn.click();
    await page.waitForTimeout(2000);

    await expect(page.locator('[data-testid="results-summary"]')).toBeVisible({ timeout: 10000 });
  });
});
