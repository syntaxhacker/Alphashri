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
  createBot,
  updateBot,
  startBot,
  stopBot,
  stopAllBots,
  startAllBots,
  deleteBot,
  getBotStatus,
  getBotTrades,
  getBotTradeCount,
  listAvailableStrategies,
} from "../api/bots";
import { createLoadingState, setLoading as setLoadingState } from "../utils/loading";

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
    "stop-all",
    "trades",
  ]),
  error: null,
  showCreateModal: false,
  showEditModal: false,
  editingBot: null,
};

let state: BotsState = { ...initialState };

let currentViewValue: BotsView = "list";

const { subscribe, notify } = createSubscriber();
export { subscribe };

export function triggerRerender() {
  notify();
}

export function getBotsState(): BotsState {
  return state;
}

export function getCurrentView(): BotsView {
  return currentViewValue;
}

export function setCurrentView(view: BotsView) {
  currentViewValue = view;
  notify();
}

function setLoading(key: BotLoadingKey, loading: boolean) {
  state = { ...state, loading: setLoadingState<BotLoadingKey>(state.loading, key, loading) };
  notify();
}

function setError(error: string | null) {
  state = { ...state, error };
  notify();
}

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

async function loadAvailableStrategies(): Promise<void> {
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

export async function startAllBotsAction(): Promise<boolean> {
  setLoading("start-all", true);
  setError(null);
  try {
    await startAllBots();
    await loadBots();
    state = {
      ...state,
      loading: setLoadingState<BotLoadingKey>(state.loading, "start-all", false),
    };
    notify();
    return true;
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to start bots",
      loading: setLoadingState<BotLoadingKey>(state.loading, "start-all", false),
    };
    notify();
    return false;
  }
}

export async function stopAllBotsAction(): Promise<boolean> {
  setLoading("stop-all", true);
  setError(null);
  try {
    await stopAllBots();
    await loadBots();
    state = {
      ...state,
      loading: setLoadingState<BotLoadingKey>(state.loading, "stop-all", false),
    };
    notify();
    return true;
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : "Failed to stop bots",
      loading: setLoadingState<BotLoadingKey>(state.loading, "stop-all", false),
    };
    notify();
    return false;
  }
}

export function openCreateModal(): void {
  loadAvailableStrategies();
  state = { ...state, showCreateModal: true, showEditModal: false, editingBot: null };
  notify();
}

export function closeCreateModal(): void {
  state = { ...state, showCreateModal: false };
  notify();
}

export function openEditModal(bot: BotConfig): void {
  loadAvailableStrategies();
  state = { ...state, showEditModal: true, editingBot: bot, showCreateModal: false };
  notify();
}

export function closeEditModal(): void {
  state = { ...state, showEditModal: false, editingBot: null };
  notify();
}

export function clearError(): void {
  setError(null);
}

export function selectBot(bot: BotConfig | null): void {
  state = { ...state, selectedBot: bot, botStatus: null, botTrades: [] };
  notify();
  if (bot && bot.running) {
    loadBotStatus(bot.id);
  }
}

let initialized = false;
export function initBotsState(): void {
  if (initialized) return;
  initialized = true;
  loadBots();
}
