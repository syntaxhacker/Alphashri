import type { BotConfig } from "../types/bots";
import {
  subscribe,
  notify,
  getBotsState,
  getCurrentView,
  setCurrentView,
  clearError,
  triggerRerender,
} from "./bots/internal";
import {
  loadBots,
  loadBot,
  loadBotStatus,
  loadBotTrades,
  loadAvailableStrategies,
  createBotAction,
  updateBotAction,
  deleteBotAction,
  startBotAction,
  stopBotAction,
} from "./bots/crudActions";
import {
  openCreateModal,
  closeCreateModal,
  openEditModal,
  closeEditModal,
} from "./bots/modalActions";
import { startAutoRefresh, stopAutoRefresh } from "./bots/autoRefresh";

export {
  subscribe,
  notify,
  getBotsState,
  getCurrentView,
  setCurrentView,
  clearError,
  triggerRerender,
  loadBots,
  loadBot,
  loadBotStatus,
  loadBotTrades,
  loadAvailableStrategies,
  createBotAction,
  updateBotAction,
  deleteBotAction,
  startBotAction,
  stopBotAction,
  openCreateModal,
  closeCreateModal,
  openEditModal,
  closeEditModal,
  startAutoRefresh,
  stopAutoRefresh,
};

export function selectBot(bot: BotConfig | null): void {
  const s = getBotsState();
  s.selectedBot = bot;
  s.botStatus = null;
  s.botTrades = [];
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
