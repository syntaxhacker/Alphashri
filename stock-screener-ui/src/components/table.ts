/**
 * Table component for rendering stock rows
 */

import type { Stock } from '../types'
import { escapeAttr } from '../utils/format'
import { isRecentlyAdded } from '../utils/notifications'

/**
 * Render a symbol cell with hover preview and click-to-expand functionality.
 */
function renderSymbolCell(symbol: string): string {
  return `<td class="sym previewable"
    data-symbol="${symbol}"
    onmouseenter="window.showPreviewChart(event, '${symbol}')"
    onmouseleave="window.hidePreviewChart()"
    onclick="window.toggleExpandedChart('${symbol}')">${symbol}</td>`
}

export function renderStockRow(s: Stock, touched: boolean = false, screener: string = 'trending'): string {
  const scoreClass = s.score >= 80 ? 'score-high' : s.score >= 60 ? 'score-med' : ''
  const brokerClass = Math.abs(s.broker_diff) < 1.0 ? 'green' : 'yellow'
  const to52wClass = s.to_52w_high < 0 ? 'green' : s.to_52w_high > 0.5 ? 'red' : ''
  const returnIcon = s.recent_return_5d > 5 ? '🚀' : s.recent_return_5d > 0 ? '🟢' : '🔴'
  const returnClass = s.recent_return_5d > 0 ? 'green' : 'red'
  const perfClass = s.perf_w > 0 ? 'green' : 'red'
  const rowClass = isRecentlyAdded(s.symbol) ? 'row-new' : ''
  const rowHint = escapeAttr(s.rationale || '')

  if (screener === 'market_open_gap') {
    const gap = s.gap_pct ?? 0
    const pre = s.premarket_change ?? 0
    const day = s.day_change ?? 0
    return `
      <tr class="${rowClass}" title="${rowHint}">
        ${renderSymbolCell(s.symbol)}
        <td class="num ${scoreClass}">${s.score}</td>
        <td class="num ${gap >= 0 ? 'green' : 'red'}">${gap >= 0 ? '+' : ''}${gap.toFixed(2)}%</td>
        <td class="num ${pre >= 0 ? 'green' : 'red'}">${pre >= 0 ? '+' : ''}${pre.toFixed(2)}%</td>
        <td class="num ${day >= 0 ? 'green' : 'red'}">${day >= 0 ? '+' : ''}${day.toFixed(2)}%</td>
        <td class="num">${(s.volume_m ?? 0).toFixed(2)}</td>
        <td class="dim">${s.sector}</td>
      </tr>
    `
  }

  if (screener === 'rsi_reversal') {
    const day = s.day_change ?? 0
    return `
      <tr class="${rowClass}" title="${rowHint}">
        ${renderSymbolCell(s.symbol)}
        <td class="num ${scoreClass}">${s.score}</td>
        <td class="num">${(s.rsi ?? 0).toFixed(1)}</td>
        <td class="num">${(s.stoch_k ?? 0).toFixed(1)}</td>
        <td class="num ${day >= 0 ? 'green' : 'red'}">${day >= 0 ? '+' : ''}${day.toFixed(2)}%</td>
        <td class="num">${(s.volume_m ?? 0).toFixed(2)}</td>
        <td class="dim">${s.sector}</td>
      </tr>
    `
  }

  if (screener === 'nifty_movers') {
    const impact = s.impact_score ?? 0
    const day = s.day_change ?? 0
    return `
      <tr class="${rowClass}" title="${rowHint}">
        ${renderSymbolCell(s.symbol)}
        <td class="num ${scoreClass}">${s.score}</td>
        <td class="num ${impact >= 0 ? 'green' : 'red'}">${impact >= 0 ? '+' : ''}${impact.toFixed(2)}</td>
        <td class="num">${(s.market_cap_b ?? 0).toFixed(1)}B</td>
        <td class="num ${day >= 0 ? 'green' : 'red'}">${day >= 0 ? '+' : ''}${day.toFixed(2)}%</td>
        <td class="num">${(s.volume_m ?? 0).toFixed(2)}</td>
        <td class="dim">${s.sector}</td>
      </tr>
    `
  }

  if (screener === 'high_momentum') {
    const day = s.day_change ?? 0
    return `
      <tr class="${rowClass}" title="${rowHint}">
        ${renderSymbolCell(s.symbol)}
        <td class="num ${scoreClass}">${s.score}</td>
        <td class="num">${(s.rsi ?? 0).toFixed(1)}</td>
        <td class="num ${day >= 0 ? 'green' : 'red'}">${day >= 0 ? '+' : ''}${day.toFixed(2)}%</td>
        <td class="num">${(s.volume_m ?? 0).toFixed(2)}</td>
        <td class="num ${returnClass}">${returnIcon} ${s.recent_return_5d > 0 ? '+' : ''}${s.recent_return_5d.toFixed(1)}%</td>
        <td class="num ${perfClass}">${s.perf_w > 0 ? '+' : ''}${s.perf_w.toFixed(1)}%</td>
        <td class="dim">${s.sector}</td>
      </tr>
    `
  }

  if (screener === 'buyer_interest') {
    const day = s.day_change ?? 0
    return `
      <tr class="${rowClass}" title="${rowHint}">
        ${renderSymbolCell(s.symbol)}
        <td class="num ${scoreClass}">${s.score}</td>
        <td class="num">${(s.wick_close_pct ?? 0).toFixed(1)}%</td>
        <td class="num">${(s.volume_surge ?? 0).toFixed(2)}x</td>
        <td class="num">${(s.rsi ?? 0).toFixed(1)}</td>
        <td class="num ${day >= 0 ? 'green' : 'red'}">${day >= 0 ? '+' : ''}${day.toFixed(2)}%</td>
        <td class="num">${(s.volume_m ?? 0).toFixed(2)}</td>
        <td class="dim">${s.sector}</td>
      </tr>
    `
  }

  if (screener === 'buyer_interest_enhanced') {
    const day = s.day_change ?? 0
    const gap = s.gap_pct ?? 0
    const sentiment = s.sentiment ?? 'neutral'
    const sentimentDisplay: Record<string, { icon: string; label: string; cls: string }> = {
      'bullish': { icon: '🟢', label: 'Bull', cls: 'green' },
      'lean_bull': { icon: '📈', label: 'Bull+', cls: 'green' },
      'neutral': { icon: '⚪', label: 'Neutral', cls: '' },
      'lean_bear': { icon: '📉', label: 'Bear+', cls: 'red' },
      'bearish': { icon: '🔴', label: 'Bear', cls: 'red' },
    }
    const { icon, label, cls: dirClass } = sentimentDisplay[sentiment]
    return `
      <tr class="${rowClass}" title="${rowHint}">
        ${renderSymbolCell(s.symbol)}
        <td class="num ${scoreClass}">${s.score}</td>
        <td class="num ${dirClass}" title="${sentiment}">${icon}</td>
        <td class="num">${(s.wick_close_pct ?? 0).toFixed(1)}%</td>
        <td class="num">${(s.volume_surge ?? 0).toFixed(2)}x</td>
        <td class="num ${gap >= 0 ? 'green' : 'red'}">${gap >= 0 ? '+' : ''}${gap.toFixed(2)}%</td>
        <td class="num">${(s.rsi ?? 0).toFixed(1)}</td>
        <td class="num ${day >= 0 ? 'green' : 'red'}">${day >= 0 ? '+' : ''}${day.toFixed(2)}%</td>
        <td class="dim">${s.sector}</td>
      </tr>
    `
  }

  if (screener === 'volatility_trend') {
    const day = s.day_change ?? 0
    return `
      <tr class="${rowClass}" data-testid="stock-row" data-symbol="${s.symbol}" title="${rowHint}">
        ${renderSymbolCell(s.symbol)}
        <td class="num ${scoreClass}" data-testid="stock-score">${s.score}</td>
        <td class="num" data-testid="stock-atr-pct">${(s.atr_pct ?? 0).toFixed(2)}%</td>
        <td class="num" data-testid="stock-adx">${(s.adx ?? 0).toFixed(1)}</td>
        <td class="num" data-testid="stock-rsi">${(s.rsi ?? 0).toFixed(1)}</td>
        <td class="num ${day >= 0 ? 'green' : 'red'}" data-testid="stock-day-change">${day >= 0 ? '+' : ''}${day.toFixed(2)}%</td>
        <td class="num ${perfClass}" data-testid="stock-perf-w">${s.perf_w > 0 ? '+' : ''}${s.perf_w.toFixed(1)}%</td>
        <td class="dim" data-testid="stock-sector">${s.sector}</td>
      </tr>
    `
  }

  if (screener === 'nifty50_activity') {
    const day = s.day_change ?? 0
    return `
      <tr class="${rowClass}" title="${rowHint}">
        ${renderSymbolCell(s.symbol)}
        <td class="num ${scoreClass}">${s.score}</td>
        <td class="num">${(s.interest_score ?? 0).toFixed(1)}</td>
        <td class="num">${(s.volume_surge ?? 0).toFixed(2)}x</td>
        <td class="num">${(s.rsi ?? 0).toFixed(1)}</td>
        <td class="num ${day >= 0 ? 'green' : 'red'}">${day >= 0 ? '+' : ''}${day.toFixed(2)}%</td>
        <td class="num">${(s.volume_m ?? 0).toFixed(2)}</td>
        <td class="dim">${s.sector}</td>
      </tr>
    `
  }

  if (screener === 'intraday_momentum') {
    const move = s.move_pct ?? 0
    const day = s.day_change ?? 0
    return `
      <tr class="${rowClass}" title="${rowHint}">
        ${renderSymbolCell(s.symbol)}
        <td class="num ${move >= 0 ? 'green' : 'red'}">${move >= 0 ? '+' : ''}${move.toFixed(2)}%</td>
        <td class="num ${scoreClass}">${s.score}</td>
        <td class="num">${(s.volume_surge ?? 0).toFixed(2)}x</td>
        <td class="num">${(s.rsi ?? 0).toFixed(1)}</td>
        <td class="num">₹${(s.upstox_price ?? 0).toFixed(2)}</td>
        <td class="num ${day >= 0 ? 'green' : 'red'}">${day >= 0 ? '+' : ''}${day.toFixed(2)}%</td>
        <td class="num">${(s.volume_m ?? 0).toFixed(2)}</td>
        <td class="dim">${s.sector}</td>
      </tr>
    `
  }

  // Default row (trending / near_52w)
  return `
    <tr class="${rowClass}" title="${rowHint}">
      ${renderSymbolCell(s.symbol)}
      <td class="num ${scoreClass}">${s.score}</td>
      <td class="num">₹${s.tv_price.toFixed(2)}</td>
      <td class="num">₹${s.upstox_price.toFixed(2)}</td>
      <td class="num ${brokerClass}">${s.broker_diff > 0 ? '+' : ''}${s.broker_diff.toFixed(2)}%</td>
      <td class="num">₹${(s.high_52w ?? 0).toFixed(2)}</td>
      <td class="num ${to52wClass}">${s.to_52w_high > 0 ? '+' : ''}${s.to_52w_high.toFixed(2)}%</td>
      <td class="num ${returnClass}">${returnIcon} ${s.recent_return_5d > 0 ? '+' : ''}${s.recent_return_5d.toFixed(1)}%</td>
      <td class="num ${perfClass}">${s.perf_w > 0 ? '+' : ''}${s.perf_w.toFixed(1)}%</td>
      <td class="dim">${s.sector}</td>
    </tr>
  `
}
