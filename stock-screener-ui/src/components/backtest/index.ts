/**
 * Backtest View Component
 *
 * Main backtest view that combines all sub-components.
 *
 * Layout:
 * - Top: Strategy config (horizontal row)
 * - Left: Results table
 * - Right: Chart (fits window) + Trade history below
 */

import { renderStrategyConfig, initConfigHandlers } from './config'
import { renderResults, initResultsHandlers } from './results'
import { renderChartContainer, initCharts, initChartHandlers } from './chart'
import { getBacktestState, setError, setTradeHistory } from '../../state/backtest'

export function renderBacktestView(): string {
  const state = getBacktestState()

  return `
    <div class="backtest-view" data-testid="backtest-view">
      <!-- Top: Horizontal Config Row -->
      <div class="backtest-config-row">
        ${renderStrategyConfig()}
      </div>

      <!-- Main Content: Table Left, Chart Right -->
      <div class="backtest-main">
        <!-- Left: Results Table -->
        <div class="backtest-left">
          ${renderResults()}
        </div>

        <!-- Right: Chart + Trade History -->
        <div class="backtest-right">
          ${renderChartContainer()}
          ${state.tradeHistory ? renderTradeHistoryPanel(state.tradeHistorySymbol || '', state.tradeHistory) : ''}
        </div>
      </div>

      ${state.error ? `
        <div class="backtest-error" data-testid="backtest-error">
          <p>❌ ${state.error}</p>
          <button class="btn btn-secondary" onclick="window.clearError()">Dismiss</button>
        </div>
      ` : ''}
    </div>
  `
}

// Trade history panel for right side
function renderTradeHistoryPanel(symbol: string, trades: any[]): string {
  if (!trades || trades.length === 0) return ''

  const formatDuration = (mins: number) => {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  const totalPnl = trades.reduce((sum, t) => sum + t.net_pnl, 0)
  const wins = trades.filter(t => t.net_pnl > 0).length
  const winRate = trades.length > 0 ? (wins / trades.length * 100).toFixed(1) : '0'

  return `
    <div class="trade-history-panel" data-testid="trade-history-panel">
      <div class="trade-history-header">
        <h4>📋 ${symbol} Trades (${trades.length})</h4>
        <button class="btn-small" onclick="window.closeTradeHistory()" title="Close">×</button>
      </div>
      <div class="trade-history-summary">
        <span>P&L: <strong class="${totalPnl >= 0 ? 'positive' : 'negative'}">₹${totalPnl.toFixed(0)}</strong></span>
        <span>WR: ${winRate}%</span>
        <span>Wins: ${wins}/${trades.length}</span>
      </div>
      <div class="trade-history-body">
        <table class="trade-history-table">
          <thead>
            <tr>
              <th>Entry</th>
              <th>Exit</th>
              <th>P&L</th>
              <th>Hold</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            ${trades.map((t, i) => `
              <tr class="${t.net_pnl >= 0 ? 'trade-win' : 'trade-loss'}"
                  onclick="window.zoomToTrade(${i})"
                  style="cursor:pointer"
                  title="Click to zoom to this trade">
                <td>₹${t.entry_price.toFixed(0)}</td>
                <td>₹${t.exit_price.toFixed(0)}</td>
                <td class="${t.net_pnl >= 0 ? 'positive' : 'negative'}">
                  <strong>₹${t.net_pnl.toFixed(0)}</strong>
                </td>
                <td>${formatDuration(t.hold_duration_minutes)}</td>
                <td class="exit-${t.exit_reason.toLowerCase()}">${t.exit_reason}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `
}

// Initialize all backtest handlers
export function initBacktestHandlers() {
  initConfigHandlers()
  initResultsHandlers()
  initChartHandlers()

  ;(window as any).clearError = () => {
    setError(null)
  }

  ;(window as any).closeTradeHistory = () => {
    setTradeHistory(null, null)
  }
}

// Initialize charts after render
export function initBacktestCharts() {
  // Small delay to ensure DOM is ready
  setTimeout(() => {
    initCharts()
  }, 100)
}
