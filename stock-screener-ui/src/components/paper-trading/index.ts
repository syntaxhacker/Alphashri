/**
 * Paper Trading View Component
 *
 * Main paper trading view with Live Positions, Trade History, and Settings tabs.
 */

import { renderPositionsPanel, initPositionsHandlers } from "./positions";
import { renderHistoryPanel, initHistoryHandlers } from "./history";
import { renderChartContainer, initChartHandlers } from "./chart";
import { renderSettingsPanel, initSettingsHandlers } from "./settings";
import {
  getPaperTradingState,
  setPaperTradingView,
  setFilterFromDate,
  setFilterToDate,
  setFilterSymbol,
  setFilterStrategy,
  setError,
} from "../../state/paperTrading";
import {
  refreshLiveData,
  refreshHistoryData,
  initLiveAutoRefresh,
  stopLiveAutoRefresh,
  startPaperBot,
  stopPaperBot,
  fetchPaperBotStatus,
  fetchStrategyConfig,
} from "../../api/paperTrading";
import type { PaperTradingView } from "../../types/paperTrading";

let paperTradingActive = false;

export function renderPaperTradingView(): string {
  const state = getPaperTradingState();

  return `
    <div class="paper-trading-view" data-testid="paper-trading-view">
      <!-- Header with tabs -->
      <div class="paper-header">
        <div class="paper-tabs">
          <button
            class="paper-tab ${state.currentView === "live" ? "active" : ""}"
            onclick="window.setPaperView('live')"
          >
            <span class="tab-icon">📡</span>
            Live Positions
            ${state.positions.length > 0 ? `<span class="tab-badge">${state.positions.length}</span>` : ""}
          </button>
          <button
            class="paper-tab ${state.currentView === "history" ? "active" : ""}"
            onclick="window.setPaperView('history')"
          >
            <span class="tab-icon">📋</span>
            Trade History
            ${state.trades.length > 0 ? `<span class="tab-badge">${state.trades.length}</span>` : ""}
          </button>
          <button
            class="paper-tab ${state.currentView === "settings" ? "active" : ""}"
            onclick="window.setPaperView('settings')"
          >
            <span class="tab-icon">⚙️</span>
            Settings
            ${state.configDirty ? `<span class="tab-badge tab-badge-dirty">●</span>` : ""}
          </button>
        </div>
        <div class="paper-filters">
          ${renderFilters(state)}
        </div>
      </div>

      <!-- Main Content -->
      ${
        state.currentView === "settings"
          ? renderSettingsPanel()
          : `
        <!-- Table Left, Chart Right -->
        <div class="paper-main">
          <!-- Left: Positions or History Table -->
          <div class="paper-left">
            ${state.currentView === "live" ? renderPositionsPanel() : renderHistoryPanel()}
          </div>

          <!-- Right: Chart -->
          <div class="paper-right">
            ${renderChartContainer()}
          </div>
        </div>
      `
      }

      ${
        state.error
          ? `
        <div class="paper-error" data-testid="paper-error">
          <p>❌ ${state.error}</p>
          <button class="btn btn-secondary" onclick="window.clearPaperError()">Dismiss</button>
        </div>
      `
          : ""
      }
    </div>
  `;
}

function renderFilters(state: ReturnType<typeof getPaperTradingState>): string {
  if (state.currentView === "live") {
    // Live view only needs auto-refresh toggle
    return `
      <div class="filter-group">
        <label class="checkbox-label">
          <input
            type="checkbox"
            ${state.autoRefreshEnabled ? "checked" : ""}
            onchange="window.toggleAutoRefresh(this.checked)"
          />
          Auto-refresh (20s)
        </label>
      </div>
      <div class="filter-group">
        <span class="paper-bot-status ${state.botRunning ? "running" : "stopped"}">
          Bot: ${state.botRunning ? `Running${state.botPid ? ` (PID ${state.botPid})` : ""}` : "Stopped"}
        </span>
        <button
          class="btn btn-secondary btn-small"
          onclick="window.togglePaperBot()"
        >
          ${state.botRunning ? "Stop Paper Trading" : "Start Paper Trading"}
        </button>
      </div>
    `;
  }

  // History view needs date and symbol filters
  // Get unique symbols from trades
  const symbols = [...new Set(state.trades.map((t) => t.symbol))].sort();

  return `
    <div class="filter-group">
      <label>From:</label>
      <input
        type="date"
        class="filter-select"
        value="${state.filterFromDate || ""}"
        onchange="window.setPaperFromDate(this.value)"
      />
    </div>
    <div class="filter-group">
      <label>To:</label>
      <input
        type="date"
        class="filter-select"
        value="${state.filterToDate || ""}"
        onchange="window.setPaperToDate(this.value)"
      />
    </div>
    <div class="filter-group">
      <label>Symbol:</label>
      <select onchange="window.setPaperSymbolFilter(this.value)" class="filter-select">
        <option value="">All Symbols</option>
        ${symbols
          .map(
            (s) => `
          <option value="${s}" ${state.filterSymbol === s ? "selected" : ""}>${s}</option>
        `,
          )
          .join("")}
      </select>
    </div>
  `;
}

// Initialize all paper trading handlers
export function initPaperTradingHandlers() {
  initPositionsHandlers();
  initHistoryHandlers();
  initChartHandlers();
  initSettingsHandlers();

  // View switching
  (window as any).setPaperView = (view: PaperTradingView) => {
    setPaperTradingView(view);
    if (view === "live") {
      initLiveAutoRefresh();
      refreshLiveData();
    } else if (view === "history") {
      stopLiveAutoRefresh();
      refreshHistoryData();
    } else if (view === "settings") {
      stopLiveAutoRefresh();
      fetchStrategyConfig();
    }
  };

  // Filter handlers
  (window as any).setPaperFromDate = (value: string) => {
    setFilterFromDate(value || null);
    refreshHistoryData();
  };

  (window as any).setPaperToDate = (value: string) => {
    setFilterToDate(value || null);
    refreshHistoryData();
  };

  (window as any).setPaperSymbolFilter = (value: string) => {
    setFilterSymbol(value || null);
  };

  (window as any).toggleAutoRefresh = (enabled: boolean) => {
    if (enabled) {
      initLiveAutoRefresh();
    } else {
      stopLiveAutoRefresh();
    }
  };

  (window as any).togglePaperBot = async () => {
    const state = getPaperTradingState();
    if (state.botRunning) {
      await stopPaperBot();
    } else {
      await startPaperBot();
    }
  };

  (window as any).clearPaperError = () => {
    setError(null);
  };
}

export function activatePaperTrading() {
  if (paperTradingActive) return;
  paperTradingActive = true;

  // Check if we should navigate to history with a strategy filter
  const savedFilter = localStorage.getItem('filterStrategy');
  if (savedFilter) {
    // Switch to history view and apply filter
    setPaperTradingView('history');
    setFilterStrategy(savedFilter);
    localStorage.removeItem('filterStrategy');
    refreshHistoryData();
  } else {
    refreshLiveData();
    fetchPaperBotStatus();
    initLiveAutoRefresh();
  }
}

// Clean up when switching views
export function cleanupPaperTrading() {
  paperTradingActive = false;
  stopLiveAutoRefresh();
}
