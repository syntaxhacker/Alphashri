/**
 * Strategy Management Component Types
 */

import type { StrategyConfig, StrategyPerformance, BotConfig } from "../../types/strategies";

export type StrategyView = "templates" | "list" | "performance";

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
  onRefresh: () => void;
  onClearError: () => void;
}

export interface StrategiesNavProps {
  activeView: StrategyView;
  onChange: (view: StrategyView) => void;
}

export interface TemplatesViewProps {
  templates: StrategyConfig[];
  strategies: StrategyConfig[];
  onCreateFromTemplate: (template: StrategyConfig) => void;
  isLoading: boolean;
}

export interface StrategiesListProps {
  strategies: StrategyConfig[];
  templates: StrategyConfig[];
  onEdit: (strategy: StrategyConfig) => void;
  onDelete: (strategyId: number) => void;
  isLoading: boolean;
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
}

export interface StrategyFormData {
  name: string;
  strategy_type: string;
  parent_id?: number | null;
  description?: string;
  or_minutes?: number;
  sl_pct?: number;
  tp_pct?: number;
  min_or_range_pct?: number;
  max_or_range_pct?: number;
  max_positions?: number;
  max_capital_per_trade_pct?: number;
  max_daily_loss_pct?: number;
  max_total_exposure_pct?: number;
  risk_per_trade_pct?: number;
  min_trade_value?: number;
  max_trade_value?: number;
  cooldown_minutes?: number;
  max_distance_from_or_pct?: number;
}

export interface TemplateCardProps {
  template: StrategyConfig;
  variations: StrategyConfig[];
  onCreateFromTemplate: (template: StrategyConfig) => void;
}
