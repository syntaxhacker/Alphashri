/**
 * Bot Management State
 *
 * Uses simple pub/sub pattern matching the existing strategies state.
 */

import type {
  BotConfig,
  BotStatus,
  BotsState,
  BotsView,
  AvailableStrategy,
  StrategyComparison,
  BotCreate,
  BotUpdate,
} from "../types/bots";
import * as api from "../api/bots";

// Initial state
const initialState: BotsState = {
  bots: [],
  selectedBot: null,
  botStatus: null,
  availableStrategies: [],
  isLoading: false,
  error: null,
  showCreateModal: false,
  showEditModal: false,
  editingBot: null,
};

// Current state (mutable)
let state: BotsState = { ...initialState };

// Current view
let currentViewValue: BotsView = "list";

// Auto-refresh interval
let autoRefreshInterval: ReturnType<typeof setInterval> | null = null;

// Subscribers for state changes
const subscribers: Set<() => void> = new Set();

// Notify all subscribers
function notify() {
  subscribers.forEach((callback) => callback());
}

// Trigger a re-render
export function triggerRerender() {
  notify();
}

// Subscribe to state changes
export function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

// Get current state
export function getBotsState(): BotsState {
  return state;
}

// Get current view
export function getCurrentView(): BotsView {
  return currentViewValue;
}

// Set current view
export function setCurrentView(view: BotsView) {
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

// Load all bots
export async function loadBots(): Promise<void> {
  setLoading(true);
  setError(null);
  try {
    const bots = await api.listBots();
    state = { ...state, bots, isLoading: false };
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

// Load a specific bot
export async function loadBot(botId: number): Promise<void> {
  setLoading(true);
  setError(null);
  try {
    const bot = await api.getBot(botId);
    state = { ...state, selectedBot: bot, isLoading: false };
    notify();
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to load bot",
      isLoading: false,
    };
    notify();
  }
}

// Load bot status (live data)
export async function loadBotStatus(botId: number): Promise<void> {
  try {
    const status = await api.getBotStatus(botId);
    state = { ...state, botStatus: status };
    notify();
  } catch (error) {
    console.error("Failed to load bot status:", error);
  }
}

// Load available strategies
export async function loadAvailableStrategies(): Promise<void> {
  try {
    const strategies = await api.listAvailableStrategies();
    state = { ...state, availableStrategies: strategies };
    notify();
  } catch (error) {
    console.error("Failed to load available strategies:", error);
  }
}

// Create a new bot
export async function createBotAction(data: BotCreate): Promise<BotConfig | null> {
  setLoading(true);
  setError(null);
  try {
    const bot = await api.createBot(data);
    await loadBots();
    state = { ...state, showCreateModal: false };
    notify();
    return bot;
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to create bot",
      isLoading: false,
    };
    notify();
    return null;
  }
}

// Update a bot
export async function updateBotAction(botId: number, data: BotUpdate): Promise<BotConfig | null> {
  setLoading(true);
  setError(null);
  try {
    const bot = await api.updateBot(botId, data);
    await loadBots();
    state = { ...state, showEditModal: false, editingBot: null };
    notify();
    return bot;
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to update bot",
      isLoading: false,
    };
    notify();
    return null;
  }
}

// Delete a bot (with trade check)
export async function deleteBotAction(botId: number): Promise<boolean> {
  setLoading(true);
  setError(null);
  try {
    // Check if bot has trades first
    const tradeCount = await api.getBotTradeCount(botId);
    if (tradeCount.count > 0) {
      state = {
        ...state,
        error: `Cannot delete bot: ${tradeCount.count} trade(s) exist for this bot. Delete trades first.`,
        isLoading: false,
      };
      notify();
      return false;
    }

    await api.deleteBot(botId);
    await loadBots();
    state = { ...state, selectedBot: null };
    notify();
    return true;
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to delete bot",
      isLoading: false,
    };
    notify();
    return false;
  }
}

// Start a bot
export async function startBotAction(botId: number, testMode: boolean = false): Promise<boolean> {
  setLoading(true);
  setError(null);
  try {
    await api.startBot(botId, testMode);
    await loadBots();
    notify();
    return true;
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to start bot",
      isLoading: false,
    };
    notify();
    return false;
  }
}

// Stop a bot
export async function stopBotAction(botId: number): Promise<boolean> {
  setLoading(true);
  setError(null);
  try {
    await api.stopBot(botId);
    await loadBots();
    notify();
    return true;
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to stop bot",
      isLoading: false,
    };
    notify();
    return false;
  }
}

// Open create modal
export function openCreateModal(): void {
  loadAvailableStrategies();
  state = { ...state, showCreateModal: true, showEditModal: false, editingBot: null };
  notify();
}

// Close create modal
export function closeCreateModal(): void {
  state = { ...state, showCreateModal: false };
  notify();
}

// Open edit modal
export function openEditModal(bot: BotConfig): void {
  loadAvailableStrategies();
  state = { ...state, showEditModal: true, editingBot: bot, showCreateModal: false };
  notify();
}

// Close edit modal
export function closeEditModal(): void {
  state = { ...state, showEditModal: false, editingBot: null };
  notify();
}

// Clear error
export function clearError(): void {
  setError(null);
}

// Select a bot
export function selectBot(bot: BotConfig | null): void {
  state = { ...state, selectedBot: bot, botStatus: null };
  notify();
  if (bot && bot.running) {
    loadBotStatus(bot.id);
  }
}

// Start auto-refresh for bot status
export function startAutoRefresh(botId: number, intervalMs: number = 5000): void {
  stopAutoRefresh();
  autoRefreshInterval = setInterval(() => {
    loadBotStatus(botId);
  }, intervalMs);
}

// Stop auto-refresh
export function stopAutoRefresh(): void {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// Initialize state - call this once on app load
let initialized = false;
export function initBotsState(): void {
  if (initialized) return;
  initialized = true;
  loadBots();
}
