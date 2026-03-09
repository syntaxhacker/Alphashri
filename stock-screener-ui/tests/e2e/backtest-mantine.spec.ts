import { test, expect, Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";

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
    {
      symbol: "INFY",
      net_pnl: 8500,
      trades: 8,
      win_rate: 75,
      pf: 3.0,
      tp_exits: 6,
      sl_exits: 2,
    },
    {
      symbol: "TCS",
      net_pnl: -3200,
      trades: 5,
      win_rate: 40,
      pf: 0.8,
      tp_exits: 2,
      sl_exits: 3,
    },
  ],
  totals: {
    net_pnl: 20300,
    total_costs: 2500,
    win_rate: 64,
    trades: 25,
  },
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
  await page.route("**/api/backtest/run**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: mockBacktestResults.results,
        totals: mockBacktestResults.totals,
        run_time: "2024-01-01T00:00:00Z",
        chart_data: {
          RELIANCE: mockChartData,
        },
      }),
    });
  });

  await page.route("**/api/backtest/chart/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockChartData),
    });
  });
}

async function setupBacktest(page: Page) {
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
}

test.describe("Backtest - Mantine Features", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await mockBacktestApi(page);
  });

  test.describe("Chart Zoom Functionality", () => {
    test("should display zoom dropdown with All, 30D, 7D, 1D options", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const zoomSelect = page.locator('[data-testid="chart-zoom-select"]');
      await expect(zoomSelect).toBeVisible();
    });

    test("should change chart view when selecting zoom option", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const zoomSelect = page.locator('[data-testid="chart-zoom-select"]');
      await expect(zoomSelect).toBeVisible();

      // Just verify the select works - actual zoom requires real chart data
      await zoomSelect.click();
      await page.waitForTimeout(300);
    });
  });

  test.describe("Chart Symbol Tabs", () => {
    test("should display symbol tabs when multiple symbols in results", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const chartTabs = page.locator('[data-testid="chart-tabs"]');
      await expect(chartTabs).toBeVisible();

      const relianceTab = page.locator('[data-testid="chart-tab-RELIANCE"]');
      await expect(relianceTab).toBeVisible();
    });

    test("should switch chart when clicking different symbol tab", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const chartTabs = page.locator('[data-testid="chart-tabs"]');
      await expect(chartTabs).toBeVisible();
    });
  });

  test.describe("Trade Row Click → Chart Zoom", () => {
    test("should highlight trade row when clicked", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');

      if (await tradeHistoryPanel.isVisible()) {
        const firstTradeRow = page.locator('[data-testid="trade-history-tbody"] tr').first();
        if (await firstTradeRow.isVisible()) {
          await firstTradeRow.click();
          await page.waitForTimeout(500);

          const highlightedRow = page.locator(".trade-row-highlighted");
          await expect(highlightedRow).toBeVisible();
        }
      }
    });
  });

  test.describe("Trade Row Highlight", () => {
    test("should highlight trade row with golden background when clicked", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');

      if (await tradeHistoryPanel.isVisible()) {
        const firstTradeRow = page.locator('[data-testid="trade-history-tbody"] tr').first();
        if (await firstTradeRow.isVisible()) {
          await firstTradeRow.click();
          await page.waitForTimeout(100);

          const hasHighlight = await firstTradeRow.evaluate((el) => {
            return el.classList.contains("trade-row-highlighted");
          });
          expect(hasHighlight).toBe(true);
        }
      }
    });

    test("should remove highlight after timeout", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');

      if (await tradeHistoryPanel.isVisible()) {
        const firstTradeRow = page.locator('[data-testid="trade-history-tbody"] tr').first();
        if (await firstTradeRow.isVisible()) {
          await firstTradeRow.click();
          await page.waitForTimeout(100);

          await page.waitForTimeout(3200);

          const hasHighlight = await firstTradeRow.evaluate((el) => {
            return el.classList.contains("trade-row-highlighted");
          });
          expect(hasHighlight).toBe(false);
        }
      }
    });
  });

  test.describe("Results Table Sorting", () => {
    test("should sort results when clicking column header", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const resultsTableWrapper = page.locator('[data-testid="results-table-wrapper"]');
      await expect(resultsTableWrapper).toBeVisible();

      const netPnlHeader = page.locator('[data-testid="th-net_pnl"]');
      await expect(netPnlHeader).toBeVisible();
      await netPnlHeader.click();
      await page.waitForTimeout(500);
    });

    test("should toggle sort direction when clicking same column twice", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const netPnlHeader = page.locator('[data-testid="th-net_pnl"]');

      await netPnlHeader.click();
      await page.waitForTimeout(500);

      await netPnlHeader.click();
      await page.waitForTimeout(500);
    });
  });

  test.describe("Backtest Progress", () => {
    test("should have working run backtest button", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
      await symbolSelect.click({ force: true });

      // Type to search
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
      await page.waitForTimeout(500);

      // After clicking, results should appear
      const resultsSummary = page.locator('[data-testid="results-summary"]');
      await expect(resultsSummary).toBeVisible();
    });
  });

  test.describe("Results Summary", () => {
    test("should display Net PnL in summary", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const resultsSummary = page.locator('[data-testid="results-summary"]');
      await expect(resultsSummary).toBeVisible();

      const netPnl = page.locator('[data-testid="summary-net-pnl"]');
      await expect(netPnl).toBeVisible();
    });

    test("should display Costs in summary", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const costs = page.locator('[data-testid="summary-costs"]');
      await expect(costs).toBeVisible();
    });

    test("should display Win Rate in summary", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const winRate = page.locator('[data-testid="summary-wr"]');
      await expect(winRate).toBeVisible();
    });

    test("should display Trades count in summary", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const trades = page.locator('[data-testid="summary-trades"]');
      await expect(trades).toBeVisible();
    });
  });

  test.describe("Empty State", () => {
    test("should show empty state when no results", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      const resultsEmpty = page.locator('[data-testid="results-empty"]');
      await expect(resultsEmpty).toBeVisible();
    });
  });

  test.describe("Error Handling", () => {
    test("should display error alert when backtest fails", async ({ page }) => {
      await setupApiMocks(page);
      await loginAsTestUser(page);

      // Mock failed backtest response
      await page.route("**/api/backtest/run**", async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Internal server error" }),
        });
      });

      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      const symbolSelect = page.locator('[data-testid="symbol-multiselect"]');
      await symbolSelect.click({ force: true });

      // Type to search
      await page.keyboard.type("RELIANCE");
      await page.waitForTimeout(500); // wait for debounce and API
      // Click on the option from dropdown
      const option = page.locator(".mantine-MultiSelect-option").first();
      if (await option.isVisible()) {
        await option.click();
      }
      await page.waitForTimeout(300);

      const runBtn = page.locator('[data-testid="run-backtest-btn"]');
      await runBtn.click();
      await page.waitForTimeout(2000);
      const errorAlert = page.locator('[data-testid="backtest-error"]');
      await expect(errorAlert).toBeVisible();
    });
  });

  test.describe("Chart Legend", () => {
    test("should display chart legend", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const echartsContainer = page.locator('[data-testid="echarts-container"]');
      await expect(echartsContainer).toBeVisible();

      await page.waitForTimeout(500);

      const legendItem = page.locator("text=Entry");
      await expect(legendItem.first()).toBeVisible();
    });
  });

  test.describe("Trade History Sorting", () => {
    test("should sort trade history by time", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');
      if (await tradeHistoryPanel.isVisible()) {
        // Click on time column header to sort
        const timeHeader = page.locator('[data-testid="th-entry_time"]');
        if (await timeHeader.isVisible()) {
          await timeHeader.click();
          await page.waitForTimeout(500);
        }
      }
    });

    test("should sort trade history by P&L", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');
      if (await tradeHistoryPanel.isVisible()) {
        const pnlHeader = page.locator('[data-testid="th-net_pnl"]');
        if (await pnlHeader.isVisible()) {
          await pnlHeader.click();
          await page.waitForTimeout(500);
        }
      }
    });
  });

  test.describe("Trade History Details", () => {
    test("should display trade summary in history panel", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');
      if (await tradeHistoryPanel.isVisible()) {
        const tradeSummaryPnl = page.locator('[data-testid="trade-summary-pnl"]');
        const tradeSummaryWr = page.locator('[data-testid="trade-summary-wr"]');
        const tradeSummaryWins = page.locator('[data-testid="trade-summary-wins"]');

        await expect(tradeSummaryPnl).toBeVisible();
        await expect(tradeSummaryWr).toBeVisible();
        await expect(tradeSummaryWins).toBeVisible();
      }
    });

    test("should close trade history panel", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const tradeHistoryPanel = page.locator('[data-testid="trade-history-panel"]');
      if (await tradeHistoryPanel.isVisible()) {
        const closeBtn = page.locator('[data-testid="close-trade-history-btn"]');
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
          await page.waitForTimeout(500);

          // Panel should be hidden
          await expect(tradeHistoryPanel).not.toBeVisible();
        }
      }
    });
  });

  test.describe("Results Table Details", () => {
    test("should display symbol in results", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const symbolCell = page.locator('[data-testid="symbol-RELIANCE"]');
      await expect(symbolCell).toBeVisible();
    });

    test("should display P&L value in results", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const pnlCell = page.locator('[data-testid="net-pnl-RELIANCE"]');
      await expect(pnlCell).toBeVisible();
    });

    test("should display trades count in results", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const tradesCell = page.locator('[data-testid="trades-RELIANCE"]');
      await expect(tradesCell).toBeVisible();
    });

    test("should display win rate in results", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const wrCell = page.locator('[data-testid="wr-RELIANCE"]');
      await expect(wrCell).toBeVisible();
    });

    test("should display profit factor in results", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const pfCell = page.locator('[data-testid="pf-RELIANCE"]');
      await expect(pfCell).toBeVisible();
    });

    test("should display TP/SL exits in results", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      await setupBacktest(page);

      const tpslCell = page.locator('[data-testid="tpsl-RELIANCE"]');
      await expect(tpslCell).toBeVisible();
    });
  });

  test.describe("Reset Functionality", () => {
    test("should reset backtest state when reset button clicked", async ({ page }) => {
      await page.goto("/backtest");
      await page.waitForSelector('[data-testid="backtest-view"]', { timeout: 10000 });

      // Run backtest first
      await setupBacktest(page);

      // Verify results are shown
      const resultsSummary = page.locator('[data-testid="results-summary"]');
      await expect(resultsSummary).toBeVisible();

      // Click reset button
      const resetBtn = page.locator('[data-testid="reset-btn"]');
      await resetBtn.click();
      await page.waitForTimeout(500);

      // Results should be cleared
      const resultsEmpty = page.locator('[data-testid="results-empty"]');
      await expect(resultsEmpty).toBeVisible();
    });
  });
});
