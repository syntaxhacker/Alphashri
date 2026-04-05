import type { BotConfig, BotCreate, BotUpdate, BotLoadingKey } from "../../types/bots";
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
} from "../../api/bots";
import { setLoading as setLoadingState } from "../../utils/loading";
import { getBotsState, setLoading, setError, notify } from "./internal";

export async function loadBots(): Promise<void> {
  setLoading("list", true);
  setError(null);
  try {
    const bots = await listBots();
    const s = getBotsState();
    s.bots = bots;
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "list", false);
    notify();
  } catch (error) {
    const s = getBotsState();
    s.error = error instanceof Error ? error.message : "Failed to load bots";
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "list", false);
    notify();
  }
}

export async function loadBot(botId: string): Promise<void> {
  setLoading("load", true);
  setError(null);
  try {
    const bot = await getBot(botId);
    const s = getBotsState();
    s.selectedBot = bot;
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "load", false);
    notify();
  } catch (error) {
    const s = getBotsState();
    s.error = error instanceof Error ? error.message : "Failed to load bot";
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "load", false);
    notify();
  }
}

export async function loadBotStatus(botId: string): Promise<void> {
  setLoading("status", true);
  try {
    const status = await getBotStatus(botId);
    const s = getBotsState();
    s.botStatus = status;
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "status", false);
    notify();
  } catch (error) {
    console.error("Failed to load bot status:", error);
    const s = getBotsState();
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "status", false);
    notify();
  }
}

export async function loadBotTrades(botId: string, strategyId?: string): Promise<void> {
  setLoading("trades", true);
  try {
    const result = await getBotTrades(botId, strategyId, 50);
    const s = getBotsState();
    s.botTrades = result.trades;
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "trades", false);
    notify();
  } catch (error) {
    console.error("Failed to load bot trades:", error);
    const s = getBotsState();
    s.botTrades = [];
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "trades", false);
    notify();
  }
}

export async function loadAvailableStrategies(): Promise<void> {
  setLoading("strategies", true);
  try {
    const strategies = await listAvailableStrategies();
    const s = getBotsState();
    s.availableStrategies = strategies;
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "strategies", false);
    notify();
  } catch (error) {
    console.error("Failed to load available strategies:", error);
    const s = getBotsState();
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "strategies", false);
    notify();
  }
}

export async function createBotAction(data: BotCreate): Promise<BotConfig | null> {
  setLoading("create", true);
  setError(null);
  try {
    const bot = await createBot(data);
    await loadBots();
    const s = getBotsState();
    s.showCreateModal = false;
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "create", false);
    notify();
    return bot;
  } catch (error) {
    const s = getBotsState();
    s.error = error instanceof Error ? error.message : "Failed to create bot";
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "create", false);
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
    const s = getBotsState();
    s.showEditModal = false;
    s.editingBot = null;
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "update", false);
    notify();
    return bot;
  } catch (error) {
    const s = getBotsState();
    s.error = error instanceof Error ? error.message : "Failed to update bot";
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "update", false);
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
      const s = getBotsState();
      s.error = `Cannot delete bot: ${tradeCount.count} trade(s) exist for this bot. Delete trades first.`;
      s.loading = setLoadingState<BotLoadingKey>(s.loading, "delete", false);
      notify();
      return false;
    }

    await deleteBot(botId);
    await loadBots();
    const s = getBotsState();
    s.selectedBot = null;
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "delete", false);
    notify();
    return true;
  } catch (error) {
    const s = getBotsState();
    s.error = error instanceof Error ? error.message : "Failed to delete bot";
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "delete", false);
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
    const s = getBotsState();
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "start", false);
    notify();
    return true;
  } catch (error) {
    const s = getBotsState();
    s.error = error instanceof Error ? error.message : "Failed to start bot";
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "start", false);
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
    const s = getBotsState();
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "stop", false);
    notify();
    return true;
  } catch (error) {
    const s = getBotsState();
    s.error = error instanceof Error ? error.message : "Failed to stop bot";
    s.loading = setLoadingState<BotLoadingKey>(s.loading, "stop", false);
    notify();
    return false;
  }
}
