import { Page, expect } from "@playwright/test";
import { setupApiMocks, loginAsTestUser, testUser } from "../../mocks/apiResponses";

export async function mockSymbolSearch(page: Page) {
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
}

export async function mockBacktestRun(page: Page) {
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
}

export async function mockBacktestChart(page: Page) {
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
}

export async function mockBacktestStrategies(page: Page) {
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

export async function setupFullBacktestMocks(page: Page) {
  await setupApiMocks(page);
  await loginAsTestUser(page);
  await mockBacktestStrategies(page);
  await mockSymbolSearch(page);
  await mockBacktestRun(page);
  await mockBacktestChart(page);
}

export async function gotoBacktest(page: Page) {
  await page.goto("/backtest");
  await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });
}

export async function selectSymbolAndRun(page: Page, symbol: string = "RELIANCE") {
  const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
  await symbolSelect.click();
  await expect(page.locator(".mantine-MultiSelect-dropdown")).toBeVisible({ timeout: 5000 });
  await page.keyboard.type(symbol, { delay: 50 });
  await page.waitForSelector(".mantine-MultiSelect-option", { timeout: 5000 });
  const option = page.locator(".mantine-MultiSelect-option").first();
  await option.waitFor({ state: "visible", timeout: 5000 });
  await option.click();
  const runBtn = page.locator('[data-testid="run-backtest-btn"]');
  await expect(runBtn).toBeEnabled({ timeout: 5000 });
  await runBtn.click();
}

export async function waitForBacktestResult(page: Page, testId: string = "results-table-wrapper") {
  try {
    await page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 15000 });
  } catch (e) {
    const errorAlert = page.locator('[data-testid="backtest-error"]');
    if (await errorAlert.isVisible()) {
      const errorText = await errorAlert.textContent();
      throw new Error(`Backtest failed with error: ${errorText}`);
    }
    throw e;
  }
  await expect(page.locator(`[data-testid="${testId}"]`)).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-testid="backtest-error"]')).not.toBeVisible({ timeout: 3000 });
}
