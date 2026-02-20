/**
 * API module for data fetching
 */

import type { ScreenerData, ScreenerOption } from '../types'
import { API_URL, SCREENERS_URL } from '../constants'
import * as state from '../state'
import { buildProfileFilterQueryParams, detectAddedSymbols } from '../runtime_utils'
import { pushNotification, markNewSymbols } from '../utils/notifications'

// Render callback - set by notifications module
let renderCallback: () => void = () => {}

export function setRenderCallback(cb: () => void) {
  renderCallback = cb
}

// Default screener options (fallback)
const DEFAULT_SCREENER_OPTIONS: ScreenerOption[] = [
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

function detectAutoRefreshChanges(prev: ScreenerData | null, next: ScreenerData | null) {
  const { addedPrimary, addedSecondary } = detectAddedSymbols(prev, next)
  if (addedPrimary.length === 0 && addedSecondary.length === 0) return

  const screenLabel = state.screenerOptions.find(s => s.id === next?.screener)?.label || next?.screener || ''
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

export type FetchSource = 'manual' | 'auto' | 'filter'

export async function fetchData(
  provider = 'upstox',
  mode = 'intraday',
  screener = state.activeScreener,
  source: FetchSource = 'manual'
) {
  state.setIsLoading(true)
  state.setError(null)
  const prevData = state.data

  // Non-blocking refresh: keep existing table visible and just show inline status.
  renderCallback()

  try {
    const pfQuery = buildProfileFilterQueryParams(state.profileFilterValues)
    const suffix = pfQuery ? `&${pfQuery}` : ''
    const res = await fetch(`${API_URL}?provider=${provider}&mode=${mode}&screener=${screener}${suffix}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    state.setData(data)
    state.setActiveScreener(data?.screener || screener)

    const defaultSort = data?.profile_meta?.default_sort
    if (defaultSort?.column) {
      state.setSortColumn(defaultSort.column)
      state.setSortDirection(defaultSort.direction || 'desc')
    }

    if (source === 'auto') detectAutoRefreshChanges(prevData, data)
  } catch (e) {
    state.setError(e instanceof Error ? e.message : 'Failed to fetch')
  } finally {
    state.setIsLoading(false)
    renderCallback()
  }
}

export async function loadScreeners(initProfileFilters: (screener: string) => void) {
  try {
    const res = await fetch(SCREENERS_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const payload = await res.json()
    state.setScreenerOptions(payload.screeners || [])
    state.setActiveScreener(payload.default || 'trending')
    state.setProfileMetaById(payload.meta_by_id || {})
    initProfileFilters(state.activeScreener)
  } catch {
    state.setScreenerOptions(DEFAULT_SCREENER_OPTIONS)
    state.setActiveScreener('trending')
    state.setProfileMetaById({})
    initProfileFilters(state.activeScreener)
  }
}

export function setupAutoRefresh() {
  if (state.autoRefreshInterval) {
    clearInterval(state.autoRefreshInterval)
    state.setAutoRefreshInterval(null)
  }
  if (state.autoRefreshSeconds <= 0) {
    renderCallback()
    return
  }
  const interval = setInterval(() => {
    if (state.data && !state.isLoading) {
      fetchData(state.data.provider, state.data.mode, state.activeScreener, 'auto')
    }
  }, state.autoRefreshSeconds * 1000)
  state.setAutoRefreshInterval(interval)
  renderCallback()
}
