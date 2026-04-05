import type { StrategyConfig } from "../../types/strategies";
import { state, notify } from "../strategies";

export function openCreateModal(template: StrategyConfig | null = null): void {
  state.showCreateModal = true;
  state.parentTemplate = template;
  state.showEditModal = false;
  state.editingStrategy = null;
  notify();
}

export function closeCreateModal(): void {
  state.showCreateModal = false;
  state.parentTemplate = null;
  notify();
}

export function openEditModal(strategy: StrategyConfig): void {
  state.showEditModal = true;
  state.editingStrategy = strategy;
  state.showCreateModal = false;
  state.parentTemplate = null;
  notify();
}

export function closeEditModal(): void {
  state.showEditModal = false;
  state.editingStrategy = null;
  notify();
}
