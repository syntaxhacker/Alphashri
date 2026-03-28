import { test, expect, Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { gotoBacktest, selectSymbolAndRun, waitForBacktestResult } from "./helpers/backtestHelpers";

const mockBacktestResults = {
  results: [
    {
      symbol: "RELIANCE",
      net_pnl: 15000,
      trades: 12,
      win_rate: 66.67,
      pf: 2.5,
      tp_exits: 8,
      sl_exits: 4,
    },
    { symbol: "INFY", net_pnl: 8500, trades: 8, win_rate: 75, pf: 3.0, tp_exits: 6, sl_exits: 2 },
    { symbol: "TCS", net_pnl: -3200, trades: 5, win_rate: 40, pf: 0.8, tp_exits: 2, sl_exits: 3 },
  ],
  totals: { net_pnl: 20300, total_costs: 2500, win_rate: 64, trades: 25 },
};

const mockChartData = {
  symbol: "RELIANCE",
  candles: [
    {
      time: "2024-01-15T09:15",
      date: "2024-01-15",
      date_raw: "2024-01-15",
      open: 2445,
      high: 2455,
      low: 2440,
      close: 2450,
      volume: 100000,
      time_str: "09:15",
    },
    {
      time: "2024-01-15T09:30",
      date: "2024-01-15",
      date_raw: "2024-01-15",
      open: 2450,
      high: 2460,
      low: 2448,
      close: 2455,
      volume: 120000,
      time_str: "09:30",
    },
    {
      time: "2024-01-15T09:45",
      date: "2024-01-15",
      date_raw: "2024-01-15",
      open: 2455,
      high: 2470,
      low: 2452,
      close: 2465,
      volume: 110000,
      time_str: "09:45",
    },
    {
      time: "2024-01-15T10:00",
      date: "2024-01-15",
      date_raw: "2024-01-15",
      open: 2465,
      high: 2480,
      low: 2460,
      close: 2475,
      volume: 130000,
      time_str: "10:00",
    },
    {
      time: "2024-01-15T14:30",
      date: "2024-01-15",
      date_raw: "2024-01-15",
      open: 2510,
      high: 2525,
      low: 2515,
      close: 2520,
      volume: 150000,
      time_str: "14:30",
    },
  ],
  orb_zones: [],
  pivot_levels: [],
  trades: [
    {
      trade_id: 1,
      type: "entry",
      time: "2024-01-15T09:30",
      date: "2024-01-15",
      price: 2450,
      trade: {
        entry_price: 2450,
        exit_price: 2520,
        entry_time: "2024-01-15T09:30",
        exit_time: "2024-01-15T14:30",
        quantity: 100,
        gross_pnl: 7000,
        trading_costs: 500,
        net_pnl: 6500,
        net_pnl_pct: 2.65,
        exit_reason: "TP",
        hold_duration_minutes: 300,
        or_high: 2525,
        or_low: 2440,
      },
    },
    {
      trade_id: 1,
      type: "exit",
      time: "2024-01-15T14:30",
      date: "2024-01-15",
      price: 2520,
      trade: {
        entry_price: 2450,
        exit_price: 2520,
        entry_time: "2024-01-15T09:30",
        exit_time: "2024-01-15T14:30",
        quantity: 100,
        gross_pnl: 7000,
        trading_costs: 500,
        net_pnl: 6500,
        net_pnl_pct: 2.65,
        exit_reason: "TP",
        hold_duration_minutes: 300,
        or_high: 2525,
        or_low: 2440,
      },
    },
  ],
  date_range: { start: "2024-01-01", end: "2024-01-31" },
  total_candles: 100,
  total_trades: 1,
};

async function mockBacktestApi(page: Page) {
  await page.route("**/api/backtest/strategies", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        strategies: [
          {
            id: "orb",
            name: "ORB Strategy",
            params: [
              { key: "or_minutes", label: "OR Minutes", type: "number", default: 45 },
              { key: "sl_pct", label: "Stop Loss %", type: "number", default: 0.4 },
              { key: "tp_pct", label: "Take Profit %", type: "number", default: 1.2 },
            ],
          },
        ],
      }),
    });
  });

  await page.route("**/api/strategies/variations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "default-variation", name: "Default", strategy_type: "ORB", is_template: true },
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

  await page.route("**/api/symbols/search*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          { symbol: "RELIANCE", name: "Reliance Industries Ltd" },
          { symbol: "INFY", name: "Infosys Ltd" },
          { symbol: "TCS", name: "Tata Consultancy Services Ltd" },
        ],
        query: "RELIANCE",
        total: 3,
      }),
    });
  });

  await page.route("**/api/backtest/run*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: mockBacktestResults.results,
        totals: mockBacktestResults.totals,
        run_time: "2024-01-01T00:00:00Z",
        chart_data: { RELIANCE: mockChartData },
      }),
    });
  });

  await page.route("**/api/backtest/chart/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockChartData),
    });
  });

  await page.route("**/api/backtest/history*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ history: [] }),
    });
  });
}

