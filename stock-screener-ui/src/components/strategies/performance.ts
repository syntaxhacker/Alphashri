/**
 * Strategy Performance View Component
 *
 * Displays performance metrics for all strategies with comparison view.
 */

import type { StrategiesState, StrategyPerformance } from "../../types/strategies";
import { triggerRerender } from "../../state/strategies";
import { getStrategyTrades } from "../../api/strategies";
import { getPnLTextColor, formatNumber, formatTimeOnly } from "../../utils/ui-helpers";
import { PERF_POSITIVE, PERF_NEGATIVE } from "../../config/colors";

// Cache for strategy trades
let strategyTradesCache: Map<number, any[]> = new Map();
let selectedStrategyId: number | null = null;

export function renderPerformanceView(state: StrategiesState): string {
  const performances = state.allPerformance;

  if (performances.length === 0) {
    return `
      <div class="strategies-empty">
        <p>No strategy performance data available.</p>
        <p class="strategies-empty-hint">Trade history will appear here after trades are logged.</p>
      </div>
    `;
  }

  // Sort by net P&L descending
  const sortedPerformances = [...performances].sort((a, b) => b.net_pnl - a.net_pnl);

  // Calculate totals
  const totals = calculateTotals(performances);

  // Get selected strategy performance
  const selectedPerf = selectedStrategyId
    ? performances.find((p) => p.strategy_id === selectedStrategyId)
    : null;

  // Get trades for selected strategy
  const selectedTrades = selectedStrategyId
    ? strategyTradesCache.get(selectedStrategyId) || []
    : [];

  return `
    <div class="performance-view" data-testid="performance-view">
      <!-- Summary Cards -->
      <div class="performance-summary" data-testid="performance-summary">
        ${renderSummaryCard("Total Trades", totals.total_trades.toString(), "📊")}
        ${renderSummaryCard("Overall Win Rate", `${totals.win_rate.toFixed(1)}%`, totals.win_rate >= 50 ? "✅" : "⚠️", totals.win_rate >= 50 ? "positive" : "negative")}
        ${renderSummaryCard("Total P&L", formatCurrency(totals.total_pnl), totals.total_pnl >= 0 ? "📈" : "📉", totals.total_pnl >= 0 ? "positive" : "negative")}
        ${renderSummaryCard("Net P&L", formatCurrency(totals.net_pnl), totals.net_pnl >= 0 ? "💰" : "💸", totals.net_pnl >= 0 ? "positive" : "negative")}
      </div>

      ${
        selectedStrategyId && selectedPerf
          ? `
        <!-- Selected Strategy Detail -->
        <div class="strategy-detail-panel">
          <div class="strategy-detail-header">
            <button class="btn btn-secondary btn-small" onclick="window.clearSelectedStrategy()">← Back to Overview</button>
            <h3>${selectedPerf.strategy_name} <span class="strategy-id-badge">ID: ${selectedPerf.strategy_id}</span></h3>
          </div>
          <div class="strategy-detail-stats">
            ${renderSummaryCard("Trades", selectedPerf.total_trades.toString(), "📊")}
            ${renderSummaryCard("Win Rate", `${selectedPerf.win_rate.toFixed(1)}%`, selectedPerf.win_rate >= 50 ? "✅" : "⚠️", selectedPerf.win_rate >= 50 ? "positive" : "negative")}
            ${renderSummaryCard("Net P&L", formatCurrency(selectedPerf.net_pnl), selectedPerf.net_pnl >= 0 ? "💰" : "💸", selectedPerf.net_pnl >= 0 ? "positive" : "negative")}
          </div>
          ${renderStrategyTrades(selectedTrades, selectedPerf.strategy_name)}
        </div>
      `
          : `
        <!-- Performance Table -->
        <div class="performance-table-container" data-testid="performance-table-container">
          <h4 class="performance-section-title">Strategy Comparison (Click to view trades)</h4>
          <table class="performance-table" data-testid="performance-table">
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Trades</th>
                <th>Winners</th>
                <th>Losers</th>
                <th>Win Rate</th>
                <th>Total P&L</th>
                <th>Net P&L</th>
                <th>Performance</th>
              </tr>
            </thead>
            <tbody>
              ${sortedPerformances.map((p) => renderPerformanceRow(p)).join("")}
            </tbody>
          </table>
        </div>

        <!-- Performance Chart (Simple Bar) -->
        <div class="performance-chart-container" data-testid="performance-chart-container">
          <h4 class="performance-section-title">Net P&L by Strategy</h4>
          <div class="performance-bars" data-testid="performance-bars">
            ${sortedPerformances.map((p) => renderPerformanceBar(p, totals.maxAbsPnl)).join("")}
          </div>
        </div>
      `
      }
    </div>
  `;
}

