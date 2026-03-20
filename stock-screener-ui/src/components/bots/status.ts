/**
 * Bot Status Panel Component
 *
 * Displays live status of a running multi-strategy bot.
 */

import type {
  BotConfig,
  BotStatus,
  PortfolioSummary,
  StrategyStatus,
  BotPosition,
  BotTrade,
} from "../../types/bots";
import {
  getBotsState,
  loadBotStatus,
  loadBotTrades,
  startBotAction,
  stopBotAction,
  startAutoRefresh,
  stopAutoRefresh,
} from "../../state/bots";
import { isLoading } from "../../utils/loading";

export function renderBotStatusPanel(bot: BotConfig, status: BotStatus | null): string {
  const state = getBotsState();
  const trades = state.botTrades;
  const tradesLoading = isLoading(state.loading, "trades");

  return `
    <div class="bot-status-panel" data-testid="bot-status-panel" data-bot-id="${bot.id}">
      <!-- Bot Header -->
      <div class="bot-status-header">
        <div class="bot-info">
          <h3>${bot.name}</h3>
          <span class="bot-status-badge ${status?.running ? "running" : "stopped"}">
            ${status?.running ? `● Running (PID ${status.pid})` : "○ Stopped"}
          </span>
        </div>
        <div class="bot-controls">
          ${
            status?.running
              ? `
            <button class="btn btn-warning" onclick="window.stopBotFromStatus('${bot.id}')" data-testid="stop-bot-btn">
              ⏹ Stop Bot
            </button>
          `
              : `
            <button class="btn btn-success" onclick="window.startBotFromStatus('${bot.id}')" data-testid="start-bot-btn">
              ▶ Start Bot
            </button>
          `
          }
          <button class="btn btn-secondary" onclick="window.refreshBotStatus('${bot.id}')" data-testid="refresh-bot-status-btn">
            🔄 Refresh
          </button>
        </div>
      </div>

      <!-- Portfolio Summary -->
      ${
        status?.portfolio
          ? renderPortfolioSummary(status.portfolio)
          : `
        <div class="portfolio-summary-placeholder">
          <p>Start the bot to see live portfolio data</p>
        </div>
      `
      }

      <!-- Strategies Status -->
      ${status?.strategies ? renderStrategiesStatus(status.strategies, status?.running ?? false) : ""}

      <!-- Positions -->
      ${
        status?.positions && status.positions.length > 0
          ? renderPositions(status.positions)
          : status?.running
            ? `
          <div class="no-positions">
            <p>No open positions</p>
          </div>
        `
            : ""
      }

      <!-- Trade History -->
      ${renderTradesHistory(trades, tradesLoading, bot.id)}

      <!-- Last Update -->
      ${
        status?.last_update
          ? `
        <div class="status-footer">
          <span class="last-update">Last update: ${new Date(status.last_update).toLocaleTimeString()}</span>
        </div>
      `
          : ""
      }
    </div>
  `;
}

function renderPortfolioSummary(portfolio: PortfolioSummary): string {
  const pnlColor = portfolio.total_pnl >= 0 ? "positive" : "negative";
  const dailyPnlColor = portfolio.daily_pnl >= 0 ? "positive" : "negative";

  return `
    <div class="portfolio-summary" data-testid="portfolio-summary">
      <h4>Portfolio Summary</h4>
      <div class="portfolio-metrics">
        <div class="metric">
          <span class="metric-label">Capital</span>
          <span class="metric-value">₹${formatNumber(portfolio.initial_capital)}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Cash</span>
          <span class="metric-value">₹${formatNumber(portfolio.cash)}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Positions</span>
          <span class="metric-value">${portfolio.total_positions}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Total P&L</span>
          <span class="metric-value ${pnlColor}">
            ${portfolio.total_pnl >= 0 ? "+" : ""}₹${formatNumber(portfolio.total_pnl)}
            <span class="pnl-pct">(${portfolio.total_pnl_pct >= 0 ? "+" : ""}${portfolio.total_pnl_pct.toFixed(2)}%)</span>
          </span>
        </div>
        <div class="metric">
          <span class="metric-label">Daily P&L</span>
          <span class="metric-value ${dailyPnlColor}">
            ${portfolio.daily_pnl >= 0 ? "+" : ""}₹${formatNumber(portfolio.daily_pnl)}
          </span>
        </div>
      </div>
    </div>
  `;
}

