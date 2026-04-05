import { createSubscriber } from "./createSubscriber";
import type {
  StrategyConfig,
  StrategiesState,
  StrategiesView,
  StrategyCreate,
  StrategyUpdate,
} from "../types/strategies";
import * as api from "../api/strategies";
import { loadPerformance, loadAllPerformance } from "./strategies/performanceActions";
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

let currentViewValue: StrategiesView = "templates";

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

    const nonTemplates = strategies.filter((s) => !s.is_template);
    const hasActive = nonTemplates.some((s) => s.is_active);
    if (!hasActive && nonTemplates.length > 0) {
      const defaultStrategy = nonTemplates.find((s) => s.is_default) || nonTemplates[0];
      if (defaultStrategy) {
        const strategyId = defaultStrategy.internal_id ?? Number(defaultStrategy.id);
        try {
          await api.updateStrategy(strategyId, { is_active: true });
          strategies = strategies.map((s) => ({
            ...s,
            is_active: s.id === defaultStrategy.id,
          }));
        } catch (_error) {
          console.error("Failed to auto-activate default strategy:", _error);
        }
      }
    }

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
  if (strategy) {
    const strategyId = strategy.internal_id ?? Number(strategy.id);
    loadPerformance(strategyId);
  }
}

let initialized = false;
export function initStrategiesState(): void {
  if (initialized) return;
  initialized = true;
  loadInitialData();
}

export {
  loadPerformance,
  loadAllPerformance,
  openCreateModal,
  closeCreateModal,
  openEditModal,
  closeEditModal,
};
