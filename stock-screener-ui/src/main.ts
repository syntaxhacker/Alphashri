import './style.css'

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
}

interface ScreenerData {
  approaching: Stock[]
  touched: Stock[]
  last_updated: string
  provider: string
  mode: string
  demo_mode?: boolean
}

interface Filters {
  minScore: number
  maxPrice: number
  minReturn: number
  sector: string
}

let data: ScreenerData | null = null
let isLoading = false
let error: string | null = null
let autoRefreshInterval: number | null = null
let filters: Filters = { minScore: 0, maxPrice: 7000, minReturn: -100, sector: '' }
let sortColumn: string | null = null
let sortDirection: 'asc' | 'desc' = 'desc'

const API_URL = 'http://localhost:8765/api/screener'

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

function showOverlay(message: string = 'Loading...') {
  const existing = document.querySelector('.loading-overlay')
  if (existing) existing.remove()

  const overlay = document.createElement('div')
  overlay.className = 'loading-overlay overlay'
  overlay.innerHTML = `
    <div style="display:flex;align-items:center">
      <div class="spinner"></div>
      <span class="loading-text">${message}</span>
    </div>
  `
  document.body.appendChild(overlay)
}

function hideOverlay() {
  const overlay = document.querySelector('.loading-overlay')
  if (overlay) overlay.remove()
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
  const approaching = sortStocks(applyFilters(data?.approaching || []))
  const touched = sortStocks(applyFilters(data?.touched || []))

  const demoBadge = data?.demo_mode ? '<span class="badge">DEMO</span>' : ''

  app.innerHTML = `
    <div class="header">
      <div>
        <div class="title">🚀 Trending Stock Screener ${demoBadge}</div>
        <div class="status">${data?.last_updated ? formatTimestamp(data.last_updated) : ''} | ${data?.provider?.toUpperCase() || ''} | ${data?.mode === 'intraday' ? 'Intraday' : '5D'}</div>
      </div>
      <div class="controls">
        <button id="refreshBtn" class="${isLoading ? 'refreshing' : ''}" onclick="window.refresh()">🔄</button>
        <select id="providerSelect" onchange="window.changeProvider(this.value)" ${isLoading ? 'disabled' : ''}>
          <option value="upstox" ${data?.provider === 'upstox' ? 'selected' : ''}>Upstox</option>
          <option value="indmoney" ${data?.provider === 'indmoney' ? 'selected' : ''}>INDMONEY</option>
        </select>
        <select id="modeSelect" onchange="window.changeMode(this.value)" ${isLoading ? 'disabled' : ''}>
          <option value="historical" ${data?.mode === 'historical' ? 'selected' : ''}>5D</option>
          <option value="intraday" ${data?.mode === 'intraday' ? 'selected' : ''}>Intraday</option>
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
      <button onclick="window.resetFilters()" style="padding:2px 8px;font-size:10px">Reset</button>
    </div>

    ${approaching.length > 0 ? `
      <div class="section-title">🎯 APPROACHING 52W HIGH (${approaching.length}${approaching.length < (data?.approaching?.length || 0) ? ` of ${data?.approaching?.length}` : ''})</div>
      <table>
        <thead>
          <tr>
            ${renderSortableHeader('Symbol', 'symbol')}
            ${renderSortableHeader('Score', 'score', 'num')}
            ${renderSortableHeader('TV Price', 'tv_price', 'num')}
            ${renderSortableHeader('Upstox', 'upstox_price', 'num')}
            ${renderSortableHeader('Broker Diff', 'broker_diff', 'num')}
            ${renderSortableHeader('To 52W High', 'to_52w_high', 'num')}
            ${renderSortableHeader('Time to 52W', 'time_to_52w', 'num')}
            ${renderSortableHeader('5D Return', 'recent_return_5d', 'num')}
            ${renderSortableHeader('Perf.W', 'perf_w', 'num')}
            ${renderSortableHeader('Sector', 'sector')}
          </tr>
        </thead>
        <tbody>
          ${approaching.map(s => renderStockRow(s)).join('')}
        </tbody>
      </table>
    ` : '<div class="empty">No stocks matching filters</div>'}

    ${touched.length > 0 ? `
      <div class="section-title touched">✅ ALREADY TOUCHED 52W HIGH (${touched.length}${touched.length < (data?.touched?.length || 0) ? ` of ${data?.touched?.length}` : ''})</div>
      <table>
        <thead>
          <tr>
            ${renderSortableHeader('Symbol', 'symbol')}
            ${renderSortableHeader('Score', 'score', 'num')}
            ${renderSortableHeader('TV Price', 'tv_price', 'num')}
            ${renderSortableHeader('Upstox', 'upstox_price', 'num')}
            ${renderSortableHeader('Broker Diff', 'broker_diff', 'num')}
            ${renderSortableHeader('To 52W High', 'to_52w_high', 'num')}
            ${renderSortableHeader('5D Return', 'recent_return_5d', 'num')}
            ${renderSortableHeader('Perf.W', 'perf_w', 'num')}
            ${renderSortableHeader('Sector', 'sector')}
          </tr>
        </thead>
        <tbody>
          ${touched.map(s => renderStockRow(s, true)).join('')}
        </tbody>
      </table>
    ` : ''}

    <div class="footer">
      <div><kbd>R</kbd> Refresh <kbd>M</kbd> Mode <kbd>P</kbd> Provider</div>
      <div>Auto-refresh: ${autoRefreshInterval ? 'ON (30s)' : 'OFF'}</div>
    </div>
  `
}

