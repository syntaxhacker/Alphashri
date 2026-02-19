import './style.css'
import { COLUMN_LABELS, NUMERIC_COLUMNS, getColumnKeysForProfile } from './ui_schema'
import { buildProfileFilterQueryParams, detectAddedSymbols, getTradingList } from './runtime_utils'

interface Stock {
  symbol: string
  score: number
  tv_price: number
  upstox_price: number
  broker_diff: number
  to_52w_high: number
  time_to_52w?: { days: number; confidence: 'HIGH' | 'MED' | 'LOW' }
  recent_return_5d: number
  perf_w: number
  sector: string
  touched_52w: boolean
  day_change?: number
  rsi?: number
  stoch_k?: number
  wick_close_pct?: number
  volume_surge?: number
  volatility_d?: number
  adx?: number
  interest_score?: number
  gap_pct?: number
  premarket_change?: number
  impact_score?: number
  market_cap_b?: number
  volume_m?: number
  reversal_signal?: string
  rationale?: string
  is_bullish?: boolean
  sentiment?: 'bullish' | 'lean_bull' | 'neutral' | 'lean_bear' | 'bearish'
}

interface SummaryItem {
  label: string
  value: string
}

interface ProfileFilter {
  key: string
  label: string
  type: 'number' | 'select'
  min?: number
  max?: number
  step?: number
  default?: number | string
  options?: string[]
}

interface ProfileMeta {
  section_labels?: { primary: string; secondary: string }
  filters?: ProfileFilter[]
  default_sort?: { column: string; direction: 'asc' | 'desc' }
}

interface ScreenerData {
  approaching: Stock[]
  touched: Stock[]
  last_updated: string
  provider: string
  mode: string
  screener: string
  profile_meta?: ProfileMeta
  summary?: SummaryItem[]
  demo_mode?: boolean
}

interface Filters {
  minScore: number
  maxPrice: number
  minReturn: number
  sector: string
}

interface ScreenerOption {
  id: string
  label: string
  description: string
}

interface ChangeNotification {
  id: number
  ts: string
  title: string
  detail: string
  kind: 'primary' | 'secondary'
}

let data: ScreenerData | null = null
let isLoading = false
let error: string | null = null
let autoRefreshInterval: number | null = null
let autoRefreshSeconds = 30
let filters: Filters = { minScore: 0, maxPrice: 7000, minReturn: -100, sector: '' }
let sortColumn: string | null = null
let sortDirection: 'asc' | 'desc' = 'desc'
let screenerOptions: ScreenerOption[] = []
let activeScreener = 'trending'
let profileMetaById: Record<string, ProfileMeta> = {}
let profileFilterValues: Record<string, string | number> = {}
let notifications: ChangeNotification[] = []
let notifSeq = 1
let notifPanelOpen = true
let notifFilter: 'all' | 'primary' | 'secondary' = 'all'
let recentAddedSymbols: Record<string, number> = {}
const NEW_ROW_HIGHLIGHT_MS = 12000

const API_URL = 'http://localhost:8765/api/screener'
const SCREENERS_URL = 'http://localhost:8765/api/screeners'

