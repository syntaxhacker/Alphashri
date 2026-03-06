/**
 * Main entry point for Alphashri
 */

import "./style.css";
import {
  COLUMN_LABELS,
  COLUMN_TOOLTIPS,
  NUMERIC_COLUMNS,
  getColumnKeysForProfile,
} from "./ui_schema";
import { mountScreenerPage, unmountScreenerPage, type BridgeProps } from "./integration/screenerBridge";
import { formatTimestamp } from "./utils/format";

// State management
import * as state from "./state";

// Backtest state and components
import { subscribe as subscribeBacktest, getBacktestState } from "./state/backtest";
import {
  renderBacktestView,
  initBacktestHandlers,
  initBacktestCharts,
} from "./components/backtest";
import { fetchStrategies, fetchCosts } from "./api/backtest";

// Paper Trading state and components
import { subscribe as subscribePaperTrading } from "./state/paperTrading";
import {
  renderPaperTradingView,
  initPaperTradingHandlers,
  cleanupPaperTrading,
  activatePaperTrading,
} from "./components/paper-trading";
import { initPaperChart } from "./components/paper-trading/chart";
import { renderSectorAnalysisView } from "./components/sector-analysis";
import {
  renderStrategiesView,
  initStrategiesHandlers,
  cleanupStrategies,
} from "./components/strategies";
import { subscribe as subscribeStrategies } from "./state/strategies";
import { renderBotsView, initBotsHandlers, cleanupBots } from "./components/bots";
import { subscribe as subscribeBots } from "./state/bots";
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
import {
  applyFilters,
  sortStocks,
  handleSort,
  renderSortableHeader,
  getUniqueSectors,
} from "./components/filters";
import { renderStockRow } from "./components/table";
import { renderSummaryStrip } from "./components/summary";
import { renderTradingListBlock } from "./components/tradinglist";
import {
  getActiveProfileMeta,
  getSectionLabels,
  initProfileFilters,
  applyProfileFilters,
} from "./components/profile";
import {
  renderNotificationsHtml,
  renderScreenerNav,
  renderHeader,
  renderFilters,
  renderFooter,
} from "./components/header";

function getTableHeaders(screener: string, touched: boolean): string {
  return getColumnKeysForProfile(screener, touched)
    .map((key) =>
      renderSortableHeader(
        COLUMN_LABELS[key],
        key,
        NUMERIC_COLUMNS.has(key) ? "num" : "",
        COLUMN_TOOLTIPS[key] || "",
      ),
    )
    .join("");
}

let lastRenderedView: AppView | null = null;

function render() {
  const app = document.querySelector<HTMLDivElement>("#legacy-root")!;
  const backtestState = getBacktestState();
  const currentView = backtestState.currentView;

  // Render with sidemenu
  let mainContent: string;
  if (currentView === "backtest") {
    mainContent = renderBacktestView();
  } else if (currentView === "paper") {
    mainContent = renderPaperTradingView();
  } else if (currentView === "sector") {
    mainContent = renderSectorAnalysisView();
  } else if (currentView === "strategies") {
    mainContent = renderStrategiesView();
  } else if (currentView === "bots") {
    mainContent = renderBotsView();
  } else {
    mainContent = renderScreenerView();
  }

  app.innerHTML = `
    <div class="app-main">
      ${mainContent}
    </div>
  `;

  // Initialize charts after render
  if (currentView === "backtest") {
    initBacktestCharts();
  } else if (currentView === "paper") {
    // Small delay to ensure DOM is ready
    setTimeout(() => initPaperChart(), 100);
  }

  // Activate/deactivate paper polling based on active route/view
  if (currentView === "paper" && lastRenderedView !== "paper") {
    activatePaperTrading();
  } else if (currentView !== "paper" && lastRenderedView === "paper") {
    cleanupPaperTrading();
  }

  // Cleanup strategies view when leaving
  if (currentView !== "strategies" && lastRenderedView === "strategies") {
    cleanupStrategies();
  }

  // Cleanup bots view when leaving
  if (currentView !== "bots" && lastRenderedView === "bots") {
    cleanupBots();
  }

  // Mount/unmount React screener page
  if (currentView === "screener") {
    mountScreenerPageIfNeeded();
  } else {
    unmountScreenerPage();
  }

  lastRenderedView = currentView;
}

function renderScreenerView(): string {
  return `<div id="screener-react-root" data-testid="screener-page"></div>`;
}

function mountScreenerPageIfNeeded() {
  const container = document.getElementById("screener-react-root");
  if (!container) return;
  
  const allStocks = [...(state.data?.approaching || []), ...(state.data?.touched || [])];
  const touchedSymbols = new Set((state.data?.touched || []).map(s => s.symbol));
  
  const rawProfileFilters = state.profileMetaById[state.activeScreener]?.filters;
  const profileFilters = rawProfileFilters?.map(f => ({
    key: f.key,
    label: f.label,
    type: f.type,
    min: f.min,
    max: f.max,
    step: f.step,
    options: f.options?.map(opt => ({ value: opt, label: opt })),
  }));
  
  const props: BridgeProps = {
    stocks: allStocks,
    touchedSymbols: Array.from(touchedSymbols),
    filters: {
      minScore: state.filters.minScore,
      maxPrice: state.filters.maxPrice,
      minReturn: state.filters.minReturn,
      sector: state.filters.sector,
      ...state.profileFilterValues,
    },
    sectors: getUniqueSectors(allStocks),
    profileFilters,
    profileFilterValues: state.profileFilterValues,
    screenerOptions: state.screenerOptions,
    activeScreener: state.activeScreener,
    title: `${state.screenerOptions.find(s => s.id === state.activeScreener)?.label || "Trending"} | Alphashri`,
    status: `${state.data?.last_updated ? formatTimestamp(state.data.last_updated) : ""} | ${state.data?.provider?.toUpperCase() || ""} | ${state.data?.mode === "intraday" ? "Intraday" : "5D"}`,
    isLoading: state.isLoading,
    autoRefreshSeconds: state.autoRefreshSeconds,
    provider: state.data?.provider || "upstox",
    mode: state.data?.mode || "intraday",
    summary: state.data?.summary,
    error: state.error,
  };
  
  mountScreenerPage(container, props);
}

// Set render callback for modules that need to trigger re-renders
setRenderCallback(render);
setApiRenderCallback(render);

// Subscribe to backtest state changes
subscribeBacktest(render);

// Subscribe to paper trading state changes
subscribePaperTrading(render);

// Subscribe to strategies state changes
subscribeStrategies(render);

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
  initBacktestHandlers();
  initPaperTradingHandlers();
  initStrategiesHandlers();
  initBotsHandlers();
  initPreviewChartHandlers();
  fetchStrategies();
  fetchCosts();

  // Only fetch screener data if not on backtest or paper view
  const backtestState = getBacktestState();
  if (
    backtestState.currentView !== "backtest" &&
    backtestState.currentView !== "paper" &&
    backtestState.currentView !== "sector"
  ) {
    fetchData(
      state.data?.provider || "upstox",
      state.data?.mode || "intraday",
      state.activeScreener,
    );
    setupAutoRefresh();
  }

  render();
});