function renderStockRow(s: Stock, touched: boolean = false): string {
  const scoreClass = s.score >= 80 ? 'score-high' : s.score >= 60 ? 'score-med' : ''
  const brokerClass = Math.abs(s.broker_diff) < 1.0 ? 'green' : 'yellow'
  const to52wClass = s.to_52w_high < 0 ? 'green' : s.to_52w_high > 0.5 ? 'red' : ''
  const returnIcon = s.recent_return_5d > 5 ? '🚀' : s.recent_return_5d > 0 ? '🟢' : '🔴'
  const returnClass = s.recent_return_5d > 0 ? 'green' : 'red'
  const perfClass = s.perf_w > 0 ? 'green' : 'red'

  let timeTo52w = '-'
  if (!touched && s.time_to_52w) {
    const confIcon = s.time_to_52w.confidence === 'HIGH' ? '🔥' : s.time_to_52w.confidence === 'MED' ? '⚡' : '📍'
    const confClass = s.time_to_52w.confidence === 'HIGH' ? 'conf-high' : s.time_to_52w.confidence === 'MED' ? 'conf-med' : ''
    timeTo52w = `<span class="${confClass}">${s.time_to_52w.days}d ${confIcon}</span>`
  }

  return `
    <tr>
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

async function fetchData(provider = 'upstox', mode = 'historical') {
  isLoading = true
  error = null

  // Show overlay if we have existing data (refresh scenario)
  if (data) {
    showOverlay('Fetching latest data...')
  } else {
    render()
  }

  try {
    const res = await fetch(`${API_URL}?provider=${provider}&mode=${mode}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data = await res.json()
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to fetch'
  } finally {
    isLoading = false
    hideOverlay()
    render()
  }
}

;(window as any).refresh = () => fetchData(data?.provider || 'upstox', data?.mode || 'historical')
;(window as any).changeProvider = (p: string) => fetchData(p, data?.mode || 'historical')
;(window as any).changeMode = (m: string) => fetchData(data?.provider || 'upstox', m)
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
  render()
}
;(window as any).handleSort = (column: string) => handleSort(column)

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
  if (isLoading) return
  switch(e.key.toLowerCase()) {
    case 'r': (window as any).refresh(); break
    case 'p': {
      const newP = data?.provider === 'upstox' ? 'indmoney' : 'upstox'
      fetchData(newP, data?.mode || 'historical')
      break
    }
    case 'm': {
      const newM = data?.mode === 'historical' ? 'intraday' : 'historical'
      fetchData(data?.provider || 'upstox', newM)
      break
    }
  }
})

// Initial load
fetchData()
render()

// Auto-refresh every 30s
autoRefreshInterval = setInterval(() => {
  if (data && !isLoading) {
    fetchData(data.provider, data.mode)
  }
}, 30000) as unknown as number
