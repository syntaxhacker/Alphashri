/**
 * Trade History Panel Component
 */

import { getPaperTradingState, setSelectedSymbol, triggerPaperTradingRerender } from '../../state/paperTrading'
import { fetchPaperChart } from '../../api/paperTrading'
import type { PaperTrade } from '../../types/paperTrading'

// Sort state
let sortColumn: string = 'exit_time'
let sortDirection: 'asc' | 'desc' = 'desc'

export function renderHistoryPanel(): string {
  const state = getPaperTradingState()

  if (state.isLoading && state.trades.length === 0) {
    return `
      <div class="history-panel">
        <div class="loading-indicator">
          <p>Loading trade history...</p>
        </div>
      </div>
    `
  }

  // Filter trades
  let filteredTrades = [...state.trades]
  if (state.filterSymbol) {
    filteredTrades = filteredTrades.filter(t => t.symbol === state.filterSymbol)
  }
  if (state.filterFromDate || state.filterToDate) {
    filteredTrades = filterByRange(filteredTrades, state.filterFromDate, state.filterToDate)
  }

  return `
    <div class="history-panel" data-testid="history-panel">
      ${renderTradesTable(filteredTrades, state.selectedSymbol)}
    </div>
  `
}

function filterByRange(
  trades: PaperTrade[],
  fromDate: string | null,
  toDate: string | null
): PaperTrade[] {
  const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null
  const to = toDate ? new Date(`${toDate}T23:59:59`) : null

  return trades.filter(t => {
    const tradeDate = new Date(t.exit_time)
    if (from && tradeDate < from) return false
    if (to && tradeDate > to) return false
    return true
  })
}

function renderTradesTable(
  trades: PaperTrade[],
  selectedSymbol: string | null
): string {
  if (trades.length === 0) {
    return `
      <div class="trades-empty">
        <div class="empty-icon">📊</div>
        <p>No trades found</p>
        <p class="empty-hint">Completed trades will appear here</p>
      </div>
    `
  }

  // Sort trades
  const sortedTrades = sortTrades([...trades], sortColumn, sortDirection)

  const totalPnl = trades.reduce((sum, t) => sum + t.net_pnl, 0)
  const wins = trades.filter(t => t.net_pnl > 0).length
  const winRate = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : '0'

  const sortIndicator = (col: string) => {
    if (sortColumn !== col) return ''
    return sortDirection === 'asc' ? ' ▲' : ' ▼'
  }

  return `
    <div class="trades-table-container">
      <div class="trades-header">
        <h3>Completed Trades (${trades.length})</h3>
        <div class="trades-summary">
          <span>P&L: <strong class="${totalPnl >= 0 ? 'positive' : 'negative'}">₹${formatNumber(totalPnl)}</strong></span>
          <span>WR: ${winRate}%</span>
        </div>
      </div>
      <table class="trades-table sortable" data-testid="trades-table">
        <thead>
          <tr>
            <th class="sortable ${sortColumn === 'exit_time' ? 'sorted ' + sortDirection : ''}"
                onclick="window.sortPaperTrades('exit_time')">
              Time${sortIndicator('exit_time')}
            </th>
            <th class="sortable ${sortColumn === 'symbol' ? 'sorted ' + sortDirection : ''}"
                onclick="window.sortPaperTrades('symbol')">
              Symbol${sortIndicator('symbol')}
            </th>
            <th class="sortable ${sortColumn === 'side' ? 'sorted ' + sortDirection : ''}"
                onclick="window.sortPaperTrades('side')">
              Side${sortIndicator('side')}
            </th>
            <th class="sortable ${sortColumn === 'entry_price' ? 'sorted ' + sortDirection : ''}"
                onclick="window.sortPaperTrades('entry_price')">
              Entry${sortIndicator('entry_price')}
            </th>
            <th class="sortable ${sortColumn === 'exit_price' ? 'sorted ' + sortDirection : ''}"
                onclick="window.sortPaperTrades('exit_price')">
              Exit${sortIndicator('exit_price')}
            </th>
            <th class="sortable ${sortColumn === 'net_pnl' ? 'sorted ' + sortDirection : ''}"
                onclick="window.sortPaperTrades('net_pnl')">
              P&L${sortIndicator('net_pnl')}
            </th>
            <th class="sortable ${sortColumn === 'pnl_pct' ? 'sorted ' + sortDirection : ''}"
                onclick="window.sortPaperTrades('pnl_pct')">
              %${sortIndicator('pnl_pct')}
            </th>
            <th class="sortable ${sortColumn === 'exit_reason' ? 'sorted ' + sortDirection : ''}"
                onclick="window.sortPaperTrades('exit_reason')">
              Type${sortIndicator('exit_reason')}
            </th>
          </tr>
        </thead>
        <tbody>
          ${sortedTrades.map(trade => {
            const isSelected = trade.symbol === selectedSymbol
            const pnlClass = trade.net_pnl >= 0 ? 'positive' : 'negative'
            const sideClass = trade.side === 'BUY' ? 'side-long' : 'side-short'
            const sideIcon = trade.side === 'BUY' ? '▲' : '▼'
            const time = formatTradeTime(trade.exit_time)

            return `
              <tr class="trade-row ${isSelected ? 'selected' : ''} ${trade.net_pnl >= 0 ? 'trade-win' : 'trade-loss'}"
                  onclick="window.selectTrade('${trade.symbol}', '${trade.exit_time}')"
                  data-symbol="${trade.symbol}">
                <td class="time-cell">${time}</td>
                <td class="symbol-cell"><strong>${trade.symbol}</strong></td>
                <td class="${sideClass}">${sideIcon}</td>
                <td>₹${trade.entry_price.toFixed(2)}</td>
                <td>₹${trade.exit_price.toFixed(2)}</td>
                <td class="${pnlClass}">
                  <strong>₹${formatNumber(trade.net_pnl)}</strong>
                </td>
                <td class="${pnlClass}">
                  ${trade.pnl_pct >= 0 ? '+' : ''}${trade.pnl_pct.toFixed(2)}%
                </td>
                <td class="exit-${trade.exit_reason.toLowerCase()}">${trade.exit_reason}</td>
              </tr>
            `
          }).join('')}
        </tbody>
      </table>
    </div>
  `
}

