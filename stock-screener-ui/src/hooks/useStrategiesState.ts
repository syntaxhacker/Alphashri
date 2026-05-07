import { useCallback } from "react";
import * as strategiesState from "../state/strategies";
import * as botsState from "../state/bots";
import { useStoreSubscription } from "./useStoreSubscription";
import { updateStrategy as apiUpdateStrategy } from "../api/strategies";
import { syncVariations } from "../state/strategies";
import type { StrategyConfig } from "../types/strategies";
import type { StrategyView, StrategyFormData } from "../components/strategies/types";

export type ViewLoadAction = "loadTemplates" | "loadStrategies" | "loadAllPerformance" | null;

export function getViewLoadAction(view: StrategyView): ViewLoadAction {
  switch (view) {
    case "tree":
      return "loadTemplates";
    case "performance":
      return "loadAllPerformance";
    default:
      return null;
  }
}

function loadForView(view: StrategyView) {
  if (view === "tree") {
    strategiesState.loadTemplates();
    strategiesState.loadStrategies(true);
  } else if (view === "performance") {
    strategiesState.loadAllPerformance();
  }
}

function useViewActions() {
  const onViewChange = useCallback((view: StrategyView) => {
    strategiesState.setCurrentView(view);
    loadForView(view);
  }, []);

  const onRefresh = useCallback(() => {
    loadForView(strategiesState.getCurrentView() as StrategyView);
  }, []);

  return { onViewChange, onRefresh };
}

function useModalActions() {
  const onOpenCreateModal = useCallback((template?: StrategyConfig) => {
    strategiesState.openCreateModal(template || null);
  }, []);

  const onOpenEditModal = useCallback((strategy: StrategyConfig) => {
    strategiesState.openEditModal(strategy);
  }, []);

  const onCloseCreateModal = useCallback(() => {
    strategiesState.closeCreateModal();
  }, []);

  const onCloseEditModal = useCallback(() => {
    strategiesState.closeEditModal();
  }, []);

  const onCreateFromTemplate = useCallback((template: StrategyConfig) => {
    strategiesState.openCreateModal(template);
  }, []);

  return {
    onOpenCreateModal,
    onOpenEditModal,
    onCloseCreateModal,
    onCloseEditModal,
    onCreateFromTemplate,
  };
}

function useStrategyActions() {
  const onCreate = useCallback((_data: StrategyFormData) => {}, []);

  const onEdit = useCallback((_strategyId: number, _data: StrategyFormData) => {}, []);

  const onDelete = useCallback((_strategyId: number) => {}, []);

  const onSelect = useCallback((_strategyId: number) => {}, []);

  return { onCreate, onEdit, onDelete, onSelect };
}

export function useStrategiesState() {
  useStoreSubscription(strategiesState.subscribe);
  useStoreSubscription(botsState.subscribe);
  const state = strategiesState.getStrategiesState();
  const botsData = botsState.getBotsState();
  const isAnyBotRunning = botsData.bots.some((b) => b.running);

  const { onViewChange, onRefresh } = useViewActions();
  const {
    onOpenCreateModal,
    onOpenEditModal,
    onCloseCreateModal,
    onCloseEditModal,
    onCreateFromTemplate,
  } = useModalActions();
  const { onCreate, onEdit, onDelete, onSelect } = useStrategyActions();

  const onClearError = useCallback(() => {
    strategiesState.clearError();
  }, []);

  const onUpdate = useCallback(async (strategyId: number, field: string, value: number) => {
    const result = await apiUpdateStrategy(strategyId, { [field]: value });
    if (result.strategy) {
      strategiesState.loadStrategies(false);
    }
    return result;
  }, []);

  const onEditTemplate = useCallback((template: StrategyConfig) => {
    strategiesState.openEditModal(template);
  }, []);

  const onSyncVariationsCb = useCallback((templateId: number) => {
    syncVariations(templateId);
  }, []);

  return {
    strategies: state.strategies,
    templates: state.templates,
    performance: state.allPerformance,
    bots: state.bots,
    isLoading: state.isLoading,
    error: state.error,
    activeView: strategiesState.getCurrentView() as StrategyView,
    showCreateModal: state.showCreateModal,
    showEditModal: state.showEditModal,
    editingStrategy: state.editingStrategy,
    parentTemplate: state.parentTemplate,
    onViewChange,
    onRefresh,
    onOpenCreateModal,
    onOpenEditModal,
    onCloseCreateModal,
    onCloseEditModal,
    onCreateStrategy: onCreate,
    onEditStrategy: onEdit,
    onDeleteStrategy: onDelete,
    onCreateFromTemplate,
    onEditTemplate,
    onSyncVariations: onSyncVariationsCb,
    onSelectStrategy: onSelect,
    onClearError,
    onUpdate,
    isAnyBotRunning,
  };
}
