/**
 * Results Table Component
 *
 * Displays backtest results in a table.
 */

import { getBacktestState, setSelectedChartSymbol, setShowCharts, setTradeHistory } from '../../state/backtest'
import { fetchChartData } from '../../api/backtest'
import { chartTradesToTrades } from '../../api/chartBuilder'
import type { BacktestResult, BacktestTotals, Trade } from '../../types/backtest'

export function renderResults(): string {
  const state = getBacktestState()

  if (state.isRunning) {
    return renderProgress(state.progress)
  }

  if (!state.results || state.results.length === 0) {
    return `
      <div class="results-empty" data-testid="results-empty">
        <p>No results yet. Configure and run a backtest.</p>
      </div>
    `
  }

  return `
    <div class="results-container" data-testid="results-container">
      ${renderSummary(state.totals)}

      <div class="results-table-wrapper">
        <table class="results-table" data-testid="results-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Net PnL ₹</th>
              <th>Gross PnL ₹</th>
              <th>Costs ₹</th>
              <th>Trades</th>
              <th>WR%</th>
              <th>PF</th>
              <th>TP</th>
              <th>SL</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${state.results.map(r => renderResultRow(r)).join('')}
          </tbody>
        </table>
      </div>

      ${state.tradeHistory ? renderTradesModal(state.tradeHistorySymbol || '', state.tradeHistory) : ''}

      <div class="results-footer">
        <button
          class="btn btn-secondary"
          data-testid="export-csv-btn"
          onclick="window.exportResultsCSV()"
        >
          📥 Export CSV
        </button>
        <button
          class="btn btn-secondary"
          data-testid="toggle-charts-btn"
          onclick="window.toggleCharts()"
        >
          ${state.showCharts ? '📊 Hide Charts' : '📊 Show Charts'}
        </button>
      </div>
    </div>
  `
}

function renderSummary(totals: BacktestTotals | null): string {
  if (!totals) return ''

  const pnlClass = totals.net_pnl >= 0 ? 'positive' : 'negative'
  const pnlSign = totals.net_pnl >= 0 ? '+' : ''

  return `
    <div class="results-summary" data-testid="results-summary">
      <div class="summary-item" data-testid="summary-gross-pnl">
        <span class="summary-label">Gross PnL</span>
        <span class="summary-value">₹${totals.gross_pnl.toLocaleString()}</span>
      </div>
      <div class="summary-item" data-testid="summary-costs">
        <span class="summary-label">Trading Costs</span>
        <span class="summary-value negative">-₹${totals.total_costs.toLocaleString()}</span>
      </div>
      <div class="summary-item" data-testid="summary-net-pnl">
        <span class="summary-label">Net PnL</span>
        <span class="summary-value ${pnlClass}">${pnlSign}₹${totals.net_pnl.toLocaleString()}</span>
      </div>
      <div class="summary-item" data-testid="summary-win-rate">
        <span class="summary-label">Win Rate</span>
        <span class="summary-value">${totals.win_rate.toFixed(1)}%</span>
      </div>
      <div class="summary-item" data-testid="summary-trades">
        <span class="summary-label">Total Trades</span>
        <span class="summary-value">${totals.trades}</span>
      </div>
      <div class="summary-item" data-testid="summary-avg-cost">
        <span class="summary-label">Avg Cost/Trade</span>
        <span class="summary-value">₹${(totals.total_costs / totals.trades).toFixed(0)}</span>
      </div>
    </div>
  `
}

function renderResultRow(result: BacktestResult): string {
  const pnlClass = result.net_pnl >= 0 ? 'positive' : 'negative'
  const wrClass = result.win_rate >= 50 ? 'positive' : result.win_rate >= 40 ? 'neutral' : 'negative'

  return `
    <tr class="result-row" data-testid="result-row-${result.symbol}" data-symbol="${result.symbol}">
      <td class="symbol-cell" data-testid="symbol-${result.symbol}">${result.symbol}</td>
      <td class="pnl-cell ${pnlClass}" data-testid="net-pnl-${result.symbol}">₹${result.net_pnl.toLocaleString()}</td>
      <td class="pnl-cell" data-testid="gross-pnl-${result.symbol}">₹${result.gross_pnl.toLocaleString()}</td>
      <td class="costs-cell" data-testid="costs-${result.symbol}">₹${result.total_costs.toLocaleString()}</td>
      <td class="trades-cell" data-testid="trades-${result.symbol}">${result.trades}</td>
      <td class="wr-cell ${wrClass}" data-testid="wr-${result.symbol}">${result.win_rate.toFixed(1)}%</td>
      <td class="pf-cell" data-testid="pf-${result.symbol}">${result.pf.toFixed(2)}</td>
      <td class="tp-cell positive" data-testid="tp-${result.symbol}">${result.tp_exits}</td>
      <td class="sl-cell negative" data-testid="sl-${result.symbol}">${result.sl_exits}</td>
      <td class="actions-cell">
        <button
          class="btn-small"
          data-testid="btn-chart-${result.symbol}"
          title="View chart"
          onclick="window.viewChart('${result.symbol}')"
        >
          📈
        </button>
        <button
          class="btn-small"
          data-testid="btn-trades-${result.symbol}"
          title="View trades"
          onclick="window.viewTrades('${result.symbol}')"
        >
          📋
        </button>
      </td>
    </tr>
  `
}

function renderProgress(progress: { current: number; total: number; message: string }): string {
  const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0

  return `
    <div class="progress-container" data-testid="progress-container">
      <div class="progress-header">
        <span>Running Backtest...</span>
        <span data-testid="progress-counter">${progress.current}/${progress.total}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" data-testid="progress-fill" style="width: ${percent}%"></div>
      </div>
      <div class="progress-message" data-testid="progress-message">${progress.message}</div>
    </div>
  `
}