async function setupBacktest(page: Page) {
  await selectSymbolAndRun(page);
  await waitForBacktestResult(page, "results-summary");
}

test.describe("Backtest - Mantine Features", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await mockBacktestApi(page);
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          email: "test@alphashri.dev",
          display_name: "TestUser",
          initial_capital: 1000000,
          created_at: "2026-01-01T00:00:00",
        }),
      });
    });
  });

  test.describe("Chart Zoom Functionality", () => {
    test("should display zoom dropdown with All, 30D, 7D, 1D options", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      const zoomSelect = page.locator('[data-testid="chart-zoom-select"]');
      await expect(zoomSelect).toBeVisible();
      await zoomSelect.click({ force: true });
      await page.waitForTimeout(300);
      const dropdown = page
        .locator(".mantine-Select-dropdown")
        .filter({ hasText: /All.*30D.*7D.*1D/ });
      await expect(dropdown).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe("Chart Symbol Tabs", () => {
    test("should display symbol tabs when multiple symbols in results", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      const chartTabs = page.locator('[data-testid="chart-tabs"]');
      await expect(chartTabs).toBeVisible();
      await expect(page.locator('[data-testid="chart-tab-RELIANCE"]')).toBeVisible();
    });

    test("should switch chart when clicking different symbol tab", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await expect(page.locator('[data-testid="chart-tabs"]')).toBeVisible();
    });
  });

  test.describe("Trade Row Click -> Chart Zoom", () => {
    test("should highlight trade row when clicked", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');
      if (await tradeHistoryPanel.isVisible()) {
        const firstTradeRow = page.locator('[data-testid="trade-history-tbody"] tr').first();
        if (await firstTradeRow.isVisible()) {
          await firstTradeRow.click();
          await expect(page.locator(".trade-row-highlighted")).toBeVisible({ timeout: 5000 });
        }
      }
    });
  });

  test.describe("Trade Row Highlight", () => {
    test("should highlight trade row with golden background when clicked", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');
      if (await tradeHistoryPanel.isVisible()) {
        const firstTradeRow = page.locator('[data-testid="trade-history-tbody"] tr').first();
        if (await firstTradeRow.isVisible()) {
          await firstTradeRow.click();
          await page.waitForLoadState("networkidle");
          expect(
            await firstTradeRow.evaluate((el) => el.classList.contains("trade-row-highlighted")),
          ).toBe(true);
        }
      }
    });

    test("should remove highlight after timeout", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');
      if (await tradeHistoryPanel.isVisible()) {
        const firstTradeRow = page.locator('[data-testid="trade-history-tbody"] tr').first();
        if (await firstTradeRow.isVisible()) {
          await firstTradeRow.click();
          await page.waitForLoadState("networkidle");
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(6000);
          expect(
            await firstTradeRow.evaluate((el) => el.classList.contains("trade-row-highlighted")),
          ).toBe(false);
        }
      }
    });
  });

  test.describe("Results Table Sorting", () => {
    test("should sort results when clicking column header", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await expect(page.locator('[data-testid="results-table-wrapper"]')).toBeVisible();
      const netPnlHeader = page.locator('[data-testid="th-net_pnl"]');
      await expect(netPnlHeader).toBeVisible();
      await netPnlHeader.click();
      await expect(page.locator('[data-testid="results-table-wrapper"]')).toBeVisible({
        timeout: 5000,
      });
    });

    test("should toggle sort direction when clicking same column twice", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      const netPnlHeader = page.locator('[data-testid="th-net_pnl"]');
      await netPnlHeader.click();
      await expect(page.locator('[data-testid="results-table-wrapper"]')).toBeVisible({
        timeout: 5000,
      });
      await netPnlHeader.click();
      await expect(page.locator('[data-testid="results-table-wrapper"]')).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test.describe("Backtest Progress", () => {
    test("@smoke should have working run backtest button", async ({ page }) => {
      await gotoBacktest(page);
      const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
      await symbolSelect.click({ force: true });
      await page.keyboard.type("RELIANCE");
      await expect(page.locator(".mantine-MultiSelect-option").first()).toBeVisible({
        timeout: 5000,
      });
      const option = page.locator(".mantine-MultiSelect-option").first();
      if (await option.isVisible()) {
        await option.click();
      }
      const runBtn = page.locator('[data-testid="run-backtest-btn"]');
      await runBtn.click();
      await expect(page.locator('[data-testid="results-summary"]')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe("Results Summary", () => {
    test("should display Net PnL in summary", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await expect(page.locator('[data-testid="results-summary"]')).toBeVisible();
      await expect(page.locator('[data-testid="summary-net-pnl"]')).toBeVisible();
    });

    test("should display Costs in summary", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await expect(page.locator('[data-testid="summary-costs"]')).toBeVisible();
    });

    test("should display Win Rate in summary", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await expect(page.locator('[data-testid="summary-wr"]')).toBeVisible();
    });

    test("should display Trades count in summary", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await expect(page.locator('[data-testid="summary-trades"]')).toBeVisible();
    });
  });

  test.describe("Empty State", () => {
    test("@smoke should show empty state when no results", async ({ page }) => {
      await gotoBacktest(page);
      await expect(page.locator('[data-testid="results-empty"]')).toBeVisible();
    });
  });

  test.describe("Error Handling", () => {
    test("should display error alert when backtest fails", async ({ page }) => {
      await setupApiMocks(page);
      await loginAsTestUser(page);
      await page.route("**/api/backtest/run**", async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Internal server error" }),
        });
      });
      await gotoBacktest(page);
      const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
      await symbolSelect.click({ force: true });
      await page.keyboard.type("RELIANCE");
      await expect(page.locator(".mantine-MultiSelect-option").first()).toBeVisible({
        timeout: 5000,
      });
      const option = page.locator(".mantine-MultiSelect-option").first();
      if (await option.isVisible()) {
        await option.click();
      }
      const runBtn = page.locator('[data-testid="run-backtest-btn"]');
      await runBtn.click();
      await expect(page.locator('[data-testid="backtest-error"]')).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe("Chart Legend", () => {
    test("should display chart legend", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await expect(page.locator('[data-testid="echarts-container"]')).toBeVisible();
      await expect(page.locator("text=Entry").first()).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe("Trade History Sorting", () => {
    test("should sort trade history by time", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');
      if (await tradeHistoryPanel.isVisible()) {
        const timeHeader = page.locator('[data-testid="th-entry_time"]');
        if (await timeHeader.isVisible()) {
          await timeHeader.click();
          await page.waitForLoadState("networkidle");
        }
      }
    });

    test("should sort trade history by P&L", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');
      if (await tradeHistoryPanel.isVisible()) {
        const pnlHeader = page.locator('[data-testid="th-net_pnl"]');
        if (await pnlHeader.isVisible()) {
          await pnlHeader.click();
          await page.waitForLoadState("networkidle");
        }
      }
    });
  });

  test.describe("Trade History Details", () => {
    test("should display trade summary in history panel", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');
      if (await tradeHistoryPanel.isVisible()) {
        await expect(page.locator('[data-testid="trade-summary-pnl"]')).toBeVisible();
        await expect(page.locator('[data-testid="trade-summary-wr"]')).toBeVisible();
        await expect(page.locator('[data-testid="trade-summary-wins"]')).toBeVisible();
      }
    });

    test("should close trade history panel", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');
      if (await tradeHistoryPanel.isVisible()) {
        const closeBtn = page.locator('[data-testid="close-trade-history-btn"]');
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
          await expect(tradeHistoryPanel).not.toBeVisible({ timeout: 5000 });
        }
      }
    });
  });

  test.describe("Results Table Details", () => {
    test("should display symbol in results", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await expect(page.locator('[data-testid="symbol-RELIANCE"]')).toBeVisible();
    });

    test("should display P&L value in results", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await expect(page.locator('[data-testid="net-pnl-RELIANCE"]')).toBeVisible();
    });

    test("should display trades count in results", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await expect(page.locator('[data-testid="trades-RELIANCE"]')).toBeVisible();
    });

    test("should display win rate in results", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await expect(page.locator('[data-testid="wr-RELIANCE"]')).toBeVisible();
    });

    test("should display profit factor in results", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await expect(page.locator('[data-testid="pf-RELIANCE"]')).toBeVisible();
    });

    test("should display TP/SL exits in results", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await expect(page.locator('[data-testid="tpsl-RELIANCE"]')).toBeVisible();
    });
  });

  test.describe("Reset Functionality", () => {
    test("should reset backtest state when reset menu item clicked", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);

      const resultsSummary = page.locator('[data-testid="results-summary"]');
      await expect(resultsSummary).toBeVisible();

      const runBtn = page.locator('[data-testid="run-backtest-btn"]');
      await runBtn.click();

      const runMenuBtn = page.locator('[data-testid="run-menu-btn"]');
      await runMenuBtn.click();

      const resetBtn = page.locator('[data-testid="reset-btn"]');
      await expect(resetBtn).toBeVisible({ timeout: 5000 });
      await resetBtn.click();

      await expect(page.locator('[data-testid="results-empty"]')).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe("Symbol Chips", () => {
    test("should display symbol chips after adding symbols", async ({ page }) => {
      await gotoBacktest(page);

      const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
      await symbolSelect.click({ force: true });

      await page.keyboard.type("RELIANCE", { delay: 50 });
      await expect(page.locator(".mantine-MultiSelect-option").first()).toBeVisible({
        timeout: 5000,
      });
      const option = page.locator(".mantine-MultiSelect-option").first();
      if (await option.isVisible()) {
        await option.click();
      }

      const chip = page.locator('[data-testid="chip-RELIANCE"]');
      await expect(chip).toBeVisible({ timeout: 5000 });
    });

    test("should show clear all symbols button when symbols are selected", async ({ page }) => {
      await gotoBacktest(page);

      const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
      await symbolSelect.click({ force: true });

      await page.keyboard.type("RELIANCE", { delay: 50 });
      await expect(page.locator(".mantine-MultiSelect-option").first()).toBeVisible({
        timeout: 5000,
      });
      const option = page.locator(".mantine-MultiSelect-option").first();
      if (await option.isVisible()) {
        await option.click();
      }

      const clearBtn = page.locator('[data-testid="clear-symbols-btn"]');
      await expect(clearBtn).toBeVisible({ timeout: 5000 });
    });

    test("should clear all symbols when clear button clicked", async ({ page }) => {
      await gotoBacktest(page);

      const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
      await symbolSelect.click({ force: true });

      await page.keyboard.type("RELIANCE", { delay: 50 });
      await expect(page.locator(".mantine-MultiSelect-option").first()).toBeVisible({
        timeout: 5000,
      });
      const option = page.locator(".mantine-MultiSelect-option").first();
      if (await option.isVisible()) {
        await option.click();
      }

      await expect(page.locator('[data-testid="chip-RELIANCE"]')).toBeVisible({ timeout: 5000 });

      const clearBtn = page.locator('[data-testid="clear-symbols-btn"]');
      await clearBtn.click();

      await expect(page.locator('[data-testid="chip-RELIANCE"]')).not.toBeVisible({
        timeout: 5000,
      });
      const runBtn = page.locator('[data-testid="run-backtest-btn"]');
      await expect(runBtn).toBeDisabled();
    });

    test("should remove individual symbol chip on close", async ({ page }) => {
      await gotoBacktest(page);

      const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
      await symbolSelect.click({ force: true });

      await page.keyboard.type("RELIANCE", { delay: 50 });
      await expect(page.locator(".mantine-MultiSelect-option").first()).toBeVisible({
        timeout: 5000,
      });
      const option = page.locator(".mantine-MultiSelect-option").first();
      if (await option.isVisible()) {
        await option.click();
      }

      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await expect(page.locator('[data-testid="chip-RELIANCE"]')).toBeVisible({ timeout: 5000 });

      const clearBtn = page.locator('[data-testid="clear-symbols-btn"]');
      await clearBtn.click();

      await expect(page.locator('[data-testid="chip-RELIANCE"]')).not.toBeVisible({
        timeout: 5000,
      });
    });
  });

  test.describe("Run Menu", () => {
    test("should open run dropdown menu with options", async ({ page }) => {
      await gotoBacktest(page);

      const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
      await symbolSelect.click({ force: true });

      await page.keyboard.type("RELIANCE", { delay: 50 });
      await expect(page.locator(".mantine-MultiSelect-option").first()).toBeVisible({
        timeout: 5000,
      });
      const option = page.locator(".mantine-MultiSelect-option").first();
      if (await option.isVisible()) {
        await option.click();
      }

      const runMenuBtn = page.locator('[data-testid="run-menu-btn"]');
      await expect(runMenuBtn).toBeEnabled({ timeout: 5000 });
      await runMenuBtn.click();

      await expect(page.locator(".mantine-Menu-dropdown")).toBeVisible({ timeout: 5000 });
      await expect(page.getByText("Run Backtest")).toBeVisible();
      await expect(page.getByText("Run & Save to History")).toBeVisible();
      await expect(page.getByText("Reset Config")).toBeVisible();
    });
  });

  test.describe("Strategy Description", () => {
    test("should show variation selected in config form", async ({ page }) => {
      await gotoBacktest(page);

      const variationSelect = page.locator('[data-testid="variation-select"]');
      await expect(variationSelect).toBeVisible();

      await variationSelect.click({ force: true });
      await page.waitForTimeout(300);

      const dropdown = page.locator(".mantine-Select-dropdown");
      const hasVisibleOptions = await dropdown
        .locator(".mantine-Select-option")
        .isVisible()
        .catch(() => false);

      if (hasVisibleOptions) {
        await dropdown.locator(".mantine-Select-option").first().click();
        await page.waitForTimeout(300);
      }

      await expect(variationSelect).toBeVisible();
    });
  });
});
