import type {
  StrategyConfig,
  StrategyPerformance,
  BotConfig,
  StrategyCreate,
} from "../../types/strategies";

export type StrategyView = "tree" | "performance";

export type StrategyFormData = StrategyCreate;

export interface StrategiesPageProps {
  // State
  strategies: StrategyConfig[];
  templates: StrategyConfig[];
  performance: StrategyPerformance[];
  bots: BotConfig[];
  isLoading: boolean;
  error: string | null;

  // View state
  activeView: StrategyView;

  // Modal state
  showCreateModal: boolean;
  showEditModal: boolean;
  editingStrategy: StrategyConfig | null;
  parentTemplate: StrategyConfig | null;

  // View actions
  onViewChange: (view: StrategyView) => void;

  // Strategy actions
  onCreateStrategy: (data: StrategyFormData) => void;
  onEditStrategy: (strategyId: number, data: StrategyFormData) => void;
  onDeleteStrategy: (strategyId: number) => void;
  onOpenCreateModal: (template?: StrategyConfig) => void;
  onOpenEditModal: (strategy: StrategyConfig) => void;
  onCloseCreateModal: () => void;
  onCloseEditModal: () => void;

  // Template actions
  onCreateFromTemplate: (template: StrategyConfig) => void;

  // Performance actions
  onSelectStrategy: (strategyId: number) => void;

  // Data actions
  onUpdate: (strategyId: number, field: string, value: number) => Promise<void>;
  onRefresh: () => void;
  onClearError: () => void;

  // Bot state
  isAnyBotRunning: boolean;
}

export interface TemplateTreeViewProps {
  templates: StrategyConfig[];
  strategies: StrategyConfig[];
  onEditTemplate: (template: StrategyConfig) => void;
  onSyncVariations: (templateId: number) => void;
  onCreateFromTemplate: (template: StrategyConfig) => void;
  onEditStrategy: (strategy: StrategyConfig) => void;
  onDeleteStrategy: (strategyId: number) => void;
  onUpdate: (strategyId: number, field: string, value: number) => Promise<void>;
  isLoading: boolean;
}

export interface StrategiesNavProps {
  activeView: StrategyView;
  onChange: (view: StrategyView) => void;
}

export interface PerformanceViewProps {
  performance: StrategyPerformance[];
  strategies: StrategyConfig[];
  onSelectStrategy: (strategyId: number) => void;
  isLoading: boolean;
}

export interface StrategyFormProps {
  mode: "create" | "edit";
  strategy?: StrategyConfig | null;
  template?: StrategyConfig | null;
  opened: boolean;
  onClose: () => void;
  onSubmit: (data: StrategyFormData) => void;
  isBotRunning?: boolean;
}

