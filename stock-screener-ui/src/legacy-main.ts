/**
 * Main entry point for Alphashri legacy views
 * This handles bots view that still use string-based HTML rendering
 * (backtest and paper have been converted to Mantine)
 */

import "./style.css";

// State management
import * as state from "./state";

// Backtest state (for checking current view only)
import { subscribe as subscribeBacktest, getBacktestState } from "./state/backtest";

// Bots state and components
import { renderBotsView, initBotsHandlers, cleanupBots } from "./components/bots";
import { subscribe as subscribeBots } from "./state/bots";

// Strategies state (for window functions used by React components)
import * as strategiesState from "./state/strategies";

// Common
import { initPreviewChartHandlers } from "./components/common/previewChart";
import type { AppView } from "./types/backtest";

// Utilities
import { setRenderCallback } from "./utils/notifications";

// API
import {
  fetchData,
  loadScreeners,
  setupAutoRefresh,
  setRenderCallback as setApiRenderCallback,
} from "./api";

// Components
import { handleSort } from "./components/filters";
import { getActiveProfileMeta, initProfileFilters } from "./components/profile";

let lastRenderedView: AppView | null = null;

function render() {
  const app = document.querySelector<HTMLDivElement>("#app-content");
  if (!app) {
    return;
  }

  const backtestState = getBacktestState();
  const currentView = backtestState.currentView;

  // Skip HTML rendering for React-based views (screener, strategies, sector, backtest, paper)
  // These are handled by React Router directly
  if (
    currentView === "screener" ||
    currentView === "strategies" ||
    currentView === "sector" ||
    currentView === "backtest" ||
    currentView === "paper"
  ) {
    return;
  }

  // Render legacy bots view with string-based HTML
  let mainContent: string;
  if (currentView === "bots") {
    mainContent = renderBotsView();
  } else {
    mainContent = "";
  }

  app.innerHTML = `
    <div class="app-main">
      ${mainContent}
    </div>
  `;

  // Cleanup bots view when leaving
  if (currentView !== "bots" && lastRenderedView === "bots") {
    cleanupBots();
  }

  lastRenderedView = currentView;
}

// Set render callback for modules that need to trigger re-renders
setRenderCallback(render);
setApiRenderCallback(render);

// Subscribe to backtest state changes (to detect view changes)
subscribeBacktest(render);

// Subscribe to bots state changes
subscribeBots(render);

// Window-exposed functions for onclick handlers
(window as any).refresh = () =>
  fetchData(state.data?.provider || "upstox", state.data?.mode || "intraday", state.activeScreener);
(window as any).changeProvider = (p: string) =>
  fetchData(p, state.data?.mode || "intraday", state.activeScreener);
(window as any).changeMode = (m: string) =>
  fetchData(state.data?.provider || "upstox", m, state.activeScreener);
(window as any).changeScreener = (s: string) => {
  state.setActiveScreener(s);
  initProfileFilters(s);
  fetchData(state.data?.provider || "upstox", state.data?.mode || "intraday", s);
};
(window as any).updateFilter = (key: string, value: string) => {
  if (key === "sector") {
    state.updateFilter(key as keyof typeof state.filters, value);
  } else {
    state.updateFilter(key as keyof typeof state.filters, parseFloat(value));
  }
  render();
};
(window as any).resetFilters = () => {
  state.resetFilters();
  initProfileFilters(state.activeScreener);
  render();
};
(window as any).updateProfileFilter = (key: string, value: string) => {
  const meta = getActiveProfileMeta();
  const def = (meta.filters || []).find((f) => f.key === key);
  state.updateProfileFilterValue(key, def?.type === "number" ? parseFloat(value) : value);
  fetchData(
    state.data?.provider || "upstox",
    state.data?.mode || "intraday",
    state.activeScreener,
    "filter",
  );
};
(window as any).handleSort = (column: string) => {
  handleSort(column);
  render();
};
(window as any).toggleNotifPanel = () => {
  state.setNotifPanelOpen(!state.notifPanelOpen);
  render();
};
(window as any).setNotifFilter = (value: "all" | "primary" | "secondary") => {
  state.setNotifFilter(value);
  render();
};
(window as any).clearNotifications = () => {
  state.clearNotifications();
  render();
};
(window as any).changeAutoRefresh = (secondsRaw: string) => {
  const parsed = Math.max(0, Math.min(3600, parseInt(secondsRaw || "0", 10) || 0));
  state.setAutoRefreshSeconds(parsed);
  setupAutoRefresh();
};
(window as any).copyTradingList = async (id: string) => {
  const node = document.getElementById(id) as HTMLTextAreaElement | null;
  const text = node?.value || "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    node?.select();
    document.execCommand("copy");
  }
};

// Strategy management window functions (called from React components)
(window as any).createStrategy = async (data: any) => {
  await strategiesState.createStrategy(data);
};

(window as any).updateStrategy = async (strategyId: number, data: any) => {
  await strategiesState.updateStrategy(strategyId, data);
};

(window as any).deleteStrategy = async (strategyId: number) => {
  if (confirm("Are you sure you want to delete this strategy?")) {
    await strategiesState.deleteStrategyAction(strategyId);
  }
};

(window as any).viewStrategyDetails = async (strategyId: number) => {
  await strategiesState.loadStrategy(strategyId);
};

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (state.isLoading) return;
  switch (e.key.toLowerCase()) {
    case "r":
      (window as any).refresh();
      break;
    case "p": {
      const newP = state.data?.provider === "upstox" ? "indmoney" : "upstox";
      fetchData(newP, state.data?.mode || "historical", state.activeScreener);
      break;
    }
    case "m": {
      const newM = state.data?.mode === "historical" ? "intraday" : "historical";
      fetchData(state.data?.provider || "upstox", newM, state.activeScreener);
      break;
    }
  }
});

// Initial load
loadScreeners(initProfileFilters).then(() => {
  // Initialize handlers
  initBotsHandlers();
  initPreviewChartHandlers();

  // Only fetch screener data if not on sector view
  const backtestState = getBacktestState();
  if (backtestState.currentView !== "sector") {
    fetchData(
      state.data?.provider || "upstox",
      state.data?.mode || "intraday",
      state.activeScreener,
    );
    setupAutoRefresh();
  }

  render();
});
