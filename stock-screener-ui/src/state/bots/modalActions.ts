import type { BotConfig } from "../../types/bots";
import { loadAvailableStrategies } from "./crudActions";
import { getBotsState, notify } from "./internal";

export function openCreateModal(): void {
  loadAvailableStrategies();
  const s = getBotsState();
  s.showCreateModal = true;
  s.showEditModal = false;
  s.editingBot = null;
  notify();
}

export function closeCreateModal(): void {
  const s = getBotsState();
  s.showCreateModal = false;
  notify();
}

export function openEditModal(bot: BotConfig): void {
  loadAvailableStrategies();
  const s = getBotsState();
  s.showEditModal = true;
  s.editingBot = bot;
  s.showCreateModal = false;
  notify();
}

export function closeEditModal(): void {
  const s = getBotsState();
  s.showEditModal = false;
  s.editingBot = null;
  notify();
}
