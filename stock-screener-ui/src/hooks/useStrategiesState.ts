import { createMemo } from "solid-js";
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
  const onViewChange = (view: StrategyView) => {
    strategiesState.setCurrentView(view);
    loadForView(view);
  };

  const onRefresh = () => {
    loadForView(strategiesState.getCurrentView() as StrategyView);
  };

  return { onViewChange, onRefresh };
}

function useModalActions() {
  const onOpenCreateModal = (template?: StrategyConfig) => {
    strategiesState.openCreateModal(template || null);
  };

  const onOpenEditModal = (strategy: StrategyConfig) => {
    strategiesState.openEditModal(strategy);
  };

  const onCloseCreateModal = () => {
    strategiesState.closeCreateModal();
  };

  const onCloseEditModal = () => {
    strategiesState.closeEditModal();
  };

  const onCreateFromTemplate = (template: StrategyConfig) => {
    strategiesState.openCreateModal(template);
  };

  return {
    onOpenCreateModal,
    onOpenEditModal,
    onCloseCreateModal,
    onCloseEditModal,
    onCreateFromTemplate,
  };
}

function useStrategyActions() {
  const onCreate = (_data: StrategyFormData) => {};

  const onEdit = (_strategyId: number, _data: StrategyFormData) => {};

  const onDelete = (_strategyId: number) => {};

  const onSelect = (_strategyId: number) => {};

  return { onCreate, onEdit, onDelete, onSelect };
}

export function useStrategiesState() {
  const version = useStoreSubscription(strategiesState.subscribe);
  const botsVersion = useStoreSubscription(botsState.subscribe);

  // Module singletons: read the counter first so getters re-run on notify.
  const readState = () => {
    version();
    return strategiesState.getStrategiesState();
  };
  const readBots = () => {
    botsVersion();
    return botsState.getBotsState();
  };
  const isAnyBotRunning = createMemo(() => readBots().bots.some((b) => b.running));

  const { onViewChange, onRefresh } = useViewActions();
  const {
    onOpenCreateModal,
    onOpenEditModal,
    onCloseCreateModal,
    onCloseEditModal,
    onCreateFromTemplate,
  } = useModalActions();
  const { onCreate, onEdit, onDelete, onSelect } = useStrategyActions();

  const onClearError = () => {
    strategiesState.clearError();
  };

  const onUpdate = async (strategyId: number, field: string, value: number) => {
    const result = await apiUpdateStrategy(strategyId, { [field]: value });
    if (result.strategy) {
      strategiesState.loadStrategies(false);
    }
    return result;
  };

  const onEditTemplate = (template: StrategyConfig) => {
    strategiesState.openEditModal(template);
  };

  const onSyncVariationsCb = (templateId: number) => {
    syncVariations(templateId);
  };

  // Getters, not values: a Solid component body runs once, so a snapshot would
  // never show data that arrives after mount.
  return {
    get strategies() {
      return readState().strategies;
    },
    get templates() {
      return readState().templates;
    },
    get performance() {
      return readState().allPerformance;
    },
    get bots() {
      return readState().bots;
    },
    get isLoading() {
      return readState().isLoading;
    },
    get error() {
      return readState().error;
    },
    get activeView() {
      version();
      return strategiesState.getCurrentView() as StrategyView;
    },
    get showCreateModal() {
      return readState().showCreateModal;
    },
    get showEditModal() {
      return readState().showEditModal;
    },
    get editingStrategy() {
      return readState().editingStrategy;
    },
    get parentTemplate() {
      return readState().parentTemplate;
    },
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
    get isAnyBotRunning() {
      return isAnyBotRunning();
    },
  };
}
