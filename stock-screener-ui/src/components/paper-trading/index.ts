/**
 * Paper Trading View Component
 *
 * Main paper trading view with Live Positions, Trade History, and Settings tabs.
 * Now supports multi-strategy bots via /api/bots endpoints.
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
  setSelectedStrategyTab,
  setAvailableBots,
  setupAutoRefresh,
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
  refreshBotLiveData,
  listBots,
  startBot,
  stopBot,
  fetchBotPortfolio,
  fetchBotPositions,
  fetchBotScanItems,
} from "../../api/paperTrading";
import type { PaperTradingView } from "../../types/paperTrading";
import { fetchWithAuth } from "../../state/auth";

// Active bot ID for multi-strategy mode
let activeBotId: number | null = null;

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
            data-testid="trade-history-tab"
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

        <!-- Bot Selector -->
        <div class="bot-selector" data-testid="bot-selector">
          ${renderBotSelector(state)}
        </div>

        <div class="paper-filters" data-testid="paper-filters">
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
          <div class="paper-left" data-testid="paper-left-panel">
            ${state.currentView === "live" ? renderPositionsPanel() : renderHistoryPanel()}
          </div>

          <!-- Right: Chart -->
          <div class="paper-right" data-testid="paper-right-panel">
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

function renderBotSelector(state: ReturnType<typeof getPaperTradingState>): string {
  const bots = state.availableBots || [];
  return `
    <select
      class="bot-selector-dropdown"
      data-testid="bot-selector-dropdown"
      onchange="window.selectPaperBot(this.value)"
    >
      <option value="">Select a Bot...</option>
      ${bots
        .map(
          (bot) => `
        <option value="${bot.id}" ${bot.id === activeBotId ? "selected" : ""}>
          ${bot.name} (${bot.strategies?.length || 0} strategies)
        </option>
      `,
        )
        .join("")}
    </select>
  `;
}

function renderFilters(state: ReturnType<typeof getPaperTradingState>): string {
  if (state.currentView === "live") {
    // Live view - show strategy tabs and auto-refresh
    return `
    <div class="filter-group">
      <label class="checkbox-label">
        <input
          type="checkbox"
          ${state.autoRefreshEnabled ? "checked" : ""}
          onchange="window.toggleAutoRefresh(this.checked)"
        />
        Auto-refresh
      </label>
    </div>
    <div class="filter-group bot-status">
      <span class="paper-bot-status ${state.botRunning ? "running" : "stopped"}">
        Bot: ${state.botRunning ? `Running${state.botPid ? ` (PID ${state.botPid})` : ""}` : "Stopped"}
      </span>
      <button
        class="btn btn-secondary btn-small"
        data-testid="${state.botRunning ? "stop-bot-btn" : "start-bot-btn"}"
        onclick="window.togglePaperBot()"
      >
        ${state.botRunning ? "Stop Bot" : "Start Bot"}
      </button>
    </div>
  `;
  }
  // History view needs date and symbol filters
  const symbols = [...new Set(state.trades.map((t) => t.symbol))].sort();
  return `
    <div class="filter-group">
      <label>From:</label>
      <input
        type="date"
        class="filter-select"
        value="${state.filterFromDate || ""}"
        onchange="window.setFilterFromDate(this.value)"
      />
    </div>
    <div class="filter-group">
      <label>To:</label>
      <input
        type="date"
        class="filter-select"
        value="${state.filterToDate || ""}"
        onchange="window.setFilterToDate(this.value)"
      />
    </div>
    <div class="filter-group">
      <label>Symbol:</label>
      <select onchange="window.setPaperSymbolFilter(this.value)" class="filter-select">
        <option value="">All Symbols</option>
        ${symbols.map((s) => `<option value="${s}" ${state.filterSymbol === s ? "selected" : ""}>${s}</option>`).join("")}
      </select>
    </div>
  `;
}

function renderHeaderButtons(state: ReturnType<typeof getPaperTradingState>): string {
  const botState = state.botStatus;
  const botRunning = state.botRunning;
  const botPid = state.botPid;
  const botLogFile = state.botLogFile;

  const isMultiStrategy = activeBotId !== null;

  return `
    <div class="paper-header-buttons">
      ${
        isMultiStrategy
          ? `
        <!-- Multi-strategy bot controls -->
        <button
          class="btn btn-secondary btn-small"
          data-testid="refresh-data-btn"
          onclick="window.refreshPaperData()"
        >
          <span class="btn-icon">🔄</span>
          Refresh
        </button>
        <button
          class="btn btn-${botRunning ? "danger" : "primary"}"
          data-testid="${botRunning ? "stop-bot-btn" : "start-bot-btn"}"
          onclick="window.togglePaperBot()"
        >
          ${
            botRunning
              ? `
            <span class="btn-icon">⏹</span>
            Stop Bot
          `
              : `
            <span class="btn-icon">▶</span>
            Start Bot
          `
          }
        </button>
      `
          : `
        <!-- Single-strategy bot controls -->
        <button
          class="btn btn-secondary btn-small"
          data-testid="refresh-data-btn"
          onclick="window.refreshPaperData()"
        >
          <span class="btn-icon">🔄</span>
          Refresh
        </button>
        <button
          class="btn btn-${botRunning ? "danger" : "primary"}"
          data-testid="${botRunning ? "stop-bot-btn" : "start-bot-btn"}"
          onclick="window.togglePaperBot()"
        >
          ${
            botRunning
              ? `
            <span class="btn-icon">⏹</span>
            Stop Bot
          `
              : `
            <span class="btn-icon">▶</span>
            Start Bot
          `
          }
        </button>
      `
      }
    </div>
  `;
}

// Initialize handlers
export function initPaperTradingHandlers() {
  initPositionsHandlers();
  initHistoryHandlers();
  initChartHandlers();
  initSettingsHandlers();

  // Load available bots
  loadBots();

  async function loadBots() {
    try {
      const bots = await listBots();
      setAvailableBots(bots);
    } catch (error) {
      console.error("Failed to load bots:", error);
    }
  }

  // View switching
  (window as any).setPaperView = async (view: PaperTradingView) => {
    setPaperTradingView(view);
    const state = getPaperTradingState();

    if (view === "live") {
      // Setup auto-refresh with correct refresh function
      if (activeBotId) {
        setupAutoRefresh(() => refreshBotLiveData(activeBotId!), 20000);
        refreshBotLiveData(activeBotId);
      } else {
        initLiveAutoRefresh();
        refreshLiveData();
      }
    } else if (view === "history") {
      stopLiveAutoRefresh();
      refreshHistoryData();
    } else if (view === "settings") {
      stopLiveAutoRefresh();
      fetchStrategyConfig();
    }
  };

  // Bot selector
  (window as any).selectPaperBot = async (botId: string) => {
    const id = parseInt(botId);
    if (isNaN(id)) {
      activeBotId = null;
      // Switch to single-strategy mode
      stopLiveAutoRefresh();
      initLiveAutoRefresh();
      refreshLiveData();
    } else {
      activeBotId = id;
      // Switch to multi-strategy mode with correct auto-refresh
      stopLiveAutoRefresh();
      setupAutoRefresh(() => refreshBotLiveData(id), 20000);
      await refreshBotLiveData(id);
    }
  };

  // Filter handlers
  (window as any).setFilterFromDate = (value: string) => {
    setFilterFromDate(value || null);
    refreshHistoryData();
  };

  (window as any).setFilterToDate = (value: string) => {
    setFilterToDate(value || null);
    refreshHistoryData();
  };

  (window as any).setFilterSymbolFilter = (value: string) => {
    setFilterSymbol(value || null);
  };

  (window as any).setFilterStrategyFilter = (value: string) => {
    setFilterStrategy(value || null);
  };

  (window as any).toggleAutoRefresh = (enabled: boolean) => {
    if (enabled) {
      initLiveAutoRefresh();
    } else {
      stopLiveAutoRefresh();
    }
  };

  (window as any).togglePaperBot = async () => {
    if (activeBotId) {
      // Multi-strategy bot
      const state = getPaperTradingState();
      if (state.botRunning) {
        await stopBot(activeBotId);
      } else {
        await startBot(activeBotId);
      }
      // Refresh status
      setTimeout(() => {
        refreshBotLiveData(activeBotId);
      }, 1000);
    } else {
      // Single-strategy bot
      const state = getPaperTradingState();
      if (state.botRunning) {
        await stopPaperBot();
      } else {
        await startPaperBot();
      }
      // Refresh status
      setTimeout(() => {
        refreshLiveData();
      }, 1000);
    }
  };

  (window as any).refreshPaperData = async () => {
    if (activeBotId) {
      await refreshBotLiveData(activeBotId);
    } else {
      await refreshLiveData();
    }
  };

  (window as any).clearPaperError = () => {
    setError(null);
  };
}

export function activatePaperTrading() {
  paperTradingActive = true;
  loadBots();

  async function loadBots() {
    try {
      const bots = await listBots();
      setAvailableBots(bots);
    } catch (error) {
      console.error("Failed to load bots:", error);
    }
  }
}

export function cleanupPaperTrading() {
  paperTradingActive = false;
  stopLiveAutoRefresh();
  activeBotId = null;
}

export function getActiveBotId(): number | null {
  return activeBotId;
}

export function setActiveBotId(id: number | null): void {
  activeBotId = id;
}
