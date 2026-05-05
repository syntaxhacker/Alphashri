import { createSubscriber } from "./createSubscriber";
import type {
  StrategyConfig,
  StrategiesState,
  StrategiesView,
  StrategyCreate,
  StrategyUpdate,
  StrategyPerformance,
} from "../types/strategies";
import * as api from "../api/strategies";
import { fetchWithAuth } from "./auth";
import {
  openCreateModal,
  closeCreateModal,
  openEditModal,
  closeEditModal,
} from "./strategies/modalActions";

const initialState: StrategiesState = {
  strategies: [],
  templates: [],
  selectedStrategy: null,
  selectedVariations: [],
  performance: null,
  allPerformance: [],
  bots: [],
  isLoading: false,
  error: null,
  showCreateModal: false,
  showEditModal: false,
  editingStrategy: null,
  parentTemplate: null,
};

let state: StrategiesState = { ...initialState };
export { state };

let currentViewValue: StrategiesView = "tree";

const { subscribe, notify } = createSubscriber();
export { subscribe, notify };

export function triggerRerender() {
  notify();
}

export function getStrategiesState(): StrategiesState {
  return state;
}

export function getCurrentView(): StrategiesView {
  return currentViewValue;
}

export function setCurrentView(view: StrategiesView) {
  currentViewValue = view;
  notify();
}

export function setLoading(loading: boolean) {
  state = { ...state, isLoading: loading };
  notify();
}

export function setError(error: string | null) {
  state = { ...state, error };
  notify();
}

export async function loadStrategies(includeTemplates = false): Promise<void> {
  setLoading(true);
  setError(null);
  try {
    const result = await api.listStrategies(includeTemplates);
    state = { ...state, strategies: result.strategies, isLoading: false };
    notify();
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to load strategies",
      isLoading: false,
    };
    notify();
  }
}

export async function loadTemplates(): Promise<void> {
  setLoading(true);
  setError(null);
  try {
    const result = await api.listTemplates();
    state = { ...state, templates: result.templates, isLoading: false };
    notify();
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to load templates",
      isLoading: false,
    };
    notify();
  }
}

export async function loadInitialData(): Promise<void> {
  setLoading(true);
  setError(null);

  try {
    const [templatesResult, strategiesResult] = await Promise.all([
      api.listTemplates(),
      api.listStrategies(true),
    ]);

    let strategies = strategiesResult.strategies;

    state = {
      ...state,
      templates: templatesResult.templates,
      strategies: strategies,
      isLoading: false,
    };
    notify();
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to load strategies",
      isLoading: false,
    };
    notify();
  }
}

export async function loadStrategy(strategyId: number): Promise<void> {
  setLoading(true);
  setError(null);
  try {
    const result = await api.getStrategy(strategyId);
    state = {
      ...state,
      selectedStrategy: result.strategy,
      selectedVariations: result.variations,
      isLoading: false,
    };
    notify();
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to load strategy",
      isLoading: false,
    };
    notify();
  }
}

export async function createStrategy(data: StrategyCreate): Promise<StrategyConfig | null> {
  setLoading(true);
  setError(null);
  try {
    const result = await api.createStrategy(data);
    await loadStrategies(true);
    state = {
      ...state,
      showCreateModal: false,
      parentTemplate: null,
    };
    notify();
    return result.strategy;
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to create strategy",
      isLoading: false,
    };
    notify();
    return null;
  }
}

export async function updateStrategy(
  strategyId: number,
  data: StrategyUpdate,
): Promise<StrategyConfig | null> {
  setLoading(true);
  setError(null);
  try {
    const result = await api.updateStrategy(strategyId, data);
    await loadStrategies(true);
    state = {
      ...state,
      showEditModal: false,
      editingStrategy: null,
    };
    notify();
    return result.strategy;
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to update strategy",
      isLoading: false,
    };
    notify();
    return null;
  }
}

export async function deleteStrategyAction(strategyId: number): Promise<boolean> {
  setLoading(true);
  setError(null);
  try {
    await api.deleteStrategy(strategyId);
    await loadStrategies(true);
    state = { ...state, selectedStrategy: null };
    notify();
    return true;
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to delete strategy",
      isLoading: false,
    };
    notify();
    return false;
  }
}

export async function syncVariations(templateId: number): Promise<void> {
  try {
    await api.syncVariations(templateId);
    await loadStrategies();
    await loadTemplates();
  } catch (error) {
    console.error("Failed to sync variations:", error);
  }
}

export async function loadAllPerformance(): Promise<void> {
  setLoading(true);
  setError(null);
  try {
    const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";
    const response = await fetchWithAuth(`${API_BASE}/api/paper/trades?limit=5000&days_back=365`);
    const data = await response.json();
    const trades = data.trades || [];

    const perfMap = new Map<string, {
      strategy_id: number; strategy_name: string;
      total_trades: number; winners: number; losers: number;
      total_pnl: number; net_pnl: number;
    }>();

    for (const t of trades) {
      const name = t.strategy_name || "Unknown";
      if (!perfMap.has(name)) {
        perfMap.set(name, {
          strategy_id: t.strategy_id || 0,
          strategy_name: name,
          total_trades: 0, winners: 0, losers: 0,
          total_pnl: 0, net_pnl: 0,
        });
      }
      const perf = perfMap.get(name)!;
      perf.total_trades++;
      perf.total_pnl += t.pnl || 0;
      perf.net_pnl += t.net_pnl || 0;
      if ((t.pnl || 0) > 0) perf.winners++;
      else if ((t.pnl || 0) < 0) perf.losers++;
    }

    for (const perf of perfMap.values()) {
      perf.win_rate = perf.total_trades > 0 ? (perf.winners / perf.total_trades) * 100 : 0;
    }

    state = {
      ...state,
      allPerformance: Array.from(perfMap.values()),
      isLoading: false,
    };
    notify();
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to load performance",
      isLoading: false,
    };
    notify();
  }
}

export async function loadBots(): Promise<void> {
  setLoading(true);
  setError(null);
  try {
    const result = await api.listBots();
    state = { ...state, bots: result.bots, isLoading: false };
    notify();
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to load bots",
      isLoading: false,
    };
    notify();
  }
}

export function clearError(): void {
  setError(null);
}

export function selectStrategy(strategy: StrategyConfig | null): void {
  state = { ...state, selectedStrategy: strategy, performance: null };
  notify();
}

let initialized = false;
export function initStrategiesState(): void {
  if (initialized) return;
  initialized = true;
  loadInitialData();
}

export { openCreateModal, closeCreateModal, openEditModal, closeEditModal };
