/**
 * Backtest View Component
 *
 * Main backtest view that combines all sub-components.
 */

import { renderStrategyConfig, initConfigHandlers } from './config'
import { renderResults, initResultsHandlers } from './results'
import { renderChartContainer, initCharts, initChartHandlers } from './chart'
import { getBacktestState, setError } from '../../state/backtest'

export function renderBacktestView(): string {
  const state = getBacktestState()

  return `
    <div class="backtest-view" data-testid="backtest-view">
      <div class="backtest-header">
        <h2>📊 Strategy Backtesting</h2>
        <p class="backtest-subtitle">Test trading strategies with historical data and realistic costs</p>
      </div>

      <div class="backtest-body">
        <div class="backtest-left">
          ${renderStrategyConfig()}
        </div>

        <div class="backtest-right">
          ${renderResults()}
          ${renderChartContainer()}
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

// Initialize all backtest handlers
export function initBacktestHandlers() {
  initConfigHandlers()
  initResultsHandlers()
  initChartHandlers()

  ;(window as any).clearError = () => {
    setError(null)
  }
}

// Initialize charts after render
export function initBacktestCharts() {
  // Small delay to ensure DOM is ready
  setTimeout(() => {
    initCharts()
  }, 100)
}