function renderStrategiesStatus(
  strategies: Record<string, StrategyStatus>,
  isRunning: boolean,
): string {
  const strategyList = Object.values(strategies);

  return `
    <div class="strategies-status" data-testid="strategies-status">
      <h4>Strategy Status</h4>
      <div class="strategies-grid">
        ${strategyList.map((s) => renderStrategyCard(s, isRunning)).join("")}
      </div>
    </div>
  `;
}

function renderStrategyCard(strategy: StrategyStatus, isRunning: boolean): string {
  const pnlColor = strategy.total_pnl >= 0 ? "positive" : "negative";
  const usedPct = strategy.capital_used_pct;

  return `
    <div class="strategy-card ${strategy.status}" data-testid="strategy-card">
      <div class="strategy-card-header">
        <h5>${strategy.strategy_name}</h5>
        <span class="strategy-status-badge ${strategy.status}">${strategy.status}</span>
      </div>
      <div class="strategy-card-body">
        <div class="strategy-metric">
          <span>Positions</span>
          <span>${strategy.positions_count}/${strategy.max_positions}</span>
        </div>
        <div class="strategy-metric">
          <span>Capital Used</span>
          <span>
            ₹${formatNumber(strategy.capital_used)} / ₹${formatNumber(strategy.allocated_capital)}
            <span class="capital-pct">(${usedPct.toFixed(0)}%)</span>
          </span>
        </div>
        <div class="strategy-metric">
          <span>P&L</span>
          <span class="${pnlColor}">
            ${strategy.total_pnl >= 0 ? "+" : ""}₹${formatNumber(strategy.total_pnl)}
          </span>
        </div>
        <div class="strategy-metric">
          <span>Trades</span>
          <span>${strategy.trades_count}</span>
        </div>
        <div class="capital-bar">
          <div class="capital-bar-fill" style="width: ${Math.min(usedPct, 100)}%"></div>
        </div>
      </div>
    </div>
  `;
}