function renderStrategyTrades(trades: any[], strategyName: string): string {
  if (trades.length === 0) {
    return `
      <div class="strategy-trades-empty">
        <p>No trades found for this strategy.</p>
      </div>
    `;
  }

  return `
    <div class="strategy-trades-section">
      <div class="strategy-trades-header">
        <h4>Recent Trades (${trades.length})</h4>
        <button class="btn btn-secondary btn-small" onclick="window.viewAllStrategyTrades('${strategyName}')">
          View in Trade History →
        </button>
      </div>
      <table class="strategy-trades-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>P&L</th>
            <th>Type</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          ${trades
            .slice(0, 20)
            .map((trade) => renderTradeRow(trade))
            .join("")}
        </tbody>
      </table>
      ${trades.length > 20 ? `<p class="trades-more">Showing 20 of ${trades.length} trades</p>` : ""}
    </div>
  `;
}

function renderTradeRow(trade: any): string {
  const pnlClass = getPnLTextColor(trade.net_pnl);
  const sideClass = trade.side === "BUY" ? "side-long" : "side-short";
  const sideIcon = trade.side === "BUY" ? "▲" : "▼";
  const _time = formatTimeOnly(trade.exit_time);

  return `
    <tr class="trade-row ${trade.net_pnl >= 0 ? "trade-win" : "trade-loss"}">
      <td class="symbol-cell"><strong>${trade.symbol}</strong></td>
      <td class="${sideClass}">${sideIcon}</td>
      <td>${trade.quantity}</td>
      <td>₹${trade.entry_price.toFixed(2)}</td>
      <td>₹${trade.exit_price.toFixed(2)}</td>
      <td class="${pnlClass}"><strong>₹${formatNumber(trade.net_pnl)}</strong></td>
      <td class="exit-${trade.exit_reason.toLowerCase()}">${trade.exit_reason}</td>
      <td class="time-cell">${formatTimeOnly(trade.entry_time)}</td>
    </tr>
  `;
}

