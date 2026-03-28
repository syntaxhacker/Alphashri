/**
 * Strategy Management State
 *
 * Uses simple pub/sub pattern matching the existing backtest state.
 */

import type {
  StrategyConfig,
  StrategiesState,
  StrategiesView,
  StrategyPerformance,
  StrategyCreate,
  StrategyUpdate,
} from "../types/strategies";
import * as api from "../api/strategies";

// Initial state
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

// Current state (mutable)
let state: StrategiesState = { ...initialState };

// Current view
let currentViewValue: StrategiesView = "templates";

// Subscribers for state changes
const subscribers: Set<() => void> = new Set();

// Notify all subscribers
function notify() {
  subscribers.forEach((callback) => callback());
}

// Trigger a re-render (useful when only local state changes)
export function triggerRerender() {
  notify();
}

// Subscribe to state changes
export function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

// Get current state
export function getStrategiesState(): StrategiesState {
  return state;
}

// Get current view
export function getCurrentView(): StrategiesView {
  return currentViewValue;
}

// Set current view
export function setCurrentView(view: StrategiesView) {
  currentViewValue = view;
  notify();
}

// Set loading state
function setLoading(loading: boolean) {
  state = { ...state, isLoading: loading };
  notify();
}

// Set error
function setError(error: string | null) {
  state = { ...state, error };
  notify();
}

// Load all strategies
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

// Load templates
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

// Load both templates and strategies (for initial load)
export async function loadInitialData(): Promise<void> {
  setLoading(true);
  setError(null);

  try {
    // Load both in parallel
    const [templatesResult, strategiesResult] = await Promise.all([
      api.listTemplates(),
      api.listStrategies(true),
    ]);

    let strategies = strategiesResult.strategies;

    // Auto-activate default strategy if no active strategy exists
    const nonTemplates = strategies.filter((s) => !s.is_template);
    const hasActive = nonTemplates.some((s) => s.is_active);
    if (!hasActive && nonTemplates.length > 0) {
      const defaultStrategy = nonTemplates.find((s) => s.is_default) || nonTemplates[0];
      if (defaultStrategy) {
        const strategyId = defaultStrategy.internal_id ?? Number(defaultStrategy.id);
        try {
          await api.updateStrategy(strategyId, { is_active: true });
          // Update local state
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

// Load a single strategy with variations
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

// Create a new strategy
export async function createStrategy(data: StrategyCreate): Promise<StrategyConfig | null> {
  setLoading(true);
  setError(null);
  try {
    const result = await api.createStrategy(data);
    // Reload strategies
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

// Update a strategy
export async function updateStrategy(
  strategyId: number,
  data: StrategyUpdate,
): Promise<StrategyConfig | null> {
  setLoading(true);
  setError(null);
  try {
    const result = await api.updateStrategy(strategyId, data);
    // Reload strategies
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

// Delete a strategy
export async function deleteStrategyAction(strategyId: number): Promise<boolean> {
  setLoading(true);
  setError(null);
  try {
    await api.deleteStrategy(strategyId);
    // Reload strategies
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

// Load performance for a strategy
export async function loadPerformance(strategyId: number): Promise<void> {
  try {
    const perf = await api.getStrategyPerformance(strategyId);
    state = { ...state, performance: perf };
    notify();
  } catch (error) {
    console.error("Failed to load performance:", error);
  }
}

// Load performance for all strategies
export async function loadAllPerformance(): Promise<void> {
  setLoading(true);
  setError(null);

  // Make sure we have strategies loaded
  if (state.strategies.length === 0) {
    await loadStrategies(true);
  }

  const performanceResults: StrategyPerformance[] = [];

  // Load performance for each non-template strategy
  for (const strategy of state.strategies) {
    if (!strategy.is_template) {
      // Use internal_id (integer) instead of id (uuid) for API calls
      const strategyId = strategy.internal_id ?? Number(strategy.id);
      try {
        const perf = await api.getStrategyPerformance(strategyId);
        performanceResults.push(perf);
      } catch {
        // Add placeholder for strategies with no trades
        performanceResults.push({
          strategy_id: strategyId,
          strategy_name: strategy.name,
          total_trades: 0,
          winners: 0,
          losers: 0,
          win_rate: 0,
          total_pnl: 0,
          net_pnl: 0,
        });
      }
    }
  }

  state = { ...state, allPerformance: performanceResults, isLoading: false };
  notify();

  // Check if we need to select a strategy by name (from navigation)
  const pendingSelection = (window as any).__pendingStrategySelection;
  if (pendingSelection && performanceResults.length > 0) {
    delete (window as any).__pendingStrategySelection;
    const strategy = performanceResults.find((s) => s.strategy_name === pendingSelection);
    if (strategy) {
      // Import and call the selection function
      const { selectStrategyByName } = require("../components/strategies/performance");
      selectStrategyByName(pendingSelection, performanceResults);
    }
  }
}

// Load bots
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

// Open create modal
export function openCreateModal(template: StrategyConfig | null = null): void {
  state = {
    ...state,
    showCreateModal: true,
    parentTemplate: template,
    showEditModal: false,
    editingStrategy: null,
  };
  notify();
}

// Close create modal
export function closeCreateModal(): void {
  state = { ...state, showCreateModal: false, parentTemplate: null };
  notify();
}

// Open edit modal
export function openEditModal(strategy: StrategyConfig): void {
  state = {
    ...state,
    showEditModal: true,
    editingStrategy: strategy,
    showCreateModal: false,
    parentTemplate: null,
  };
  notify();
}

// Close edit modal
export function closeEditModal(): void {
  state = { ...state, showEditModal: false, editingStrategy: null };
  notify();
}

// Clear error
export function clearError(): void {
  setError(null);
}

// Select a strategy
export function selectStrategy(strategy: StrategyConfig | null): void {
  state = { ...state, selectedStrategy: strategy, performance: null };
  notify();
  if (strategy) {
    const strategyId = strategy.internal_id ?? Number(strategy.id);
    loadPerformance(strategyId);
  }
}

// Initialize state - call this once on app load
let initialized = false;
export function initStrategiesState(): void {
  if (initialized) return;
  initialized = true;
  loadInitialData();
}