function renderPositions(positions: BotPosition[]): string {
  return `
    <div class="bot-positions" data-testid="bot-positions">
      <h4>Open Positions</h4>
      <table class="positions-table">
        <thead>
          <tr>
            <th>Strategy</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Entry</th>
            <th>Current</th>
            <th>P&L</th>
            <th>SL/TP</th>
          </tr>
        </thead>
        <tbody>
          ${positions.map((p) => renderPositionRow(p)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderPositionRow(position: BotPosition): string {
  const pnlColor = position.unrealized_pnl >= 0 ? "positive" : "negative";

  return `
    <tr class="position-row">
      <td class="strategy-name">${position.strategy_name}</td>
      <td class="symbol">${position.symbol}</td>
      <td class="side ${position.side.toLowerCase()}">${position.side}</td>
      <td class="quantity">${position.quantity}</td>
      <td class="entry">₹${position.entry_price.toFixed(2)}</td>
      <td class="current">₹${position.current_price.toFixed(2)}</td>
      <td class="pnl ${pnlColor}">
        ${position.unrealized_pnl >= 0 ? "+" : ""}₹${formatNumber(position.unrealized_pnl)}
        <span class="pnl-pct">(${position.unrealized_pnl_pct >= 0 ? "+" : ""}${position.unrealized_pnl_pct.toFixed(2)}%)</span>
      </td>
      <td class="sl-tp">
        <span class="sl">SL: ₹${position.stop_loss.toFixed(2)}</span>
        <span class="tp">TP: ₹${position.take_profit.toFixed(2)}</span>
      </td>
    </tr>
  `;
}

function renderTradesHistory(trades: BotTrade[], loading: boolean, botId: string): string {
  if (loading) {
    return `
      <div class="bot-trades" data-testid="bot-trades">
        <h4>Trade History</h4>
        <div class="trades-loading">
          <div class="spinner-small"></div>
          <span>Loading trades...</span>
        </div>
      </div>
    `;
  }

  if (trades.length === 0) {
    return `
      <div class="bot-trades" data-testid="bot-trades">
        <h4>Trade History</h4>
        <div class="no-trades">
          <p>No trades yet</p>
        </div>
      </div>
    `;
  }

  return `
    <div class="bot-trades" data-testid="bot-trades">
      <div class="trades-header">
        <h4>Trade History (${trades.length})</h4>
        <button class="btn btn-small btn-secondary" onclick="window.refreshBotTrades('${botId}')" data-testid="refresh-trades-btn">
          🔄 Refresh
        </button>
      </div>
      <table class="trades-table">
        <thead>
          <tr>
            <th>Strategy</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>P&L</th>
            <th>Net P&L</th>
            <th>Exit Reason</th>
          </tr>
        </thead>
        <tbody>
          ${trades.map((t) => renderTradeRow(t)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTradeRow(trade: BotTrade): string {
  const pnlColor = trade.pnl >= 0 ? "positive" : "negative";
  const netPnlColor = trade.net_pnl >= 0 ? "positive" : "negative";

  return `
    <tr class="trade-row ${trade.is_test ? "test-trade" : ""}">
      <td class="strategy-name">
        ${trade.strategy_name}
        ${trade.is_test ? '<span class="test-badge">TEST</span>' : ""}
      </td>
      <td class="symbol">${trade.symbol}</td>
      <td class="side ${trade.side.toLowerCase()}">${trade.side}</td>
      <td class="quantity">${trade.quantity}</td>
      <td class="entry">₹${trade.entry_price.toFixed(2)}</td>
      <td class="exit">₹${(trade.exit_price ?? 0).toFixed(2)}</td>
      <td class="pnl ${pnlColor}">
        ${trade.pnl >= 0 ? "+" : ""}₹${formatNumber(trade.pnl)}
        <span class="pnl-pct">(${trade.pnl_pct >= 0 ? "+" : ""}${trade.pnl_pct.toFixed(2)}%)</span>
      </td>
      <td class="net-pnl ${netPnlColor}">
        ${trade.net_pnl >= 0 ? "+" : ""}₹${formatNumber(trade.net_pnl)}
      </td>
      <td class="exit-reason ${trade.exit_reason}">${formatExitReason(trade.exit_reason)}</td>
    </tr>
  `;
}

export function formatExitReason(reason: string): string {
  const reasons: Record<string, string> = {
    target: "Target",
    stop_loss: "Stop Loss",
    signal: "Signal",
    manual: "Manual",
    timeout: "Timeout",
  };
  return reasons[reason] || reason;
}

export function formatNumber(num: number): string {
  if (Math.abs(num) >= 100000) {
    return (num / 100000).toFixed(1) + "L";
  } else if (Math.abs(num) >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toFixed(0);
}

// Initialize status panel handlers
export function initStatusHandlers() {
  (window as any).refreshBotStatus = async (botId: string) => {
    await Promise.all([loadBotStatus(botId), loadBotTrades(botId)]);
  };

  (window as any).startBotFromStatus = async (botId: string) => {
    const success = await startBotAction(botId, false);
    if (success) {
      await loadBotStatus(botId);
      await loadBotTrades(botId);
      startAutoRefresh(botId, 5000);
    }
  };

  (window as any).stopBotFromStatus = async (botId: string) => {
    const success = await stopBotAction(botId);
    if (success) {
      stopAutoRefresh();
      await loadBotStatus(botId);
    }
  };

  (window as any).refreshBotTrades = async (botId: string) => {
    await loadBotTrades(botId);
  };
}
