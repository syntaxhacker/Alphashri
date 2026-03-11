/**
 * Header component utilities
 */

import * as state from "../state";
import { formatTimestamp } from "../utils/format";

export function renderNotificationsHtml(): string {
  const visibleNotifications =
    state.notifFilter === "all"
      ? state.notifications
      : state.notifications.filter((n) => n.kind === state.notifFilter);
  const primaryCount = state.notifications.filter((n) => n.kind === "primary").length;
  const secondaryCount = state.notifications.filter((n) => n.kind === "secondary").length;

  if (!state.notifPanelOpen) return "";

  return `
    <aside class="notif-sidebar">
      <div class="notif-title-row">
        <div class="notif-title">Auto Refresh Updates</div>
        <button class="notif-close-btn" onclick="window.toggleNotifPanel()">×</button>
      </div>
      <div class="notif-toolbar">
        <button class="notif-tab ${state.notifFilter === "all" ? "active" : ""}" onclick="window.setNotifFilter('all')">All (${state.notifications.length})</button>
        <button class="notif-tab ${state.notifFilter === "primary" ? "active" : ""}" onclick="window.setNotifFilter('primary')">Primary (${primaryCount})</button>
        <button class="notif-tab ${state.notifFilter === "secondary" ? "active" : ""}" onclick="window.setNotifFilter('secondary')">Secondary (${secondaryCount})</button>
      </div>
      <div class="notif-actions">
        <button class="notif-clear-btn" onclick="window.clearNotifications()">Clear</button>
      </div>
      ${
        visibleNotifications.length === 0
          ? '<div class="notif-empty">No new additions yet.</div>'
          : visibleNotifications
              .map(
                (n) => `
          <div class="notif-item ${n.kind}">
            <div class="notif-time">${n.ts}</div>
            <div class="notif-head">${n.title}</div>
            <div class="notif-detail">${n.detail}</div>
          </div>
        `,
              )
              .join("")
      }
    </aside>
  `;
}

export function renderNotificationsButton(): string {
  return `
    <button class="notif-open-btn" onclick="window.toggleNotifPanel()">Updates (${state.notifications.length})</button>
  `;
}

export function renderScreenerNav(): string {
  if (state.screenerOptions.length === 0) return "";

  return `
    <div class="screener-nav" data-testid="screener-nav">
      ${state.screenerOptions
        .map(
          (s) => `
        <button
          class="screener-chip ${state.activeScreener === s.id ? "active" : ""}"
          data-testid="screener-tab"
          data-screener="${s.id}"
          title="${s.description}"
          onclick="window.changeScreener('${s.id}')"
        >
          ${s.label}
        </button>
      `,
        )
        .join("")}
    </div>
  `;
}

export function renderHeader(): string {
  const demoBadge = state.data?.demo_mode ? '<span class="badge">DEMO</span>' : "";
  const screenerLabel =
    state.screenerOptions.find((s) => s.id === state.activeScreener)?.label || "Trending";

  return `
    <div class="header" data-testid="header">
      <div>
        <div class="title" data-testid="screener-title">🚀 ${screenerLabel} | Alphashri ${demoBadge}</div>
        <div class="status" data-testid="status">${state.data?.last_updated ? formatTimestamp(state.data.last_updated) : ""} | ${state.data?.provider?.toUpperCase() || ""} | ${state.data?.mode === "intraday" ? "Intraday" : "5D"} | ${screenerLabel.toUpperCase()} ${state.isLoading ? '<span class="inline-refresh">Refreshing...</span>' : ""}</div>
      </div>
      <div class="controls">
        <button id="refreshBtn" data-testid="refresh-btn" class="${state.isLoading ? "refreshing" : ""}" onclick="window.refresh()">🔄</button>
        ${renderNotificationsButton()}
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
          <option value="upstox" ${state.data?.provider === "upstox" ? "selected" : ""}>Upstox</option>
          <option value="indmoney" ${state.data?.provider === "indmoney" ? "selected" : ""}>INDMONEY</option>
        </select>
        <select id="modeSelect" data-testid="mode-select" onchange="window.changeMode(this.value)">
          <option value="intraday" ${state.data?.mode === "intraday" ? "selected" : ""}>Intraday</option>
          <option value="historical" ${state.data?.mode === "historical" ? "selected" : ""}>5D</option>
        </select>
      </div>
    </div>
  `;
}

export function renderFooter(): string {
  return `
    <div class="footer" data-testid="footer">
      <div><kbd>R</kbd> Refresh <kbd>M</kbd> Mode <kbd>P</kbd> Provider | Hover row for rationale</div>
      <div data-testid="auto-refresh-status">Auto-refresh: ${state.autoRefreshInterval ? `ON (${state.autoRefreshSeconds}s)` : "OFF"}</div>
    </div>
  `;
}
