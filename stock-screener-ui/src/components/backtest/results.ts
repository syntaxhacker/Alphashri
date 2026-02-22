/**
 * Results Table Component
 *
 * Displays backtest results in a compact table for the left panel.
 */

import { getBacktestState, setSelectedChartSymbol, setShowCharts, setTradeHistory } from '../../state/backtest'
import { fetchChartData } from '../../api/backtest'
import { chartTradesToTrades } from '../../api/chartBuilder'
import type { BacktestResult, BacktestTotals } from '../../types/backtest'

export function renderResults(): string {
  const state = getBacktestState()

  if (state.isRunning) {
    return renderProgress(state.progress)
  }

  if (!state.results || state.results.length === 0) {
    return `
      <div class="results-empty" data-testid="results-empty">
        <p>No results yet. Run a backtest.</p>
      </div>
    `
  }

  return `
    <div class="results-container" data-testid="results-container">
      ${renderSummaryCompact(state.totals)}

      <div class="results-table-wrapper">
        <table class="results-table" data-testid="results-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Net PnL</th>
              <th>Trades</th>
              <th>WR%</th>
              <th>PF</th>
              <th>TP/SL</th>
            </tr>
          </thead>
          <tbody>
            ${state.results.map(r => renderResultRow(r)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `
}

function renderSummaryCompact(totals: BacktestTotals | null): string {
  if (!totals) return ''

  const pnlClass = totals.net_pnl >= 0 ? 'positive' : 'negative'
  const pnlSign = totals.net_pnl >= 0 ? '+' : ''

  return `
    <div class="results-summary-compact" data-testid="results-summary">
      <div class="summary-row">
        <span class="summary-item">
          <span class="label">Net PnL</span>
          <span class="value ${pnlClass}">${pnlSign}₹${(totals.net_pnl / 1000).toFixed(1)}K</span>
        </span>
        <span class="summary-item">
          <span class="label">Costs</span>
          <span class="value negative">₹${(totals.total_costs / 1000).toFixed(1)}K</span>
        </span>
        <span class="summary-item">
          <span class="label">WR</span>
          <span class="value">${totals.win_rate.toFixed(0)}%</span>
        </span>
        <span class="summary-item">
          <span class="label">Trades</span>
          <span class="value">${totals.trades}</span>
        </span>
      </div>
    </div>
  `
}

function renderResultRow(result: BacktestResult): string {
  const pnlClass = result.net_pnl >= 0 ? 'positive' : 'negative'
  const wrClass = result.win_rate >= 50 ? 'positive' : result.win_rate >= 40 ? 'neutral' : 'negative'
  const isSelected = getBacktestState().selectedChartSymbol === result.symbol

  return `
    <tr class="result-row ${isSelected ? 'selected' : ''}"
        data-testid="result-row-${result.symbol}"
        data-symbol="${result.symbol}"
        onclick="window.viewChartAndTrades('${result.symbol}')"
        style="cursor:pointer">
      <td class="symbol-cell" data-testid="symbol-${result.symbol}">${result.symbol}</td>
      <td class="pnl-cell ${pnlClass}" data-testid="net-pnl-${result.symbol}">
        ${result.net_pnl >= 0 ? '+' : ''}₹${(result.net_pnl / 1000).toFixed(1)}K
      </td>
      <td class="trades-cell" data-testid="trades-${result.symbol}">${result.trades}</td>
      <td class="wr-cell ${wrClass}" data-testid="wr-${result.symbol}">${result.win_rate.toFixed(0)}%</td>
      <td class="pf-cell" data-testid="pf-${result.symbol}">${result.pf.toFixed(1)}</td>
      <td class="tpsl-cell">
        <span class="tp positive">${result.tp_exits}</span>/<span class="sl negative">${result.sl_exits}</span>
      </td>
    </tr>
  `
}

function renderProgress(progress: { current: number; total: number; message: string }): string {
  const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0

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
  `
}

// Register window handlers
export function initResultsHandlers() {
  console.log('initResultsHandlers called')

  ;(window as any).viewChartAndTrades = (symbol: string) => {
    console.log('viewChartAndTrades called for:', symbol)

    // Show charts and select symbol
    setShowCharts(true)
    setSelectedChartSymbol(symbol)

    // Check if chart data already exists
    const state = getBacktestState()
    const chartData = state.chartData.get(symbol)

    if (chartData && chartData.trades && chartData.trades.length > 0) {
      // Data already loaded, just set trade history
      console.log('Chart data exists, setting trade history')
      const trades = chartTradesToTrades(chartData.trades)
      setTradeHistory(trades, symbol)
    } else {
      // Load chart data (which will also trigger re-render)
      console.log('Fetching chart data')
      fetchChartData(symbol)
    }
  }

  ;(window as any).exportResultsCSV = () => {
    const state = getBacktestState()
    if (!state.results) return

    const headers = ['Symbol', 'Net PnL', 'Gross PnL', 'Costs', 'Trades', 'Win Rate', 'PF', 'TP', 'SL']
    const rows = state.results.map(r => [
      r.symbol,
      r.net_pnl,
      r.gross_pnl,
      r.total_costs,
      r.trades,
      r.win_rate,
      r.pf,
      r.tp_exits,
      r.sl_exits,
    ])

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `backtest-results-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
}
