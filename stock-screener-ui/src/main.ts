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
}

let data: ScreenerData | null = null
let isLoading = false
let error: string | null = null
let autoRefreshInterval: number | null = null

const API_URL = 'http://localhost:8765/api/screener'

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

  const approaching = data?.approaching || []
  const touched = data?.touched || []

  app.innerHTML = `
    <div class="header">
      <div>
        <div class="title">🚀 Trending Stock Screener</div>
        <div class="status">${data?.last_updated || ''} | ${data?.provider || ''} | ${data?.mode || ''}</div>
      </div>
      <div class="controls">
        <button id="refreshBtn" class="${isLoading ? 'refreshing' : ''}" onclick="window.refresh()">🔄 Refresh</button>
        <select id="providerSelect" onchange="window.changeProvider(this.value)" style="background:#1a1a1a;border:1px solid #333;color:#e0e0e0;padding:4px;font:11px monospace;" ${isLoading ? 'disabled' : ''}>
          <option value="upstox" ${data?.provider === 'upstox' ? 'selected' : ''}>Upstox</option>
          <option value="indmoney" ${data?.provider === 'indmoney' ? 'selected' : ''}>INDMONEY</option>
        </select>
        <select id="modeSelect" onchange="window.changeMode(this.value)" style="background:#1a1a1a;border:1px solid #333;color:#e0e0e0;padding:4px;font:11px monospace;" ${isLoading ? 'disabled' : ''}>
          <option value="historical" ${data?.mode === 'historical' ? 'selected' : ''}>5D</option>
          <option value="intraday" ${data?.mode === 'intraday' ? 'selected' : ''}>Intraday</option>
        </select>
      </div>
    </div>

    ${approaching.length > 0 ? `
      <div class="section-title">🎯 APPROACHING 52W HIGH (${approaching.length} stocks, &lt; ₹7000)</div>
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th class="num">Score</th>
            <th class="num">TV Price</th>
            <th class="num">Upstox</th>
            <th class="num">Broker Diff</th>
            <th class="num">To 52W High</th>
            <th class="num">Time to 52W</th>
            <th class="num">5D Return</th>
            <th>Perf.W</th>
            <th>Sector</th>
          </tr>
        </thead>
        <tbody>
          ${approaching.map(s => renderStockRow(s)).join('')}
        </tbody>
      </table>
    ` : '<div class="empty">No stocks approaching 52W high</div>'}

    ${touched.length > 0 ? `
      <div class="section-title touched">✅ ALREADY TOUCHED 52W HIGH (${touched.length} stocks)</div>
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th class="num">Score</th>
            <th class="num">TV Price</th>
            <th class="num">Upstox</th>
            <th class="num">Broker Diff</th>
            <th class="num">To 52W High</th>
            <th class="num">5D Return</th>
            <th>Perf.W</th>
            <th>Sector</th>
          </tr>
        </thead>
        <tbody>
          ${touched.map(s => renderStockRow(s, true)).join('')}
        </tbody>
      </table>
    ` : ''}

    <div class="footer">
      <div><kbd>R</kbd> Refresh <kbd>S</kbd> Sort <kbd>M</kbd> Mode <kbd>P</kbd> Provider</div>
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