function renderSummaryCard(
  label: string,
  value: string,
  icon: string,
  className: string = "",
): string {
  const testid = `perf-card-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
  return `
    <div class="performance-summary-card ${className}" data-testid="${testid}">
      <span class="summary-icon">${icon}</span>
      <div class="summary-content">
        <span class="summary-value">${value}</span>
        <span class="summary-label">${label}</span>
      </div>
    </div>
  `;
}

function renderPerformanceRow(perf: StrategyPerformance): string {
  const winRateClass = perf.win_rate >= 60 ? "good" : perf.win_rate >= 40 ? "average" : "poor";
  const pnlClass = getPnLTextColor(perf.net_pnl);

  return `
    <tr class="performance-row ${pnlClass} clickable" onclick="window.selectStrategyForDetail(${perf.strategy_id})" data-testid="performance-row" data-strategy-id="${perf.strategy_id}">
      <td class="strategy-name-cell">
        <span class="strategy-name">${perf.strategy_name}</span>
        <span class="strategy-id">ID: ${perf.strategy_id}</span>
      </td>
      <td>${perf.total_trades}</td>
      <td class="text-green">${perf.winners}</td>
      <td class="text-red">${perf.losers}</td>
      <td class="win-rate-${winRateClass}">${perf.win_rate.toFixed(1)}%</td>
      <td>${formatCurrency(perf.total_pnl)}</td>
      <td class="${pnlClass}">${formatCurrency(perf.net_pnl)}</td>
      <td>${renderMiniBar(perf.net_pnl)}</td>
    </tr>
  `;
}

function renderMiniBar(value: number): string {
  const isPositive = value >= 0;
  const color = isPositive ? PERF_POSITIVE : PERF_NEGATIVE;
  const absValue = Math.abs(value);
  const maxWidth = 100;
  const width = Math.min(maxWidth, absValue / 1000); // Scale

  return `
    <div class="mini-bar-container">
      <div class="mini-bar" style="width: ${width}px; background: ${color};"></div>
    </div>
  `;
}

function renderPerformanceBar(perf: StrategyPerformance, maxAbsPnl: number): string {
  const isPositive = perf.net_pnl >= 0;
  const color = isPositive ? PERF_POSITIVE : PERF_NEGATIVE;
  const absValue = Math.abs(perf.net_pnl);
  const percentage = maxAbsPnl > 0 ? (absValue / maxAbsPnl) * 100 : 0;

  return `
    <div class="performance-bar-item clickable" onclick="window.selectStrategyForDetail(${perf.strategy_id})" data-testid="performance-bar-item" data-strategy-id="${perf.strategy_id}">
      <div class="bar-label">${perf.strategy_name}</div>
      <div class="bar-container">
        <div
          class="bar-fill ${isPositive ? "positive" : "negative"}"
          style="width: ${percentage}%; background: ${color};"
        ></div>
      </div>
      <div class="bar-value ${isPositive ? "positive" : "negative"}">${formatCurrency(perf.net_pnl)}</div>
    </div>
  `;
}

function calculateTotals(performances: StrategyPerformance[]): {
  total_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  total_pnl: number;
  net_pnl: number;
  maxAbsPnl: number;
} {
  let total_trades = 0;
  let winners = 0;
  let losers = 0;
  let total_pnl = 0;
  let net_pnl = 0;
  let maxAbsPnl = 0;

  for (const perf of performances) {
    total_trades += perf.total_trades;
    winners += perf.winners;
    losers += perf.losers;
    total_pnl += perf.total_pnl;
    net_pnl += perf.net_pnl;
    maxAbsPnl = Math.max(maxAbsPnl, Math.abs(perf.net_pnl));
  }

  const win_rate = total_trades > 0 ? (winners / total_trades) * 100 : 0;

  return {
    total_trades,
    winners,
    losers,
    win_rate,
    total_pnl,
    net_pnl,
    maxAbsPnl: maxAbsPnl || 1, // Avoid division by zero
  };
}

function formatCurrency(value: number): string {
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}₹${value.toLocaleString("en-IN")}`;
}

async function loadAndSelectStrategy(strategyId: number) {
  selectedStrategyId = strategyId;

  if (!strategyTradesCache.has(strategyId)) {
    try {
      const result = await getStrategyTrades(strategyId, 100);
      strategyTradesCache.set(strategyId, result.trades);
    } catch (error) {
      console.error("Failed to load strategy trades:", error);
      strategyTradesCache.set(strategyId, []);
    }
  }

  triggerRerender();
}

// Initialize handlers for performance view
export function initPerformanceHandlers() {
  (window as any).selectStrategyForDetail = (strategyId: number) =>
    void loadAndSelectStrategy(strategyId);

  (window as any).clearSelectedStrategy = () => {
    selectedStrategyId = null;
    triggerRerender();
  };

  (window as any).viewAllStrategyTrades = (strategyName: string) => {
    localStorage.setItem("filterStrategy", strategyName);
    if ((window as any).navigateToRoute) {
      (window as any).navigateToRoute("paper");
    }
  };

  const strategyNameToSelect = localStorage.getItem("selectStrategyByName");
  if (strategyNameToSelect) {
    localStorage.removeItem("selectStrategyByName");
    (window as any).__pendingStrategySelection = strategyNameToSelect;
  }
}

// Select a strategy by name (called after data is loaded)
export async function selectStrategyByName(strategyName: string, strategies: any[]) {
  const strategy = strategies.find(
    (s) => s.name === strategyName || s.strategy_name === strategyName,
  );
  const strategyId = strategy?.id || strategy?.strategy_id;
  if (strategyId) {
    await loadAndSelectStrategy(strategyId);
  }
}

// Export function to get selected strategy
export function getSelectedStrategyId(): number | null {
  return selectedStrategyId;
}

// Clear cache when switching views
export function clearPerformanceCache() {
  strategyTradesCache.clear();
  selectedStrategyId = null;
}
