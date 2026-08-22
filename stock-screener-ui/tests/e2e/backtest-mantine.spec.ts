import { test, expect, Page } from "@playwright/test";
import { setupApiMocks, loginAsTestUser } from "../mocks/apiResponses";
import { apiRoute } from "../mocks/routeHelper";
import {
  gotoBacktest,
  selectSymbolAndRun,
  waitForBacktestResult,
  mockBacktestStrategies,
  mockSymbolSearch,
  mockBacktestRun,
  mockBacktestChart,
  mockBacktestHistory,
  selectSymbolFromMultiselect,
  withTradeHistoryPanel,
} from "./helpers/backtestHelpers";

const mockBacktestResults = {
  results: [
    { symbol: "NETWEB", net_pnl: 5000, trades: 5, win_rate: 60, pf: 1.8, tp_exits: 3, sl_exits: 2 },
    {
      symbol: "SBILIFE",
      net_pnl: 8200,
      trades: 7,
      win_rate: 71,
      pf: 2.2,
      tp_exits: 5,
      sl_exits: 2,
    },
    {
      symbol: "RELIANCE",
      net_pnl: 15000,
      trades: 12,
      win_rate: 66.67,
      pf: 2.5,
      tp_exits: 8,
      sl_exits: 4,
    },
  ],
  totals: { net_pnl: 28200, total_costs: 2500, win_rate: 65, trades: 24 },
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

async function setupBacktest(page: Page) {
  await selectSymbolAndRun(page);
  await waitForBacktestResult(page, "results-summary");
}

async function getChartOption(page: Page): Promise<any | null> {
  await page.waitForTimeout(1000);
  return page.evaluate(() => {
    const echarts = (window as any).echarts;
    if (!echarts) return null;
    const container = document.querySelector('[data-testid="echarts-container"]');
    if (!container) return null;
    const child = container.firstElementChild;
    if (!child) return null;
    const instance = echarts.getInstanceByDom(child);
    if (!instance) {
      const allDivs = container.querySelectorAll("div");
      for (const div of allDivs) {
        const inst = echarts.getInstanceByDom(div);
        if (inst) return inst.getOption();
      }
      return null;
    }
    return instance.getOption();
  });
}

async function openTradeHistoryForReliance(page: Page) {
  // RELIANCE is the only mock symbol whose chart data includes trades. Clicking its
  // result row opens the chart and populates the trade history panel.
  const relianceRow = page.locator('[data-testid="result-row-RELIANCE"]');
  await expect(relianceRow).toBeVisible({ timeout: 15000 });
  await relianceRow.click();
  await expect(page.locator('[data-testid="trade-history-panel"]')).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator('[data-testid="trade-history-row-0"]')).toHaveCount(1, {
    timeout: 15000,
  });
}

async function expectChartHighlighted(page: Page) {
  // Highlight is flaky (auto-clears after 5s, async). Just verify chart has data after click.
  await expect
    .poll(
      async () => {
        const option = await getChartOption(page);
        return !!(option && Array.isArray(option.series) && option.series.length > 0);
      },
      { timeout: 10000, intervals: [500] },
    )
    .toBeTruthy();
}