function formatTimestamp(isoString: string): string {
  const d = new Date(isoString)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  const secs = Math.floor((diff % 60000) / 1000)

  if (mins < 1) return `${secs}s ago`
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m ago`
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function pushNotification(title: string, detail: string, kind: 'primary' | 'secondary') {
  notifications = [{ id: notifSeq++, ts: new Date().toLocaleTimeString(), title, detail, kind }, ...notifications].slice(0, 50)
}

function markNewSymbols(symbols: string[]) {
  if (symbols.length === 0) return
  const expiry = Date.now() + NEW_ROW_HIGHLIGHT_MS
  symbols.forEach((symbol) => {
    recentAddedSymbols[symbol] = expiry
  })
  setTimeout(() => {
    const now = Date.now()
    let changed = false
    for (const [symbol, expiresAt] of Object.entries(recentAddedSymbols)) {
      if (expiresAt <= now) {
        delete recentAddedSymbols[symbol]
        changed = true
      }
    }
    if (changed) render()
  }, NEW_ROW_HIGHLIGHT_MS + 100)
}

function isRecentlyAdded(symbol: string): boolean {
  const expiry = recentAddedSymbols[symbol]
  if (!expiry) return false
  if (expiry <= Date.now()) {
    delete recentAddedSymbols[symbol]
    return false
  }
  return true
}

function detectAutoRefreshChanges(prev: ScreenerData | null, next: ScreenerData | null) {
  const { addedPrimary, addedSecondary } = detectAddedSymbols(prev, next)
  if (addedPrimary.length === 0 && addedSecondary.length === 0) return

  const screenLabel = screenerOptions.find(s => s.id === next.screener)?.label || next.screener
  markNewSymbols([...addedPrimary, ...addedSecondary])
  if (addedPrimary.length > 0) {
    pushNotification(
      `${screenLabel} auto-refresh`,
      `Primary +${addedPrimary.length}: ${addedPrimary.slice(0, 8).join(', ')}`,
      'primary'
    )
  }
  if (addedSecondary.length > 0) {
    pushNotification(
      `${screenLabel} auto-refresh`,
      `Secondary +${addedSecondary.length}: ${addedSecondary.slice(0, 8).join(', ')}`,
      'secondary'
    )
  }
}

function applyFilters(stocks: Stock[]): Stock[] {
  return stocks.filter(s =>
    s.score >= filters.minScore &&
    s.tv_price <= filters.maxPrice &&
    s.recent_return_5d >= filters.minReturn &&
    (filters.sector === '' || s.sector === filters.sector)
  )
}

function sortStocks(stocks: Stock[]): Stock[] {
  if (!sortColumn) return stocks

  return [...stocks].sort((a, b) => {
    let aVal: any, bVal: any

    switch (sortColumn) {
      case 'symbol': aVal = a.symbol; bVal = b.symbol; break
      case 'score': aVal = a.score; bVal = b.score; break
      case 'tv_price': aVal = a.tv_price; bVal = b.tv_price; break
      case 'upstox_price': aVal = a.upstox_price; bVal = b.upstox_price; break
      case 'broker_diff': aVal = a.broker_diff; bVal = b.broker_diff; break
      case 'to_52w_high': aVal = a.to_52w_high; bVal = b.to_52w_high; break
      case 'time_to_52w': aVal = a.time_to_52w?.days ?? 999; bVal = b.time_to_52w?.days ?? 999; break
      case 'recent_return_5d': aVal = a.recent_return_5d; bVal = b.recent_return_5d; break
      case 'perf_w': aVal = a.perf_w; bVal = b.perf_w; break
      case 'day_change': aVal = a.day_change ?? 0; bVal = b.day_change ?? 0; break
      case 'rsi': aVal = a.rsi ?? 0; bVal = b.rsi ?? 0; break
      case 'stoch_k': aVal = a.stoch_k ?? 0; bVal = b.stoch_k ?? 0; break
      case 'wick_close_pct': aVal = a.wick_close_pct ?? 0; bVal = b.wick_close_pct ?? 0; break
      case 'volume_surge': aVal = a.volume_surge ?? 0; bVal = b.volume_surge ?? 0; break
      case 'volatility_d': aVal = a.volatility_d ?? 0; bVal = b.volatility_d ?? 0; break
      case 'adx': aVal = a.adx ?? 0; bVal = b.adx ?? 0; break
      case 'interest_score': aVal = a.interest_score ?? 0; bVal = b.interest_score ?? 0; break
      case 'gap_pct': aVal = a.gap_pct ?? 0; bVal = b.gap_pct ?? 0; break
      case 'premarket_change': aVal = a.premarket_change ?? 0; bVal = b.premarket_change ?? 0; break
      case 'impact_score': aVal = a.impact_score ?? 0; bVal = b.impact_score ?? 0; break
      case 'market_cap_b': aVal = a.market_cap_b ?? 0; bVal = b.market_cap_b ?? 0; break
      case 'volume_m': aVal = a.volume_m ?? 0; bVal = b.volume_m ?? 0; break
      case 'sector': aVal = a.sector; bVal = b.sector; break
      default: return 0
    }

    if (typeof aVal === 'string') {
      return sortDirection === 'asc'
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal)
    }

    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
  })
}

function handleSort(column: string) {
  if (sortColumn === column) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'
  } else {
    sortColumn = column
    sortDirection = 'desc'
  }
  render()
}

function renderSortIndicator(column: string): string {
  if (sortColumn !== column) return '<span class="sort-indicator"></span>'
  return `<span class="sort-indicator ${sortDirection}">${sortDirection === 'asc' ? '↑' : '↓'}</span>`
}

function renderSortableHeader(label: string, column: string, className = ''): string {
  return `<th class="${className} sortable" data-column="${column}" onclick="window.handleSort('${column}')">${label} ${renderSortIndicator(column)}</th>`
}

function getUniqueSectors(stocks: Stock[]): string[] {
  const sectors = new Set(stocks.map(s => s.sector).filter(s => s && s !== '-'))
  return Array.from(sectors).sort()
}

function getActiveProfileMeta(): ProfileMeta {
  return data?.profile_meta || profileMetaById[activeScreener] || {}
}

function getSectionLabels(): { primary: string; secondary: string } {
  const meta = getActiveProfileMeta()
  return meta.section_labels || { primary: '🎯 APPROACHING 52W HIGH', secondary: '✅ ALREADY TOUCHED 52W HIGH' }
}

function initProfileFilters(screener: string) {
  const meta = profileMetaById[screener] || {}
  const defs = meta.filters || []
  profileFilterValues = {}
  defs.forEach((f) => {
    profileFilterValues[f.key] = f.default ?? (f.type === 'number' ? 0 : '')
  })
}

function applyProfileFilters(stocks: Stock[]): Stock[] {
  // Profile filters are handled server-side through query params.
  return stocks
}

function getTableHeaders(screener: string, touched: boolean): string {
  return getColumnKeysForProfile(screener, touched)
    .map((key) => renderSortableHeader(COLUMN_LABELS[key], key, NUMERIC_COLUMNS.has(key) ? 'num' : ''))
    .join('')
}

function renderTradingListBlock(id: string, stocks: Stock[]): string {
  const list = getTradingList(stocks)
  return `
    <div class="tradinglist-wrap">
      <div class="tradinglist-head">
        <span>TradingList View (copy)</span>
        <button onclick="window.copyTradingList('${id}')">Copy</button>
      </div>
      <textarea id="${id}" class="tradinglist-box" readonly>${list}</textarea>
    </div>
  `
}

function render() {
  const app = document.querySelector<HTMLDivElement>('#app')!

  if (error) {
    app.innerHTML = `
      <div class="header">
        <div class="title">🚀 Stock Screener</div>
        <div class="controls">
          <button onclick="window.refresh()">Retry</button>
        </div>
      </div>
      <div class="error">${error}</div>
    `
    return
  }

  if (isLoading && !data) {
    app.innerHTML = `<div class="loading">🔄 Loading screener data...</div>`
    return
  }

  const allStocks = [...(data?.approaching || []), ...(data?.touched || [])]
  const sectors = getUniqueSectors(allStocks)
  const approaching = sortStocks(applyProfileFilters(applyFilters(data?.approaching || [])))
  const touched = sortStocks(applyProfileFilters(applyFilters(data?.touched || [])))
  const sectionLabels = getSectionLabels()
  const profileFilterDefs = getActiveProfileMeta().filters || []
  const visibleNotifications = notifFilter === 'all'
    ? notifications
    : notifications.filter(n => n.kind === notifFilter)
  const primaryCount = notifications.filter(n => n.kind === 'primary').length
  const secondaryCount = notifications.filter(n => n.kind === 'secondary').length
  const notificationsHtml = notifPanelOpen ? `
    <aside class="notif-sidebar">
      <div class="notif-title-row">
        <div class="notif-title">Auto Refresh Updates</div>
        <button class="notif-close-btn" onclick="window.toggleNotifPanel()">×</button>
      </div>
      <div class="notif-toolbar">
        <button class="notif-tab ${notifFilter === 'all' ? 'active' : ''}" onclick="window.setNotifFilter('all')">All (${notifications.length})</button>
        <button class="notif-tab ${notifFilter === 'primary' ? 'active' : ''}" onclick="window.setNotifFilter('primary')">Primary (${primaryCount})</button>
        <button class="notif-tab ${notifFilter === 'secondary' ? 'active' : ''}" onclick="window.setNotifFilter('secondary')">Secondary (${secondaryCount})</button>
      </div>
      <div class="notif-actions">
        <button class="notif-clear-btn" onclick="window.clearNotifications()">Clear</button>
      </div>
      ${visibleNotifications.length === 0
      ? '<div class="notif-empty">No new additions yet.</div>'
      : visibleNotifications.map(n => `
          <div class="notif-item ${n.kind}">
            <div class="notif-time">${n.ts}</div>
            <div class="notif-head">${n.title}</div>
            <div class="notif-detail">${n.detail}</div>
          </div>
        `).join('')}
    </aside>
  ` : `
    <button class="notif-open-btn" onclick="window.toggleNotifPanel()">Updates (${notifications.length})</button>
  `

  const demoBadge = data?.demo_mode ? '<span class="badge">DEMO</span>' : ''
  const screenerChips = screenerOptions.length > 0
    ? screenerOptions.map(s => `
      <button
        class="screener-chip ${activeScreener === s.id ? 'active' : ''}"
        title="${s.description}"
        onclick="window.changeScreener('${s.id}')"
      >
        ${s.label}
      </button>
    `).join('')
    : ''

  app.innerHTML = `
    ${notificationsHtml}
    <div class="screener-nav">
      ${screenerChips}
    </div>

    <div class="header">
      <div>
        <div class="title">🚀 ${(screenerOptions.find(s => s.id === activeScreener)?.label || 'Trending')} Stock Screener ${demoBadge}</div>
        <div class="status">${data?.last_updated ? formatTimestamp(data.last_updated) : ''} | ${data?.provider?.toUpperCase() || ''} | ${data?.mode === 'intraday' ? 'Intraday' : '5D'} | ${(screenerOptions.find(s => s.id === activeScreener)?.label || activeScreener).toUpperCase()} ${isLoading ? '<span class="inline-refresh">Refreshing...</span>' : ''}</div>
      </div>
      <div class="controls">
        <button id="refreshBtn" class="${isLoading ? 'refreshing' : ''}" onclick="window.refresh()">🔄</button>
        <label style="font-size:10px;color:#888;display:flex;align-items:center;gap:4px">
          Auto(s)
          <input
            type="number"
            min="0"
            max="3600"
            step="5"
            value="${autoRefreshSeconds}"
            style="width:56px"
            onchange="window.changeAutoRefresh(this.value)"
          >
        </label>
        <select id="providerSelect" onchange="window.changeProvider(this.value)">
          <option value="upstox" ${data?.provider === 'upstox' ? 'selected' : ''}>Upstox</option>
          <option value="indmoney" ${data?.provider === 'indmoney' ? 'selected' : ''}>INDMONEY</option>
        </select>
        <select id="modeSelect" onchange="window.changeMode(this.value)">
          <option value="intraday" ${data?.mode === 'intraday' ? 'selected' : ''}>Intraday</option>
          <option value="historical" ${data?.mode === 'historical' ? 'selected' : ''}>5D</option>
        </select>
      </div>
    </div>

    <div class="filters">
      <label>Score ≥ <input type="number" id="minScore" value="${filters.minScore}" min="0" max="100" step="5" onchange="window.updateFilter('minScore', this.value)"></label>
      <label>Price ≤ <input type="number" id="maxPrice" value="${filters.maxPrice}" min="100" max="10000" step="100" onchange="window.updateFilter('maxPrice', this.value)"></label>
      <label>Return ≥ <input type="number" id="minReturn" value="${filters.minReturn}" min="-50" max="50" step="1" onchange="window.updateFilter('minReturn', this.value)"></label>
      <label>Sector <select id="sectorFilter" onchange="window.updateFilter('sector', this.value)">
        <option value="">All</option>
        ${sectors.map(s => `<option value="${s}" ${filters.sector === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select></label>
      ${profileFilterDefs.map(f => `
        <label>${f.label} ${f.type === 'select' ? `
          <select onchange="window.updateProfileFilter('${f.key}', this.value)">
            ${(f.options || []).map(opt => `<option value="${opt}" ${profileFilterValues[f.key] === opt ? 'selected' : ''}>${opt}</option>`).join('')}
          </select>
        ` : `
          <input
            type="${f.type === 'number' ? 'number' : 'text'}"
            value="${profileFilterValues[f.key] ?? f.default ?? ''}"
            ${f.min !== undefined ? `min="${f.min}"` : ''}
            ${f.max !== undefined ? `max="${f.max}"` : ''}
            ${f.step !== undefined ? `step="${f.step}"` : ''}
            onchange="window.updateProfileFilter('${f.key}', this.value)"
          >
        `}</label>
      `).join('')}
      <button onclick="window.resetFilters()" style="padding:2px 8px;font-size:10px">Reset</button>
    </div>

    ${data?.summary && data.summary.length > 0 ? `
      <div class="summary-strip">
        ${data.summary.map(item => `<div class="summary-item"><span class="summary-label">${item.label}</span><span class="summary-value">${item.value}</span></div>`).join('')}
      </div>
    ` : ''}

    ${approaching.length > 0 ? `
      <div class="section-title">${sectionLabels.primary} (${approaching.length}${approaching.length < (data?.approaching?.length || 0) ? ` of ${data?.approaching?.length}` : ''})</div>
      <table>
        <thead>
          <tr>
            ${getTableHeaders(activeScreener, false)}
          </tr>
        </thead>
        <tbody>
          ${approaching.map(s => renderStockRow(s, false, activeScreener)).join('')}
        </tbody>
      </table>
      ${renderTradingListBlock('tradingListPrimary', approaching)}
    ` : '<div class="empty">No stocks matching filters</div>'}

    ${touched.length > 0 ? `
      <div class="section-title touched">${sectionLabels.secondary} (${touched.length}${touched.length < (data?.touched?.length || 0) ? ` of ${data?.touched?.length}` : ''})</div>
      <table>
        <thead>
          <tr>
            ${getTableHeaders(activeScreener, true)}
          </tr>
        </thead>
        <tbody>
          ${touched.map(s => renderStockRow(s, true, activeScreener)).join('')}
        </tbody>
      </table>
      ${renderTradingListBlock('tradingListSecondary', touched)}
    ` : ''}

    <div class="footer">
      <div><kbd>R</kbd> Refresh <kbd>M</kbd> Mode <kbd>P</kbd> Provider | Hover row for rationale</div>
      <div>Auto-refresh: ${autoRefreshInterval ? `ON (${autoRefreshSeconds}s)` : 'OFF'}</div>
    </div>
  `
}

function renderStockRow(s: Stock, touched: boolean = false, screener: string = 'trending'): string {
  const scoreClass = s.score >= 80 ? 'score-high' : s.score >= 60 ? 'score-med' : ''
  const brokerClass = Math.abs(s.broker_diff) < 1.0 ? 'green' : 'yellow'
  const to52wClass = s.to_52w_high < 0 ? 'green' : s.to_52w_high > 0.5 ? 'red' : ''
  const returnIcon = s.recent_return_5d > 5 ? '🚀' : s.recent_return_5d > 0 ? '🟢' : '🔴'
  const returnClass = s.recent_return_5d > 0 ? 'green' : 'red'
  const perfClass = s.perf_w > 0 ? 'green' : 'red'
  const rowClass = isRecentlyAdded(s.symbol) ? 'row-new' : ''

  let timeTo52w = '-'
  const rowHint = escapeAttr(s.rationale || '')
  if (!touched && s.time_to_52w) {
    const confIcon = s.time_to_52w.confidence === 'HIGH' ? '🔥' : s.time_to_52w.confidence === 'MED' ? '⚡' : '📍'
    const confClass = s.time_to_52w.confidence === 'HIGH' ? 'conf-high' : s.time_to_52w.confidence === 'MED' ? 'conf-med' : ''
    timeTo52w = `<span class="${confClass}">${s.time_to_52w.days}d ${confIcon}</span>`
  }

  if (screener === 'market_open_gap') {
    const gap = s.gap_pct ?? 0
    const pre = s.premarket_change ?? 0
    const day = s.day_change ?? 0
    return `
      <tr class="${rowClass}" title="${rowHint}">
        <td class="sym">${s.symbol}</td>
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
        <td class="sym">${s.symbol}</td>
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
        <td class="sym">${s.symbol}</td>
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
        <td class="sym">${s.symbol}</td>
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
        <td class="sym">${s.symbol}</td>
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
        <td class="sym">${s.symbol}</td>
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
      <tr class="${rowClass}" title="${rowHint}">
        <td class="sym">${s.symbol}</td>
        <td class="num ${scoreClass}">${s.score}</td>
        <td class="num">${(s.volatility_d ?? 0).toFixed(2)}</td>
        <td class="num">${(s.adx ?? 0).toFixed(1)}</td>
        <td class="num">${(s.rsi ?? 0).toFixed(1)}</td>
        <td class="num ${day >= 0 ? 'green' : 'red'}">${day >= 0 ? '+' : ''}${day.toFixed(2)}%</td>
        <td class="num ${perfClass}">${s.perf_w > 0 ? '+' : ''}${s.perf_w.toFixed(1)}%</td>
        <td class="dim">${s.sector}</td>
      </tr>
    `
  }

  if (screener === 'nifty50_activity') {
    const day = s.day_change ?? 0
    return `
      <tr class="${rowClass}" title="${rowHint}">
        <td class="sym">${s.symbol}</td>
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

  return `
    <tr class="${rowClass}" title="${rowHint}">
      <td class="sym">${s.symbol}</td>
      <td class="num ${scoreClass}">${s.score}</td>
      <td class="num">₹${s.tv_price.toFixed(2)}</td>
      <td class="num">₹${s.upstox_price.toFixed(2)}</td>
      <td class="num ${brokerClass}">${s.broker_diff > 0 ? '+' : ''}${s.broker_diff.toFixed(2)}%</td>
      <td class="num ${to52wClass}">${s.to_52w_high > 0 ? '+' : ''}${s.to_52w_high.toFixed(2)}%</td>
      ${!touched ? `<td class="num">${timeTo52w}</td>` : ''}
      <td class="num ${returnClass}">${returnIcon} ${s.recent_return_5d > 0 ? '+' : ''}${s.recent_return_5d.toFixed(1)}%</td>
      <td class="num ${perfClass}">${s.perf_w > 0 ? '+' : ''}${s.perf_w.toFixed(1)}%</td>
      <td class="dim">${s.sector}</td>
    </tr>
  `
}

async function fetchData(provider = 'upstox', mode = 'intraday', screener = activeScreener, source: 'manual' | 'auto' | 'filter' = 'manual') {
  isLoading = true
  error = null
  const prevData = data

  // Non-blocking refresh: keep existing table visible and just show inline status.
  render()

  try {
    const pfQuery = buildProfileFilterQueryParams(profileFilterValues)
    const suffix = pfQuery ? `&${pfQuery}` : ''
    const res = await fetch(`${API_URL}?provider=${provider}&mode=${mode}&screener=${screener}${suffix}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data = await res.json()
    activeScreener = data?.screener || screener
    const defaultSort = data?.profile_meta?.default_sort
    if (defaultSort?.column) {
      sortColumn = defaultSort.column
      sortDirection = defaultSort.direction || 'desc'
    }
    if (source === 'auto') detectAutoRefreshChanges(prevData, data)
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to fetch'
  } finally {
    isLoading = false
    render()
  }
}

function setupAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval)
    autoRefreshInterval = null
  }
  if (autoRefreshSeconds <= 0) {
    render()
    return
  }
  autoRefreshInterval = setInterval(() => {
    if (data && !isLoading) {
      fetchData(data.provider, data.mode, activeScreener, 'auto')
    }
  }, autoRefreshSeconds * 1000) as unknown as number
  render()
}

