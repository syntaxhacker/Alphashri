/**
 * Live Positions Panel Component
 */

import { getPaperTradingState, setSelectedSymbol } from '../../state/paperTrading'
import { fetchPaperChart } from '../../api/paperTrading'

export function renderPositionsPanel(): string {
  const state = getPaperTradingState()

  if (state.isLoading && state.positions.length === 0) {
    return `
      <div class="positions-panel">
        <div class="loading-indicator">
          <p>Loading positions...</p>
        </div>
      </div>
    `
  }

  return `
    <div class="positions-panel" data-testid="positions-panel">
      ${renderPortfolioSummary(state.portfolio)}
      ${renderPositionsTable(state.positions, state.selectedSymbol)}
    </div>
  `
}

function renderPortfolioSummary(portfolio: ReturnType<typeof getPaperTradingState>['portfolio']): string {
  if (!portfolio) {
    return `
      <div class="portfolio-card">
        <p class="loading-text">Loading portfolio...</p>
      </div>
    `
  }

  const pnlClass = (portfolio.daily_pnl ?? 0) >= 0 ? 'positive' : 'negative'
  const pnlSign = (portfolio.daily_pnl ?? 0) >= 0 ? '+' : ''

  return `
    <div class="portfolio-card" data-testid="portfolio-card">
      <div class="portfolio-row">
        <div class="portfolio-item">
          <span class="portfolio-label">Capital</span>
          <span class="portfolio-value">₹${formatNum(portfolio.initial_capital ?? 0)}</span>
        </div>
        <div class="portfolio-item">
          <span class="portfolio-label">Cash</span>
          <span class="portfolio-value">₹${formatNum(portfolio.cash ?? 0)}</span>
        </div>
        <div class="portfolio-item">
          <span class="portfolio-label">Margin Used</span>
          <span class="portfolio-value">₹${formatNum(portfolio.margin_used ?? 0)}</span>
        </div>
      </div>
      <div class="portfolio-row portfolio-highlight">
        <div class="portfolio-item">
          <span class="portfolio-label">Total Value</span>
          <span class="portfolio-value">₹${formatNum(portfolio.total_value ?? 0)}</span>
        </div>
        <div class="portfolio-item">
          <span class="portfolio-label">Day P&L</span>
          <span class="portfolio-value ${pnlClass}">
            ${pnlSign}₹${formatNum(portfolio.daily_pnl ?? 0)}
            <span class="pnl-pct">(${pnlSign}${(portfolio.daily_pnl_pct ?? 0).toFixed(2)}%)</span>
          </span>
        </div>
        <div class="portfolio-item">
          <span class="portfolio-label">Positions</span>
          <span class="portfolio-value">${portfolio.positions ?? 0}</span>
        </div>
      </div>
    </div>
  `
}

function renderPositionsTable(
  positions: ReturnType<typeof getPaperTradingState>['positions'],
  selectedSymbol: string | null
): string {
  if (positions.length === 0) {
    return `
      <div class="positions-empty">
        <div class="empty-icon">📭</div>
        <p>No open positions</p>
        <p class="empty-hint">Positions will appear here when trades are placed</p>
      </div>
    `
  }

  return `
    <div class="positions-table-container">
      <div class="positions-header">
        <h3>Open Positions</h3>
        <span class="live-indicator">
          <span class="live-dot"></span>
          LIVE
        </span>
      </div>
      <table class="positions-table" data-testid="positions-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Entry</th>
            <th>Current</th>
            <th>P&L</th>
            <th>SL</th>
            <th>TP</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          ${positions.map(pos => {
            const isSelected = pos.symbol === selectedSymbol
            const pnlClass = (pos.pnl ?? 0) >= 0 ? 'positive' : 'negative'
            const sideClass = pos.side === 'BUY' ? 'side-long' : 'side-short'
            const sideIcon = pos.side === 'BUY' ? '▲' : '▼'
            const duration = formatDuration(pos.entry_time)

            return `
              <tr class="position-row ${isSelected ? 'selected' : ''}"
                  onclick="window.selectPosition('${pos.symbol}')"
                  data-symbol="${pos.symbol}">
                <td class="symbol-cell"><strong>${pos.symbol}</strong></td>
                <td class="${sideClass}">${sideIcon} ${pos.side}</td>
                <td>${pos.quantity}</td>
                <td>₹${(pos.entry_price ?? 0).toFixed(2)}</td>
                <td>₹${(pos.current_price ?? 1).toFixed(2)}</td>
                <td class="${pnlClass}">
                  <strong>₹${formatNum(pos.pnl)}</strong>
                  <span class="pnl-pct">(${(pos.pnl_pct ?? 1) >= 0 ? '+' : ''}${(pos.pnl_pct ?? 0).toFixed(2)}%)</span>
                </td>
                <td class="sl-cell">₹${(pos.stop_loss ?? 1).toFixed(2)}</td>
                <td class="tp-cell">₹${(pos.take_profit ?? 1).toFixed(2)}</td>
                <td class="time-cell">${duration}</td>
              </tr>
            `
          }).join('')}
        </tbody>
      </table>
    </div>
  `
}

function formatNum(num: number | undefined | null): string {
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

function formatDuration(entryTime: string): string {
  if (!entryTime) return '-'
  try {
    const entry = new Date(entryTime)
    const now = new Date()
    const diffMs = now.getTime() - entry.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 60) {
      return `${diffMins}m`
    }
    const hours = Math.floor(diffMins / 60)
    const mins = diffMins % 60
    return `${hours}h ${mins}m`
  } catch {
    return '-'
  }
}

export function initPositionsHandlers() {
  ;(window as any).selectPosition = async (symbol: string) => {
    setSelectedSymbol(symbol)
    await fetchPaperChart(symbol)
  }
}