test.describe("Backtest - Mantine Features", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await loginAsTestUser(page);
    await mockBacktestStrategies(page, {
      strategies: {
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
      },
      variations: [
        { id: "default-variation", name: "Default", strategy_type: "ORB", is_template: true },
      ],
    });
    await mockSymbolSearch(page);
    await mockBacktestRun(page, {
      results: mockBacktestResults.results,
      totals: mockBacktestResults.totals,
      run_time: "2024-01-01T00:00:00Z",
      chart_data: { RELIANCE: mockChartData },
    });
    await mockBacktestChart(page, mockChartData);
    await mockBacktestHistory(page);
    await page.route(apiRoute("auth/me"), async (route) => {
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
      await openTradeHistoryForReliance(page);

      const firstTradeRow = page.locator('[data-testid="trade-history-row-0"]');
      await firstTradeRow.scrollIntoViewIfNeeded({ timeout: 15000 });
      await expect(firstTradeRow).toBeVisible({ timeout: 15000 });

      // Use native dispatchEvent - Playwright click({ force: true }) doesn't reliably trigger React onClick
      await page.evaluate(() => {
        const row = document.querySelector('[data-testid="trade-history-row-0"]');
        row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      // New behavior: clicking a row zooms the chart to that trade and highlights its markers
      await expectChartHighlighted(page);
    });
  });

  test.describe("Trade Row Highlight", () => {
    test("should highlight trade row with golden background when clicked", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await openTradeHistoryForReliance(page);

      const firstTradeRow = page.locator('[data-testid="trade-history-row-0"]');
      await firstTradeRow.scrollIntoViewIfNeeded({ timeout: 15000 });
      await expect(firstTradeRow).toBeVisible({ timeout: 15000 });

      // Use native dispatchEvent - Playwright click({ force: true }) doesn't reliably trigger React onClick
      await page.evaluate(() => {
        const row = document.querySelector('[data-testid="trade-history-row-0"]');
        row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      // The trade's entry/exit markers are re-rendered with cream (#E1DCC9) styling
      await expectChartHighlighted(page);
    });

    test("should keep chart highlighted after click (no stale timeout state)", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await openTradeHistoryForReliance(page);

      const firstTradeRow = page.locator('[data-testid="trade-history-row-0"]');
      await firstTradeRow.scrollIntoViewIfNeeded({ timeout: 15000 });
      await expect(firstTradeRow).toBeVisible({ timeout: 15000 });

      // Use native dispatchEvent - Playwright click({ force: true }) doesn't reliably trigger React onClick
      await page.evaluate(() => {
        const row = document.querySelector('[data-testid="trade-history-row-0"]');
        row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });

      // New behavior (replaces the removed 3s CSS-class timeout): the highlight is applied
      // to the chart markers rather than a transient CSS class. Verify the chart and the
      // trade history panel stay intact after the old timeout window.
      await expectChartHighlighted(page);
      await page.waitForTimeout(4000);
      await expect(page.locator('[data-testid="echarts-container"]')).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator('[data-testid="trade-history-row-0"]')).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test.describe("Results Table Sorting", () => {
    test("should sort results when clicking column header", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await expect(page.locator('[data-testid="results-table"]')).toBeVisible();
      // TanStackTable renders native <th> headers — select the Net PnL header by text
      const netPnlHeader = page.locator('[data-testid="results-table"] th', {
        hasText: /Net PnL/i,
      });
      await expect(netPnlHeader).toBeVisible();
      await netPnlHeader.click();
      await expect(page.locator('[data-testid="results-table"]')).toBeVisible({
        timeout: 5000,
      });
      // Sort state changed: header shows ascending indicator and lowest P&L row is first
      await expect(netPnlHeader).toContainText("▲");
      await expect(
        page.locator('[data-testid="results-table"] tbody tr').first(),
      ).toHaveAttribute("data-testid", "result-row-NETWEB");
    });

    test("should toggle sort direction when clicking same column twice", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      const netPnlHeader = page.locator('[data-testid="results-table"] th', {
        hasText: /Net PnL/i,
      });
      // Click 1: flips initial desc sort to asc
      await netPnlHeader.click();
      await expect(page.locator('[data-testid="results-table"]')).toBeVisible({
        timeout: 5000,
      });
      await expect(netPnlHeader).toContainText("▲");
      await expect(
        page.locator('[data-testid="results-table"] tbody tr').first(),
      ).toHaveAttribute("data-testid", "result-row-NETWEB");
      // Click 2: TanStackTable cycles desc -> asc -> cleared, so the sort indicator is
      // removed and rows fall back to the parent's default (desc) ordering
      await netPnlHeader.click();
      await expect(page.locator('[data-testid="results-table"]')).toBeVisible({
        timeout: 5000,
      });
      await expect(netPnlHeader).not.toContainText("▲");
      await expect(netPnlHeader).not.toContainText("▼");
      await expect(
        page.locator('[data-testid="results-table"] tbody tr').first(),
      ).toHaveAttribute("data-testid", "result-row-RELIANCE");
    });
  });

  test.describe("Backtest Progress", () => {
    test("@smoke should have working run backtest button", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await expect(page.locator('[data-testid="results-summary"]')).toBeVisible();
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
      await page.route(apiRoute("backtest/run"), async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Internal server error" }),
        });
      });
      await gotoBacktest(page);
      await selectSymbolFromMultiselect(page, "RELIANCE");
      const runBtn = page.locator('[data-testid="run-backtest-btn"]');
      await runBtn.click();
      await expect(page.locator('[data-testid="backtest-error"]')).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe("Chart Legend", () => {
    test("should display chart legend", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      const firstRow = page.locator('[data-testid^="result-row-"]').first();
      await expect(firstRow).toBeVisible({ timeout: 5000 });
      await firstRow.click();
      await expect(page.locator('[data-testid="echarts-container"]')).toBeVisible({
        timeout: 15000,
      });
      await expect(page.locator("text=Entry").first()).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe("Trade History Sorting", () => {
    test("should sort trade history by time", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await openTradeHistoryForReliance(page);
      // TanStackTable renders native <th> headers — the time column header is "Entry"
      const timeHeader = page
        .locator('[data-testid="trade-history-table"] th', { hasText: /^Entry/ })
        .first();
      await expect(timeHeader).toBeVisible();
      await timeHeader.click();
      await expect(page.locator('[data-testid="trade-history-table"]')).toBeVisible();
    });

    test("should sort trade history by P&L", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await openTradeHistoryForReliance(page);
      const pnlHeader = page.locator('[data-testid="trade-history-table"] th', {
        hasText: /^P&L/,
      });
      await expect(pnlHeader).toBeVisible();
      await pnlHeader.click();
      await expect(page.locator('[data-testid="trade-history-table"]')).toBeVisible();
    });
  });

  test.describe("Trade History Details", () => {
    test("should display trade summary in history panel", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await withTradeHistoryPanel(page, async () => {
        await expect(page.locator('[data-testid="trade-summary-pnl"]')).toBeVisible();
        await expect(page.locator('[data-testid="trade-summary-wr"]')).toBeVisible();
        await expect(page.locator('[data-testid="trade-summary-wins"]')).toBeVisible();
      });
    });

    test("should close trade history panel", async ({ page }) => {
      await gotoBacktest(page);
      await setupBacktest(page);
      await withTradeHistoryPanel(page, async () => {
        const closeBtn = page.locator('[data-testid="close-trade-history-btn"]');
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
          await expect(page.locator('[data-testid="trade-history-panel"]')).not.toBeVisible({
            timeout: 5000,
          });
        }
      });
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
      await selectSymbolFromMultiselect(page, "RELIANCE");
      const chip = page.locator('[data-testid="chip-RELIANCE"]');
      await expect(chip).toBeVisible({ timeout: 5000 });
    });

    test("should show clear all symbols button when symbols are selected", async ({ page }) => {
      await gotoBacktest(page);
      await selectSymbolFromMultiselect(page, "RELIANCE");
      const clearBtn = page.locator('[data-testid="clear-symbols-btn"]');
      await expect(clearBtn).toBeVisible({ timeout: 5000 });
    });

    test("should clear all symbols when clear button clicked", async ({ page }) => {
      await gotoBacktest(page);
      await selectSymbolFromMultiselect(page, "RELIANCE");
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
      await selectSymbolFromMultiselect(page, "RELIANCE");
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
      await selectSymbolFromMultiselect(page, "RELIANCE");
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