function renderTradesModal(symbol: string, trades: Trade[]): string {
  // Format ISO time string to human readable: "12th Thu Jan 2025 10:30"
  const formatDateTime = (isoStr: string) => {
    if (!isoStr) return '-'
    const parts = isoStr.split('T')
    const datePart = parts[0] // YYYY-MM-DD
    const timePart = parts[1]?.replace('Z', '').replace(/\+00:00/g, '').replace(/\+05:30/g, '').substring(0, 5)

    const [year, month, day] = datePart.split('-')
    const d = parseInt(day)
    const m = parseInt(month) - 1
    const y = parseInt(year)

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const date = new Date(y, m, d)
    const dayName = days[date.getDay()]
    const monthName = months[m]
    const suffix = d === 1 || d === 21 || d === 31 ? 'st' : d === 2 || d === 22 ? 'nd' : d === 3 || d === 23 ? 'rd' : 'th'

    return `${d}${suffix} ${dayName} ${monthName} ${y} ${timePart}`
  }

  const formatDuration = (mins: number) => {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  const totalPnl = trades.reduce((sum, t) => sum + t.net_pnl, 0)
  const wins = trades.filter(t => t.net_pnl > 0).length
  const winRate = trades.length > 0 ? (wins / trades.length * 100).toFixed(1) : '0'

  return `
    <div class="trades-modal-overlay" data-testid="trades-modal-overlay" onclick="window.closeTradesModal(event)">
      <div class="trades-modal" data-testid="trades-modal" onclick="event.stopPropagation()">
        <div class="trades-modal-header">
          <h3>📋 ${symbol} - Trade History (${trades.length} trades)</h3>
          <button class="modal-close" onclick="window.closeTradesModal()" title="Close">×</button>
        </div>

        <div class="trades-modal-summary">
          <span><strong>Total P&L:</strong> <span class="${totalPnl >= 0 ? 'positive' : 'negative'}">₹${totalPnl.toFixed(0)}</span></span>
          <span><strong>Wins:</strong> ${wins}/${trades.length}</span>
          <span><strong>Win Rate:</strong> ${winRate}%</span>
        </div>

        <div class="trades-modal-body">
          <table class="trades-table" data-testid="trades-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Entry Time</th>
                <th>Exit Time</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>Qty</th>
                <th>Gross P&L</th>
                <th>Costs</th>
                <th>Net P&L</th>
                <th>Net %</th>
                <th>Hold</th>
                <th>Exit</th>
              </tr>
            </thead>
            <tbody>
              ${trades.map((t, i) => `
                <tr class="${t.net_pnl >= 0 ? 'trade-win' : 'trade-loss'}">
                  <td>${i + 1}</td>
                  <td>${formatDateTime(t.entry_time)}</td>
                  <td>${formatDateTime(t.exit_time)}</td>
                  <td>₹${t.entry_price.toFixed(2)}</td>
                  <td>₹${t.exit_price.toFixed(2)}</td>
                  <td>${t.quantity}</td>
                  <td class="${t.gross_pnl >= 0 ? 'positive' : 'negative'}">₹${t.gross_pnl.toFixed(0)}</td>
                  <td>₹${t.trading_costs.toFixed(0)}</td>
                  <td class="${t.net_pnl >= 0 ? 'positive' : 'negative'}"><strong>₹${t.net_pnl.toFixed(0)}</strong></td>
                  <td class="${t.net_pnl_pct >= 0 ? 'positive' : 'negative'}">${t.net_pnl_pct >= 0 ? '+' : ''}${t.net_pnl_pct.toFixed(2)}%</td>
                  <td>${formatDuration(t.hold_duration_minutes)}</td>
                  <td class="exit-${t.exit_reason.toLowerCase()}">${t.exit_reason}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="trades-modal-footer">
          <button class="btn btn-secondary" onclick="window.exportTradesCSV('${symbol}')">📥 Export CSV</button>
        </div>
      </div>
    </div>
  `
}

// Register window handlers
export function initResultsHandlers() {
  ;(window as any).viewChart = (symbol: string) => {
    setShowCharts(true)
    setSelectedChartSymbol(symbol)
    fetchChartData(symbol)
  }

  ;(window as any).viewTrades = (symbol: string) => {
    const state = getBacktestState()
    const chartData = state.chartData.get(symbol)
    if (chartData && chartData.trades && chartData.trades.length > 0) {
      const trades = chartTradesToTrades(chartData.trades)
      setTradeHistory(trades, symbol)
    } else {
      console.log('No chart data for symbol:', symbol)
    }
  }

  ;(window as any).closeTradesModal = (event?: Event) => {
    if (event && (event.target as HTMLElement).classList.contains('trades-modal-overlay')) {
      setTradeHistory(null, null)
    } else if (!event) {
      setTradeHistory(null, null)
    }
  }

  ;(window as any).toggleCharts = () => {
    const state = getBacktestState()
    setShowCharts(!state.showCharts)
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

  ;(window as any).exportTradesCSV = (symbol: string) => {
    const state = getBacktestState()
    if (!state.tradeHistory) return

    const headers = ['Entry Time', 'Exit Time', 'Entry Price', 'Exit Price', 'Qty', 'Gross PnL', 'Costs', 'Net PnL', 'Net %', 'Hold (m)', 'Exit']
    const rows = state.tradeHistory.map(t => [
      t.entry_time,
      t.exit_time,
      t.entry_price,
      t.exit_price,
      t.quantity,
      t.gross_pnl,
      t.trading_costs,
      t.net_pnl,
      t.net_pnl_pct,
      t.hold_duration_minutes,
      t.exit_reason,
    ])

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${symbol}-trades-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
}
