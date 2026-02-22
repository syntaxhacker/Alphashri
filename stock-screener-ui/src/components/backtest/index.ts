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
import { getBacktestState, setError, setTradeHistory, triggerRerender } from '../../state/backtest'

// Trade history sort state
let tradeSortColumn: string = 'entry_time'
let tradeSortDirection: 'asc' | 'desc' = 'desc'

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

  // Format date to human readable: "12th Thu Jan 2025 10:30"
  const formatDateHuman = (isoStr: string) => {
    if (!isoStr) return '-'
    const parts = isoStr.split('T')
    const datePart = parts[0]
    const timePart = parts[1]?.replace('Z', '').replace(/\+00:00/g, '').replace(/\+05:30/g, '').substring(0, 5)
    const [year, month, day] = datePart.split('-')
    const d = parseInt(day)
    const m = parseInt(month) - 1
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const date = new Date(parseInt(year), m, d)
    const dayName = days[date.getDay()]
    const monthName = months[m]
    const suffix = d === 1 || d === 21 || d === 31 ? 'st' : d === 2 || d === 22 ? 'nd' : d === 3 || d === 23 ? 'rd' : 'th'
    return `${d}${suffix} ${dayName} ${monthName} ${timePart}`
  }

  const formatDuration = (mins: number) => {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  // Sort trades
  const sortedTrades = sortTrades([...trades], tradeSortColumn, tradeSortDirection)

  const totalPnl = trades.reduce((sum, t) => sum + t.net_pnl, 0)
  const wins = trades.filter(t => t.net_pnl > 0).length
  const winRate = trades.length > 0 ? (wins / trades.length * 100).toFixed(1) : '0'

  const sortIndicator = (col: string) => {
    if (tradeSortColumn !== col) return ''
    return tradeSortDirection === 'asc' ? ' ▲' : ' ▼'
  }

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
        <table class="trade-history-table sortable">
          <thead>
            <tr>
              <th class="sortable ${tradeSortColumn === 'entry_time' ? 'sorted ' + tradeSortDirection : ''}"
                  onclick="window.sortTrades('entry_time')">
                Time${sortIndicator('entry_time')}
              </th>
              <th class="sortable ${tradeSortColumn === 'quantity' ? 'sorted ' + tradeSortDirection : ''}"
                  onclick="window.sortTrades('quantity')">
                Qty${sortIndicator('quantity')}
              </th>
              <th class="sortable ${tradeSortColumn === 'entry_price' ? 'sorted ' + tradeSortDirection : ''}"
                  onclick="window.sortTrades('entry_price')">
                Entry${sortIndicator('entry_price')}
              </th>
              <th class="sortable ${tradeSortColumn === 'exit_price' ? 'sorted ' + tradeSortDirection : ''}"
                  onclick="window.sortTrades('exit_price')">
                Exit${sortIndicator('exit_price')}
              </th>
              <th class="sortable ${tradeSortColumn === 'net_pnl' ? 'sorted ' + tradeSortDirection : ''}"
                  onclick="window.sortTrades('net_pnl')">
                P&L${sortIndicator('net_pnl')}
              </th>
              <th class="sortable ${tradeSortColumn === 'net_pnl_pct' ? 'sorted ' + tradeSortDirection : ''}"
                  onclick="window.sortTrades('net_pnl_pct')">
                %${sortIndicator('net_pnl_pct')}
              </th>
              <th class="sortable ${tradeSortColumn === 'hold_duration_minutes' ? 'sorted ' + tradeSortDirection : ''}"
                  onclick="window.sortTrades('hold_duration_minutes')">
                Hold${sortIndicator('hold_duration_minutes')}
              </th>
              <th class="sortable ${tradeSortColumn === 'exit_reason' ? 'sorted ' + tradeSortDirection : ''}"
                  onclick="window.sortTrades('exit_reason')">
                Type${sortIndicator('exit_reason')}
              </th>
            </tr>
          </thead>
          <tbody>
            ${sortedTrades.map((t, i) => {
              // Find original index for zoomToTrade
              const originalIndex = trades.indexOf(t)
              const capital = t.entry_price * t.quantity
              const pnlPct = t.net_pnl_pct || ((t.net_pnl / capital) * 100)
              return `
                <tr class="${t.net_pnl >= 0 ? 'trade-win' : 'trade-loss'}"
                    onclick="window.zoomToTrade(${originalIndex})"
                    style="cursor:pointer"
                    title="Click to zoom to this trade">
                  <td class="time-cell">${formatDateHuman(t.entry_time)}</td>
                  <td>${t.quantity}</td>
                  <td>₹${t.entry_price.toFixed(0)}</td>
                  <td>₹${t.exit_price.toFixed(0)}</td>
                  <td class="${t.net_pnl >= 0 ? 'positive' : 'negative'}">
                    <strong>₹${t.net_pnl.toFixed(0)}</strong>
                  </td>
                  <td class="${pnlPct >= 0 ? 'positive' : 'negative'}">
                    ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%
                  </td>
                  <td>${formatDuration(t.hold_duration_minutes)}</td>
                  <td class="exit-${t.exit_reason.toLowerCase()}">${t.exit_reason}</td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `
}

function sortTrades(trades: any[], column: string, direction: 'asc' | 'desc'): any[] {
  return trades.sort((a, b) => {
    let aVal: number | string = 0
    let bVal: number | string = 0

    switch (column) {
      case 'entry_time':
        aVal = a.entry_time || ''
        bVal = b.entry_time || ''
        break
      case 'quantity':
        aVal = a.quantity
        bVal = b.quantity
        break
      case 'entry_price':
        aVal = a.entry_price
        bVal = b.entry_price
        break
      case 'exit_price':
        aVal = a.exit_price
        bVal = b.exit_price
        break
      case 'net_pnl':
        aVal = a.net_pnl
        bVal = b.net_pnl
        break
      case 'net_pnl_pct':
        aVal = a.net_pnl_pct || (a.net_pnl / (a.entry_price * a.quantity)) * 100
        bVal = b.net_pnl_pct || (b.net_pnl / (b.entry_price * b.quantity)) * 100
        break
      case 'hold_duration_minutes':
        aVal = a.hold_duration_minutes
        bVal = b.hold_duration_minutes
        break
      case 'exit_reason':
        aVal = a.exit_reason || ''
        bVal = b.exit_reason || ''
        break
      default:
        return 0
    }

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }

    return direction === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number)
  })
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

  ;(window as any).sortTrades = (column: string) => {
    if (tradeSortColumn === column) {
      tradeSortDirection = tradeSortDirection === 'asc' ? 'desc' : 'asc'
    } else {
      tradeSortColumn = column
      tradeSortDirection = 'desc'
    }
    triggerRerender()
  }
}

// Initialize charts after render
export function initBacktestCharts() {
  // Small delay to ensure DOM is ready
  setTimeout(() => {
    initCharts()
  }, 100)
}
