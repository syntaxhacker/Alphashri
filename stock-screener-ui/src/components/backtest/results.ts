/**
 * Results Table Component
 *
 * Displays backtest results in a compact table for the left panel.
 * Supports sorting by clicking column headers.
 */

import {
  getBacktestState,
  setSelectedChartSymbol,
  setShowCharts,
  setTradeHistory,
  triggerRerender,
} from "../../state/backtest";
import { fetchChartData } from "../../api/backtest";
import { chartTradesToTrades } from "../../api/chartBuilder";
import type { BacktestResult, BacktestTotals } from "../../types/backtest";

// Sort state
let sortColumn: string = "net_pnl";
let sortDirection: "asc" | "desc" = "desc";

export function renderResults(): string {
  const state = getBacktestState();

  if (state.isRunning) {
    return renderProgress(state.progress);
  }

  if (!state.results || state.results.length === 0) {
    return `
      <div class="results-empty" data-testid="results-empty">
        <p>No results yet. Run a backtest.</p>
      </div>
    `;
  }

  // Sort results
  const sortedResults = sortResults([...state.results], sortColumn, sortDirection);

  return `
    <div class="results-container" data-testid="results-container">
      ${renderSummaryCompact(state.totals)}

      <div class="results-table-wrapper" data-testid="results-table-wrapper">
        <table class="results-table sortable" data-testid="results-table">
          <thead>
            <tr>
              <th class="sortable ${sortColumn === "symbol" ? "sorted " + sortDirection : ""}"
                  data-testid="th-symbol"
                  onclick="window.sortResults('symbol')">
                Symbol ${sortColumn === "symbol" ? (sortDirection === "asc" ? "▲" : "▼") : ""}
              </th>
              <th class="sortable ${sortColumn === "net_pnl" ? "sorted " + sortDirection : ""}"
                  data-testid="th-net-pnl"
                  onclick="window.sortResults('net_pnl')">
                Net PnL ${sortColumn === "net_pnl" ? (sortDirection === "asc" ? "▲" : "▼") : ""}
              </th>
              <th class="sortable ${sortColumn === "trades" ? "sorted " + sortDirection : ""}"
                  data-testid="th-trades"
                  onclick="window.sortResults('trades')">
                Trades ${sortColumn === "trades" ? (sortDirection === "asc" ? "▲" : "▼") : ""}
              </th>
              <th class="sortable ${sortColumn === "win_rate" ? "sorted " + sortDirection : ""}"
                  data-testid="th-win-rate"
                  onclick="window.sortResults('win_rate')">
                WR% ${sortColumn === "win_rate" ? (sortDirection === "asc" ? "▲" : "▼") : ""}
              </th>
              <th class="sortable ${sortColumn === "pf" ? "sorted " + sortDirection : ""}"
                  data-testid="th-pf"
                  onclick="window.sortResults('pf')">
                PF ${sortColumn === "pf" ? (sortDirection === "asc" ? "▲" : "▼") : ""}
              </th>
              <th data-testid="th-tp-sl">TP/SL</th>
            </tr>
          </thead>
          <tbody data-testid="results-tbody">
            ${sortedResults.map((r) => renderResultRow(r)).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function sortResults(
  results: BacktestResult[],
  column: string,
  direction: "asc" | "desc",
): BacktestResult[] {
  return results.sort((a, b) => {
    let aVal: number | string = 0;
    let bVal: number | string = 0;

    switch (column) {
      case "symbol":
        aVal = a.symbol;
        bVal = b.symbol;
        break;
      case "net_pnl":
        aVal = a.net_pnl;
        bVal = b.net_pnl;
        break;
      case "trades":
        aVal = a.trades;
        bVal = b.trades;
        break;
      case "win_rate":
        aVal = a.win_rate;
        bVal = b.win_rate;
        break;
      case "pf":
        aVal = a.pf;
        bVal = b.pf;
        break;
      default:
        return 0;
    }

    if (typeof aVal === "string" && typeof bVal === "string") {
      return direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }

    return direction === "asc"
      ? (aVal as number) - (bVal as number)
      : (bVal as number) - (aVal as number);
  });
}

function renderSummaryCompact(totals: BacktestTotals | null): string {
  if (!totals) return "";

  const pnlClass = totals.net_pnl >= 0 ? "positive" : "negative";
  const pnlSign = totals.net_pnl >= 0 ? "+" : "";

  return `
    <div class="results-summary-compact" data-testid="results-summary">
      <div class="summary-row">
        <span class="summary-item" data-testid="summary-net-pnl">
          <span class="label">Net PnL</span>
          <span class="value ${pnlClass}">${pnlSign}₹${(totals.net_pnl / 1000).toFixed(1)}K</span>
        </span>
        <span class="summary-item" data-testid="summary-costs">
          <span class="label">Costs</span>
          <span class="value negative">₹${(totals.total_costs / 1000).toFixed(1)}K</span>
        </span>
        <span class="summary-item" data-testid="summary-wr">
          <span class="label">WR</span>
          <span class="value">${totals.win_rate.toFixed(0)}%</span>
        </span>
        <span class="summary-item" data-testid="summary-trades">
          <span class="label">Trades</span>
          <span class="value">${totals.trades}</span>
        </span>
      </div>
    </div>
  `;
}

function renderResultRow(result: BacktestResult): string {
  const pnlClass = result.net_pnl >= 0 ? "positive" : "negative";
  const wrClass =
    result.win_rate >= 50 ? "positive" : result.win_rate >= 40 ? "neutral" : "negative";
  const isSelected = getBacktestState().selectedChartSymbol === result.symbol;

  return `
    <tr class="result-row ${isSelected ? "selected" : ""}"
        data-testid="result-row-${result.symbol}"
        data-symbol="${result.symbol}"
        onclick="window.viewChartAndTrades('${result.symbol}')"
        style="cursor:pointer">
      <td class="symbol-cell" data-testid="symbol-${result.symbol}">${result.symbol}</td>
      <td class="pnl-cell ${pnlClass}" data-testid="net-pnl-${result.symbol}">
        ${result.net_pnl >= 0 ? "+" : ""}₹${(result.net_pnl / 1000).toFixed(1)}K
      </td>
      <td class="trades-cell" data-testid="trades-${result.symbol}">${result.trades}</td>
      <td class="wr-cell ${wrClass}" data-testid="wr-${result.symbol}">${result.win_rate.toFixed(0)}%</td>
      <td class="pf-cell" data-testid="pf-${result.symbol}">${result.pf.toFixed(1)}</td>
      <td class="tpsl-cell">
        <span class="tp positive">${result.tp_exits}</span>/<span class="sl negative">${result.sl_exits}</span>
      </td>
    </tr>
  `;
}

function renderProgress(progress: { current: number; total: number; message: string }): string {
  const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  return `
    <div class="progress-container" data-testid="progress-container">
      <div class="progress-header">
        <span>Running...</span>
        <span data-testid="progress-counter">${progress.current}/${progress.total}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" data-testid="progress-fill" style="width: ${percent}%"></div>
      </div>
      <div class="progress-message" data-testid="progress-message">${progress.message}</div>
    </div>
  `;
}

// Register window handlers
export function initResultsHandlers() {
  console.log("initResultsHandlers called");

  (window as any).viewChartAndTrades = (symbol: string) => {
    console.log("viewChartAndTrades called for:", symbol);

    // Show charts and select symbol
    setShowCharts(true);
    setSelectedChartSymbol(symbol);

    // Check if chart data already exists
    const state = getBacktestState();
    const chartData = state.chartData.get(symbol);

    if (chartData && chartData.trades && chartData.trades.length > 0) {
      // Data already loaded, just set trade history
      console.log("Chart data exists, setting trade history");
      const trades = chartTradesToTrades(chartData.trades);
      setTradeHistory(trades, symbol);
    } else {
      // Load chart data (which will also trigger re-render)
      console.log("Fetching chart data");
      fetchChartData(symbol);
    }
  };

  (window as any).sortResults = (column: string) => {
    if (sortColumn === column) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortColumn = column;
      sortDirection = "desc";
    }
    triggerRerender();
  };

  (window as any).exportResultsCSV = () => {
    const state = getBacktestState();
    if (!state.results) return;

    const headers = [
      "Symbol",
      "Net PnL",
      "Gross PnL",
      "Costs",
      "Trades",
      "Win Rate",
      "PF",
      "TP",
      "SL",
    ];
    const rows = state.results.map((r) => [
      r.symbol,
      r.net_pnl,
      r.gross_pnl,
      r.total_costs,
      r.trades,
      r.win_rate,
      r.pf,
      r.tp_exits,
      r.sl_exits,
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtest-results-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
}