function sortTrades(trades: PaperTrade[], column: string, direction: 'asc' | 'desc'): PaperTrade[] {
  return trades.sort((a, b) => {
    let aVal: number | string = 0
    let bVal: number | string = 0

    switch (column) {
      case 'exit_time':
        aVal = a.exit_time || ''
        bVal = b.exit_time || ''
        break
      case 'symbol':
        aVal = a.symbol
        bVal = b.symbol
        break
      case 'side':
        aVal = a.side
        bVal = b.side
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
      case 'pnl_pct':
        aVal = a.pnl_pct
        bVal = b.pnl_pct
        break
      case 'exit_reason':
        aVal = a.exit_reason
        bVal = b.exit_reason
        break
      default:
        return 0
    }

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }

    return direction === 'asc'
      ? (aVal as number) - (bVal as number)
      : (bVal as number) - (aVal as number)
  })
}

function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) {
    return '0'
  }
  if (Math.abs(num) >= 100000) {
    return (num / 100000).toFixed(1) + 'L'
  }
  if (Math.abs(num) >= 1000) {
    return (num / 1000).toFixed(1) + 'K'
  }
  return num.toFixed(0)
}

function formatTradeTime(isoStr: string): string {
  if (!isoStr) return '-'
  const date = new Date(isoStr)
  if (Number.isNaN(date.getTime())) return isoStr

  // Human-readable: 24 Feb 2026, 10:38:36
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(',', '')
}

export function initHistoryHandlers() {
  ;(window as any).selectTrade = async (symbol: string, exitTime: string) => {
    setSelectedSymbol(symbol)
    // Extract date from exit time for chart
    const date = exitTime.split('T')[0]
    await fetchPaperChart(symbol, date)
  }

  ;(window as any).sortPaperTrades = (column: string) => {
    if (sortColumn === column) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'
    } else {
      sortColumn = column
      sortDirection = 'desc'
    }
    // Trigger re-render
    triggerPaperTradingRerender()
  }
}
