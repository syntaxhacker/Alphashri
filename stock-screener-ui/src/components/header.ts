/**
 * Header component utilities
 */

import * as state from '../state'
import { formatTimestamp } from '../utils/format'

export function renderNotificationsHtml(): string {
  const visibleNotifications = state.notifFilter === 'all'
    ? state.notifications
    : state.notifications.filter(n => n.kind === state.notifFilter)
  const primaryCount = state.notifications.filter(n => n.kind === 'primary').length
  const secondaryCount = state.notifications.filter(n => n.kind === 'secondary').length

  if (state.notifPanelOpen) {
    return `
      <aside class="notif-sidebar">
        <div class="notif-title-row">
          <div class="notif-title">Auto Refresh Updates</div>
          <button class="notif-close-btn" onclick="window.toggleNotifPanel()">×</button>
        </div>
        <div class="notif-toolbar">
          <button class="notif-tab ${state.notifFilter === 'all' ? 'active' : ''}" onclick="window.setNotifFilter('all')">All (${state.notifications.length})</button>
          <button class="notif-tab ${state.notifFilter === 'primary' ? 'active' : ''}" onclick="window.setNotifFilter('primary')">Primary (${primaryCount})</button>
          <button class="notif-tab ${state.notifFilter === 'secondary' ? 'active' : ''}" onclick="window.setNotifFilter('secondary')">Secondary (${secondaryCount})</button>
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
    `
  }
  return `
    <button class="notif-open-btn" onclick="window.toggleNotifPanel()">Updates (${state.notifications.length})</button>
  `
}

export function renderScreenerNav(): string {
  if (state.screenerOptions.length === 0) return ''

  return `
    <div class="screener-nav" data-testid="screener-nav">
      ${state.screenerOptions.map(s => `
        <button
          class="screener-chip ${state.activeScreener === s.id ? 'active' : ''}"
          data-testid="screener-tab"
          data-screener="${s.id}"
          title="${s.description}"
          onclick="window.changeScreener('${s.id}')"
        >
          ${s.label}
        </button>
      `).join('')}
    </div>
  `
}

export function renderHeader(): string {
  const demoBadge = state.data?.demo_mode ? '<span class="badge">DEMO</span>' : ''
  const screenerLabel = state.screenerOptions.find(s => s.id === state.activeScreener)?.label || 'Trending'

  return `
    <div class="header" data-testid="header">
      <div>
        <div class="title" data-testid="screener-title">🚀 ${screenerLabel} Stock Screener ${demoBadge}</div>
        <div class="status" data-testid="status">${state.data?.last_updated ? formatTimestamp(state.data.last_updated) : ''} | ${state.data?.provider?.toUpperCase() || ''} | ${state.data?.mode === 'intraday' ? 'Intraday' : '5D'} | ${(screenerLabel).toUpperCase()} ${state.isLoading ? '<span class="inline-refresh">Refreshing...</span>' : ''}</div>
      </div>
      <div class="controls">
        <button id="refreshBtn" data-testid="refresh-btn" class="${state.isLoading ? 'refreshing' : ''}" onclick="window.refresh()">🔄</button>
        <label style="font-size:10px;color:#888;display:flex;align-items:center;gap:4px">
          Auto(s)
          <input
            type="number"
            data-testid="auto-refresh-input"
            min="0"
            max="3600"
            step="5"
            value="${state.autoRefreshSeconds}"
            style="width:56px"
            onchange="window.changeAutoRefresh(this.value)"
          >
        </label>
        <select id="providerSelect" data-testid="provider-select" onchange="window.changeProvider(this.value)">
          <option value="upstox" ${state.data?.provider === 'upstox' ? 'selected' : ''}>Upstox</option>
          <option value="indmoney" ${state.data?.provider === 'indmoney' ? 'selected' : ''}>INDMONEY</option>
        </select>
        <select id="modeSelect" data-testid="mode-select" onchange="window.changeMode(this.value)">
          <option value="intraday" ${state.data?.mode === 'intraday' ? 'selected' : ''}>Intraday</option>
          <option value="historical" ${state.data?.mode === 'historical' ? 'selected' : ''}>5D</option>
        </select>
      </div>
    </div>
  `
}

export function renderFilters(sectors: string[]): string {
  const profileFilterDefs = (state.profileMetaById[state.activeScreener]?.filters) || []

  return `
    <div class="filters" data-testid="filters">
      <label>Score ≥ <input type="number" id="minScore" data-testid="min-score-input" value="${state.filters.minScore}" min="0" max="100" step="5" onchange="window.updateFilter('minScore', this.value)"></label>
      <label>Price ≤ <input type="number" id="maxPrice" data-testid="max-price-input" value="${state.filters.maxPrice}" min="100" max="10000" step="100" onchange="window.updateFilter('maxPrice', this.value)"></label>
      <label>Return ≥ <input type="number" id="minReturn" data-testid="min-return-input" value="${state.filters.minReturn}" min="-50" max="50" step="1" onchange="window.updateFilter('minReturn', this.value)"></label>
      <label>Sector <select id="sectorFilter" data-testid="sector-select" onchange="window.updateFilter('sector', this.value)">
        <option value="">All</option>
        ${sectors.map(s => `<option value="${s}" ${state.filters.sector === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select></label>
      ${profileFilterDefs.map(f => `
        <label>${f.label} ${f.type === 'select' ? `
          <select data-testid="profile-filter-${f.key}" onchange="window.updateProfileFilter('${f.key}', this.value)">
            ${(f.options || []).map(opt => `<option value="${opt}" ${state.profileFilterValues[f.key] === opt ? 'selected' : ''}>${opt}</option>`).join('')}
          </select>
        ` : `
          <input
            type="${f.type === 'number' ? 'number' : 'text'}"
            data-testid="profile-filter-${f.key}"
            value="${state.profileFilterValues[f.key] ?? f.default ?? ''}"
            ${f.min !== undefined ? `min="${f.min}"` : ''}
            ${f.max !== undefined ? `max="${f.max}"` : ''}
            ${f.step !== undefined ? `step="${f.step}"` : ''}
            onchange="window.updateProfileFilter('${f.key}', this.value)"
          >
        `}</label>
      `).join('')}
      <button data-testid="reset-filters-btn" onclick="window.resetFilters()" style="padding:2px 8px;font-size:10px">Reset</button>
    </div>
  `
}

export function renderFooter(): string {
  return `
    <div class="footer" data-testid="footer">
      <div><kbd>R</kbd> Refresh <kbd>M</kbd> Mode <kbd>P</kbd> Provider | Hover row for rationale</div>
      <div data-testid="auto-refresh-status">Auto-refresh: ${state.autoRefreshInterval ? `ON (${state.autoRefreshSeconds}s)` : 'OFF'}</div>
    </div>
  `
}
