/**
 * Bot Management State
 *
 * Uses simple pub/sub pattern matching the existing strategies state.
 */

import { createSubscriber } from "./createSubscriber";
import type {
  BotConfig,
  BotsState,
  BotsView,
  BotCreate,
  BotUpdate,
  BotLoadingKey,
} from "../types/bots";
import {
  listBots,
  getBot,
  createBot,
  updateBot,
  startBot,
  stopBot,
  deleteBot,
  getBotStatus,
  getBotTrades,
  getBotTradeCount,
  listAvailableStrategies,
} from "../api/bots";
import { createLoadingState, setLoading as setLoadingState } from "../utils/loading";

// Initial state
const initialState: BotsState = {
  bots: [],
  selectedBot: null,
  botStatus: null,
  botTrades: [],
  availableStrategies: [],
  loading: createLoadingState<BotLoadingKey>([
    "list",
    "load",
    "status",
    "strategies",
    "create",
    "update",
    "delete",
    "start",
    "stop",
    "trades",
  ]),
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

const { subscribe, notify } = createSubscriber();
export { subscribe };

export function triggerRerender() {
  notify();
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
function setLoading(key: BotLoadingKey, loading: boolean) {
  state = { ...state, loading: setLoadingState<BotLoadingKey>(state.loading, key, loading) };
  notify();
}

// Set error
function setError(error: string | null) {
  state = { ...state, error };
  notify();
}

// Load all bots
export async function loadBots(): Promise<void> {
  setLoading("list", true);
  setError(null);
  try {
    const bots = await listBots();
    state = {
      ...state,
      bots,
      loading: setLoadingState<BotLoadingKey>(state.loading, "list", false),
    };
    notify();
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to load bots",
      loading: setLoadingState<BotLoadingKey>(state.loading, "list", false),
    };
    notify();
  }
}

// Load a specific bot
export async function loadBot(botId: string): Promise<void> {
  setLoading("load", true);
  setError(null);
  try {
    const bot = await getBot(botId);
    state = {
      ...state,
      selectedBot: bot,
      loading: setLoadingState<BotLoadingKey>(state.loading, "load", false),
    };
    notify();
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to load bot",
      loading: setLoadingState<BotLoadingKey>(state.loading, "load", false),
    };
    notify();
  }
}

// Load bot status (live data)
export async function loadBotStatus(botId: string): Promise<void> {
  setLoading("status", true);
  try {
    const status = await getBotStatus(botId);
    state = {
      ...state,
      botStatus: status,
      loading: setLoadingState<BotLoadingKey>(state.loading, "status", false),
    };
    notify();
  } catch (error) {
    console.error("Failed to load bot status:", error);
    state = { ...state, loading: setLoadingState<BotLoadingKey>(state.loading, "status", false) };
    notify();
  }
}

// Load bot trades history
export async function loadBotTrades(botId: string, strategyId?: string): Promise<void> {
  setLoading("trades", true);
  try {
    const result = await getBotTrades(botId, strategyId, 50);
    state = {
      ...state,
      botTrades: result.trades,
      loading: setLoadingState<BotLoadingKey>(state.loading, "trades", false),
    };
    notify();
  } catch (error) {
    console.error("Failed to load bot trades:", error);
    state = {
      ...state,
      botTrades: [],
      loading: setLoadingState<BotLoadingKey>(state.loading, "trades", false),
    };
    notify();
  }
}

// Load available strategies
export async function loadAvailableStrategies(): Promise<void> {
  setLoading("strategies", true);
  try {
    const strategies = await listAvailableStrategies();
    state = {
      ...state,
      availableStrategies: strategies,
      loading: setLoadingState<BotLoadingKey>(state.loading, "strategies", false),
    };
    notify();
  } catch (error) {
    console.error("Failed to load available strategies:", error);
    state = {
      ...state,
      loading: setLoadingState<BotLoadingKey>(state.loading, "strategies", false),
    };
    notify();
  }
}

// Create a new bot
export async function createBotAction(data: BotCreate): Promise<BotConfig | null> {
  setLoading("create", true);
  setError(null);
  try {
    const bot = await createBot(data);
    await loadBots();
    state = {
      ...state,
      showCreateModal: false,
      loading: setLoadingState<BotLoadingKey>(state.loading, "create", false),
    };
    notify();
    return bot;
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to create bot",
      loading: setLoadingState<BotLoadingKey>(state.loading, "create", false),
    };
    notify();
    return null;
  }
}

// Update a bot
export async function updateBotAction(botId: string, data: BotUpdate): Promise<BotConfig | null> {
  setLoading("update", true);
  setError(null);
  try {
    const bot = await updateBot(botId, data);
    await loadBots();
    state = {
      ...state,
      showEditModal: false,
      editingBot: null,
      loading: setLoadingState<BotLoadingKey>(state.loading, "update", false),
    };
    notify();
    return bot;
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to update bot",
      loading: setLoadingState<BotLoadingKey>(state.loading, "update", false),
    };
    notify();
    return null;
  }
}

// Delete a bot (with trade check)
export async function deleteBotAction(botId: string): Promise<boolean> {
  setLoading("delete", true);
  setError(null);
  try {
    const tradeCount = await getBotTradeCount(botId);
    if (tradeCount.count > 0) {
      state = {
        ...state,
        error: `Cannot delete bot: ${tradeCount.count} trade(s) exist for this bot. Delete trades first.`,
        loading: setLoadingState<BotLoadingKey>(state.loading, "delete", false),
      };
      notify();
      return false;
    }

    await deleteBot(botId);
    await loadBots();
    state = {
      ...state,
      selectedBot: null,
      loading: setLoadingState<BotLoadingKey>(state.loading, "delete", false),
    };
    notify();
    return true;
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to delete bot",
      loading: setLoadingState<BotLoadingKey>(state.loading, "delete", false),
    };
    notify();
    return false;
  }
}

// Start a bot
export async function startBotAction(botId: string, testMode: boolean = false): Promise<boolean> {
  setLoading("start", true);
  setError(null);
  try {
    await startBot(botId, testMode);
    await loadBots();
    state = { ...state, loading: setLoadingState<BotLoadingKey>(state.loading, "start", false) };
    notify();
    return true;
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to start bot",
      loading: setLoadingState<BotLoadingKey>(state.loading, "start", false),
    };
    notify();
    return false;
  }
}

// Stop a bot
export async function stopBotAction(botId: string): Promise<boolean> {
  setLoading("stop", true);
  setError(null);
  try {
    await stopBot(botId);
    await loadBots();
    state = { ...state, loading: setLoadingState<BotLoadingKey>(state.loading, "stop", false) };
    notify();
    return true;
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to stop bot",
      loading: setLoadingState<BotLoadingKey>(state.loading, "stop", false),
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
  state = { ...state, selectedBot: bot, botStatus: null, botTrades: [] };
  notify();
  if (bot && bot.running) {
    loadBotStatus(bot.id);
  }
}

// Start auto-refresh for bot status
export function startAutoRefresh(botId: string, intervalMs: number = 5000): void {
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