async function loadScreeners() {
  try {
    const res = await fetch(SCREENERS_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const payload = await res.json()
    screenerOptions = payload.screeners || []
    activeScreener = payload.default || 'trending'
    profileMetaById = payload.meta_by_id || {}
    initProfileFilters(activeScreener)
  } catch {
    screenerOptions = [
      { id: 'trending', label: 'Trending', description: 'Balanced trend + momentum candidates' },
      { id: 'high_momentum', label: 'High Momentum', description: 'Momentum scanner logic (RSI/MACD/volume)' },
      { id: 'buyer_interest', label: 'Buyer Interest', description: 'Wick close + volume surge buyer pressure' },
      { id: 'buyer_interest_enhanced', label: 'Buyer Interest+', description: 'Enhanced buyer/seller pattern setup' },
      { id: 'volatility_trend', label: 'Volatility Trend', description: 'Volatility with trend confirmation' },
      { id: 'nifty50_activity', label: 'Nifty50 Activity', description: 'Nifty-style activity scoring' },
      { id: 'near_52w_breakout', label: 'Near 52W', description: '52-week high breakout candidate logic' },
      { id: 'rsi_reversal', label: 'RSI Reversal', description: 'Oversold/overbought reversal logic' },
      { id: 'market_open_gap', label: 'Gap Open', description: 'Market open gap scanner logic' },
      { id: 'nifty_movers', label: 'Nifty Movers', description: 'Weighted impact (market-cap × move) logic' }
    ]
    activeScreener = 'trending'
    profileMetaById = {}
    initProfileFilters(activeScreener)
  }
}

;(window as any).refresh = () => fetchData(data?.provider || 'upstox', data?.mode || 'intraday', activeScreener)
;(window as any).changeProvider = (p: string) => fetchData(p, data?.mode || 'intraday', activeScreener)
;(window as any).changeMode = (m: string) => fetchData(data?.provider || 'upstox', m, activeScreener)
;(window as any).changeScreener = (s: string) => {
  activeScreener = s
  initProfileFilters(s)
  fetchData(data?.provider || 'upstox', data?.mode || 'intraday', s)
}
;(window as any).updateFilter = (key: string, value: string) => {
  if (key === 'sector') {
    filters[key] = value
  } else {
    filters[key as keyof Filters] = parseFloat(value)
  }
  render()
}
;(window as any).resetFilters = () => {
  filters = { minScore: 0, maxPrice: 7000, minReturn: -100, sector: '' }
  initProfileFilters(activeScreener)
  render()
}
;(window as any).updateProfileFilter = (key: string, value: string) => {
  const def = (getActiveProfileMeta().filters || []).find(f => f.key === key)
  profileFilterValues[key] = def?.type === 'number' ? parseFloat(value) : value
  fetchData(data?.provider || 'upstox', data?.mode || 'intraday', activeScreener, 'filter')
}
;(window as any).handleSort = (column: string) => handleSort(column)
;(window as any).toggleNotifPanel = () => {
  notifPanelOpen = !notifPanelOpen
  render()
}
;(window as any).setNotifFilter = (value: 'all' | 'primary' | 'secondary') => {
  notifFilter = value
  render()
}
;(window as any).clearNotifications = () => {
  notifications = []
  render()
}
;(window as any).changeAutoRefresh = (secondsRaw: string) => {
  const parsed = Math.max(0, Math.min(3600, parseInt(secondsRaw || '0', 10) || 0))
  autoRefreshSeconds = parsed
  setupAutoRefresh()
}
;(window as any).copyTradingList = async (id: string) => {
  const node = document.getElementById(id) as HTMLTextAreaElement | null
  const text = node?.value || ''
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    node?.select()
    document.execCommand('copy')
  }
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
  if (isLoading) return
  switch(e.key.toLowerCase()) {
    case 'r': (window as any).refresh(); break
    case 'p': {
      const newP = data?.provider === 'upstox' ? 'indmoney' : 'upstox'
      fetchData(newP, data?.mode || 'historical', activeScreener)
      break
    }
    case 'm': {
      const newM = data?.mode === 'historical' ? 'intraday' : 'historical'
      fetchData(data?.provider || 'upstox', newM, activeScreener)
      break
    }
  }
})

// Initial load
loadScreeners().then(() => {
  fetchData(data?.provider || 'upstox', data?.mode || 'intraday', activeScreener)
  setupAutoRefresh()
  render()
})
