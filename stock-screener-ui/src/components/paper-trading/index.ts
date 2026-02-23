/**
 * Paper Trading View Component
 *
 * Main paper trading view with Live Positions and Trade History tabs.
 */

import { renderPositionsPanel, initPositionsHandlers } from './positions'
import { renderHistoryPanel, initHistoryHandlers } from './history'
import { renderChartContainer, initChartHandlers } from './chart'
import {
  getPaperTradingState,
  setPaperTradingView,
  setFilterDate,
  setFilterSymbol,
  setError,
} from '../../state/paperTrading'
import { refreshLiveData, refreshHistoryData, initLiveAutoRefresh, stopLiveAutoRefresh } from '../../api/paperTrading'
import type { PaperTradingView } from '../../types/paperTrading'

export function renderPaperTradingView(): string {
  const state = getPaperTradingState()

  return `
    <div class="paper-trading-view" data-testid="paper-trading-view">
      <!-- Header with tabs -->
      <div class="paper-header">
        <div class="paper-tabs">
          <button
            class="paper-tab ${state.currentView === 'live' ? 'active' : ''}"
            onclick="window.setPaperView('live')"
          >
            <span class="tab-icon">📡</span>
            Live Positions
            ${state.positions.length > 0 ? `<span class="tab-badge">${state.positions.length}</span>` : ''}
          </button>
          <button
            class="paper-tab ${state.currentView === 'history' ? 'active' : ''}"
            onclick="window.setPaperView('history')"
          >
            <span class="tab-icon">📋</span>
            Trade History
            ${state.trades.length > 0 ? `<span class="tab-badge">${state.trades.length}</span>` : ''}
          </button>
        </div>
        <div class="paper-filters">
          ${renderFilters(state)}
        </div>
      </div>

      <!-- Main Content: Table Left, Chart Right -->
      <div class="paper-main">
        <!-- Left: Positions or History Table -->
        <div class="paper-left">
          ${state.currentView === 'live'
            ? renderPositionsPanel()
            : renderHistoryPanel()
          }
        </div>

        <!-- Right: Chart -->
        <div class="paper-right">
          ${renderChartContainer()}
        </div>
      </div>

      ${state.error ? `
        <div class="paper-error" data-testid="paper-error">
          <p>❌ ${state.error}</p>
          <button class="btn btn-secondary" onclick="window.clearPaperError()">Dismiss</button>
        </div>
      ` : ''}
    </div>
  `
}

function renderFilters(state: ReturnType<typeof getPaperTradingState>): string {
  if (state.currentView === 'live') {
    // Live view only needs auto-refresh toggle
    return `
      <div class="filter-group">
        <label class="checkbox-label">
          <input
            type="checkbox"
            ${state.autoRefreshEnabled ? 'checked' : ''}
            onchange="window.toggleAutoRefresh(this.checked)"
          />
          Auto-refresh (20s)
        </label>
      </div>
    `
  }

  // History view needs date and symbol filters
  // Get unique symbols from trades
  const symbols = [...new Set(state.trades.map(t => t.symbol))].sort()

  return `
    <div class="filter-group">
      <label>Date:</label>
      <select onchange="window.setPaperDateFilter(this.value)" class="filter-select">
        <option value="">Today</option>
        <option value="yesterday">Yesterday</option>
        <option value="week">This Week</option>
        <option value="all">All Time</option>
      </select>
    </div>
    <div class="filter-group">
      <label>Symbol:</label>
      <select onchange="window.setPaperSymbolFilter(this.value)" class="filter-select">
        <option value="">All Symbols</option>
        ${symbols.map(s => `
          <option value="${s}" ${state.filterSymbol === s ? 'selected' : ''}>${s}</option>
        `).join('')}
      </select>
    </div>
  `
}

// Initialize all paper trading handlers
export function initPaperTradingHandlers() {
  initPositionsHandlers()
  initHistoryHandlers()
  initChartHandlers()

  // View switching
  ;(window as any).setPaperView = (view: PaperTradingView) => {
    setPaperTradingView(view)
    if (view === 'live') {
      initLiveAutoRefresh()
      refreshLiveData()
    } else {
      stopLiveAutoRefresh()
      refreshHistoryData()
    }
  }

  // Filter handlers
  ;(window as any).setPaperDateFilter = (value: string) => {
    setFilterDate(value || null)
    refreshHistoryData()
  }

  ;(window as any).setPaperSymbolFilter = (value: string) => {
    setFilterSymbol(value || null)
  }

  ;(window as any).toggleAutoRefresh = (enabled: boolean) => {
    if (enabled) {
      initLiveAutoRefresh()
    } else {
      stopLiveAutoRefresh()
    }
  }

  ;(window as any).clearPaperError = () => {
    setError(null)
  }

  // Initial data load
  refreshLiveData()
  initLiveAutoRefresh()
}

// Clean up when switching views
export function cleanupPaperTrading() {
  stopLiveAutoRefresh()
}
