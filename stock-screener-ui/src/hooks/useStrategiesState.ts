import { useEffect, useCallback, useState } from "react";
import * as strategiesState from "../state/strategies";
import type { StrategyConfig } from "../types/strategies";
import type { StrategyView, StrategyFormData } from "../components/strategies/types";

export function useStrategiesState() {
  const [, setTick] = useState(0);
  const state = strategiesState.getStrategiesState();

  useEffect(() => {
    const unsubscribe = strategiesState.subscribe(() => {
      setTick((t) => t + 1);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const handleViewChange = useCallback((view: StrategyView) => {
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
    const currentView = strategiesState.getCurrentView();
    if (currentView === "templates") {
      strategiesState.loadTemplates();
    } else if (currentView === "list") {
      strategiesState.loadStrategies(true);
    } else if (currentView === "performance") {
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

  const handleSetActiveStrategy = useCallback((strategyId: number) => {
    if ((window as any).setActiveStrategy) {
      (window as any).setActiveStrategy(strategyId);
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
    activeView: strategiesState.getCurrentView() as StrategyView,
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
    onSetActiveStrategy: handleSetActiveStrategy,
    onClearError: handleClearError,
  };
}
