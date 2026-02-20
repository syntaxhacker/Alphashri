/**
 * Main entry point for Stock Screener UI
 */

import './style.css'
import { COLUMN_LABELS, COLUMN_TOOLTIPS, NUMERIC_COLUMNS, getColumnKeysForProfile } from './ui_schema'

// State management
import * as state from './state'

// Utilities
import { setRenderCallback } from './utils/notifications'

// API
import { fetchData, loadScreeners, setupAutoRefresh, setRenderCallback as setApiRenderCallback } from './api'

// Components
import { applyFilters, sortStocks, handleSort, renderSortableHeader, getUniqueSectors } from './components/filters'
import { renderStockRow } from './components/table'
import { renderSummaryStrip } from './components/summary'
import { renderTradingListBlock } from './components/tradinglist'
import { getActiveProfileMeta, getSectionLabels, initProfileFilters, applyProfileFilters } from './components/profile'
import {
  renderNotificationsHtml,
  renderScreenerNav,
  renderHeader,
  renderFilters,
  renderFooter
} from './components/header'

function getTableHeaders(screener: string, touched: boolean): string {
  return getColumnKeysForProfile(screener, touched)
    .map((key) => renderSortableHeader(COLUMN_LABELS[key], key, NUMERIC_COLUMNS.has(key) ? 'num' : '', COLUMN_TOOLTIPS[key] || ''))
    .join('')
}

function render() {
  const app = document.querySelector<HTMLDivElement>('#app')!

  if (state.error) {
    app.innerHTML = `
      <div class="header">
        <div class="title">🚀 Stock Screener</div>
        <div class="controls">
          <button onclick="window.refresh()">Retry</button>
        </div>
      </div>
      <div class="error">${state.error}</div>
    `
    return
  }

  const allStocks = [...(state.data?.approaching || []), ...(state.data?.touched || [])]
  const sectors = getUniqueSectors(allStocks)
  const approaching = sortStocks(applyProfileFilters(applyFilters(state.data?.approaching || [])))
  const touched = sortStocks(applyProfileFilters(applyFilters(state.data?.touched || [])))
  const sectionLabels = getSectionLabels()

  // Show loading indicator only when loading AND no data exists (i.e., screener switch)
  // When refreshing same screener, keep showing existing table
  const showLoading = state.isLoading && !state.data

  const tableContent = showLoading
    ? `<div class="loading" data-testid="table-loading">🔄 Loading ${state.activeScreener} data...</div>`
    : `${approaching.length > 0 ? `
      <div class="section-title" data-testid="primary-section-title">${sectionLabels.primary} (${approaching.length}${approaching.length < (state.data?.approaching?.length || 0) ? ` of ${state.data?.approaching?.length}` : ''})</div>
      <table data-testid="stocks-table">
        <thead>
          <tr>
            ${getTableHeaders(state.activeScreener, false)}
          </tr>
        </thead>
        <tbody data-testid="stocks-tbody">
          ${approaching.map(s => renderStockRow(s, false, state.activeScreener)).join('')}
        </tbody>
      </table>
      ${renderTradingListBlock('tradingListPrimary', approaching)}
    ` : '<div class="empty" data-testid="empty-state">No stocks matching filters</div>'}
    ${touched.length > 0 ? `
      <div class="section-title touched" data-testid="secondary-section-title">${sectionLabels.secondary} (${touched.length}${touched.length < (state.data?.touched?.length || 0) ? ` of ${state.data?.touched?.length}` : ''})</div>
      <table data-testid="touched-table">
        <thead>
          <tr>
            ${getTableHeaders(state.activeScreener, true)}
          </tr>
        </thead>
        <tbody data-testid="touched-tbody">
          ${touched.map(s => renderStockRow(s, true, state.activeScreener)).join('')}
        </tbody>
      </table>
      ${renderTradingListBlock('tradingListSecondary', touched)}
    ` : ''}`

  app.innerHTML = `
    ${renderNotificationsHtml()}
    ${renderScreenerNav()}
    ${renderHeader()}
    ${renderFilters(sectors)}
    ${state.data?.summary && state.data.summary.length > 0 ? renderSummaryStrip(state.data.summary) : ''}
    ${tableContent}
    ${renderFooter()}
  `
}

// Set render callback for modules that need to trigger re-renders
setRenderCallback(render)
setApiRenderCallback(render)

// Window-exposed functions for onclick handlers
;(window as any).refresh = () => fetchData(state.data?.provider || 'upstox', state.data?.mode || 'intraday', state.activeScreener)
;(window as any).changeProvider = (p: string) => fetchData(p, state.data?.mode || 'intraday', state.activeScreener)
;(window as any).changeMode = (m: string) => fetchData(state.data?.provider || 'upstox', m, state.activeScreener)
;(window as any).changeScreener = (s: string) => {
  state.setActiveScreener(s)
  initProfileFilters(s)
  fetchData(state.data?.provider || 'upstox', state.data?.mode || 'intraday', s)
}
;(window as any).updateFilter = (key: string, value: string) => {
  if (key === 'sector') {
    state.updateFilter(key as keyof typeof state.filters, value)
  } else {
    state.updateFilter(key as keyof typeof state.filters, parseFloat(value))
  }
  render()
}
;(window as any).resetFilters = () => {
  state.resetFilters()
  initProfileFilters(state.activeScreener)
  render()
}
;(window as any).updateProfileFilter = (key: string, value: string) => {
  const meta = getActiveProfileMeta()
  const def = (meta.filters || []).find(f => f.key === key)
  state.updateProfileFilterValue(key, def?.type === 'number' ? parseFloat(value) : value)
  fetchData(state.data?.provider || 'upstox', state.data?.mode || 'intraday', state.activeScreener, 'filter')
}
;(window as any).handleSort = (column: string) => {
  handleSort(column)
  render()
}
;(window as any).toggleNotifPanel = () => {
  state.setNotifPanelOpen(!state.notifPanelOpen)
  render()
}
;(window as any).setNotifFilter = (value: 'all' | 'primary' | 'secondary') => {
  state.setNotifFilter(value)
  render()
}
;(window as any).clearNotifications = () => {
  state.clearNotifications()
  render()
}
;(window as any).changeAutoRefresh = (secondsRaw: string) => {
  const parsed = Math.max(0, Math.min(3600, parseInt(secondsRaw || '0', 10) || 0))
  state.setAutoRefreshSeconds(parsed)
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
  if (state.isLoading) return
  switch(e.key.toLowerCase()) {
    case 'r': (window as any).refresh(); break
    case 'p': {
      const newP = state.data?.provider === 'upstox' ? 'indmoney' : 'upstox'
      fetchData(newP, state.data?.mode || 'historical', state.activeScreener)
      break
    }
    case 'm': {
      const newM = state.data?.mode === 'historical' ? 'intraday' : 'historical'
      fetchData(state.data?.provider || 'upstox', newM, state.activeScreener)
      break
    }
  }
})

// Initial load
loadScreeners(initProfileFilters).then(() => {
  fetchData(state.data?.provider || 'upstox', state.data?.mode || 'intraday', state.activeScreener)
  setupAutoRefresh()
  render()
})
