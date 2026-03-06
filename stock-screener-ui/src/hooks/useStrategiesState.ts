import { useState, useEffect, useCallback } from "react";
import * as strategiesState from "../state/strategies";
import type { StrategiesView, StrategyConfig, StrategyFormData } from "../types/strategies";

export function useStrategiesState() {
  const [state, setState] = useState(strategiesState.getStrategiesState());

  useEffect(() => {
    const unsubscribe = strategiesState.subscribe(() => {
      setState(strategiesState.getStrategiesState());
    });
    return unsubscribe;
  }, []);

  const handleViewChange = useCallback((view: StrategiesView) => {
    strategiesState.setCurrentView(view);
    if (view === "templates") {
      strategiesState.loadTemplates();
    } else if (view === "list") {
      strategiesState.loadStrategies(true);
    } else if (view === "performance") {
      strategiesState.loadAllPerformance();
    }
  }, []);

  const handleRefresh = useCallback(() => {
    const currentState = strategiesState.getStrategiesState();
    if (currentState.activeView === "templates") {
      strategiesState.loadTemplates();
    } else if (currentState.activeView === "list") {
      strategiesState.loadStrategies(true);
    } else if (currentState.activeView === "performance") {
      strategiesState.loadAllPerformance();
    }
  }, []);

  const handleOpenCreateModal = useCallback((template?: StrategyConfig) => {
    strategiesState.openCreateModal(template || null);
  }, []);

  const handleOpenEditModal = useCallback((strategy: StrategyConfig) => {
    strategiesState.openEditModal(strategy);
  }, []);

  const handleCloseCreateModal = useCallback(() => {
    strategiesState.closeCreateModal();
  }, []);

  const handleCloseEditModal = useCallback(() => {
    strategiesState.closeEditModal();
  }, []);

  const handleCreateStrategy = useCallback((data: StrategyFormData) => {
    if ((window as any).createStrategy) {
      (window as any).createStrategy(data);
    }
  }, []);

  const handleEditStrategy = useCallback((strategyId: number, data: StrategyFormData) => {
    if ((window as any).updateStrategy) {
      (window as any).updateStrategy(strategyId, data);
    }
  }, []);

  const handleDeleteStrategy = useCallback((strategyId: number) => {
    if ((window as any).deleteStrategy) {
      (window as any).deleteStrategy(strategyId);
    }
  }, []);

  const handleCreateFromTemplate = useCallback((template: StrategyConfig) => {
    strategiesState.openCreateModal(template);
  }, []);

  const handleSelectStrategy = useCallback((strategyId: number) => {
    if ((window as any).viewStrategyDetails) {
      (window as any).viewStrategyDetails(strategyId);
    }
  }, []);

  const handleClearError = useCallback(() => {
    strategiesState.clearError();
  }, []);

  return {
    strategies: state.strategies,
    templates: state.templates,
    performance: state.allPerformance,
    bots: state.bots,
    isLoading: state.isLoading,
    error: state.error,
    activeView: state.activeView,
    showCreateModal: state.showCreateModal,
    showEditModal: state.showEditModal,
    editingStrategy: state.editingStrategy,
    parentTemplate: state.parentTemplate,
    onViewChange: handleViewChange,
    onRefresh: handleRefresh,
    onOpenCreateModal: handleOpenCreateModal,
    onOpenEditModal: handleOpenEditModal,
    onCloseCreateModal: handleCloseCreateModal,
    onCloseEditModal: handleCloseEditModal,
    onCreateStrategy: handleCreateStrategy,
    onEditStrategy: handleEditStrategy,
    onDeleteStrategy: handleDeleteStrategy,
    onCreateFromTemplate: handleCreateFromTemplate,
    onSelectStrategy: handleSelectStrategy,
    onClearError: handleClearError,
  };
}
