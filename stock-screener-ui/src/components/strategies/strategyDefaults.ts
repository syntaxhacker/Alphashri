import type { StrategyFormData, StrategyFormProps } from "./types";

export const DEFAULT_VALUES: StrategyFormData = {
  name: "",
  strategy_type: "ORB",
  parent_id: null,
  description: "",
  or_minutes: 15,
  sl_pct: 1.0,
  tp_pct: 1.5,
  min_or_range_pct: 0.3,
  max_or_range_pct: 2.0,
  max_positions: 3,
  max_capital_per_trade_pct: 20,
  max_daily_loss_pct: 5,
  max_total_exposure_pct: 50,
  risk_per_trade_pct: 2,
  min_trade_value: 5000,
  max_trade_value: 100000,
  cooldown_minutes: 30,
  max_distance_from_or_pct: 1.5,
  entry_threshold_pct: 3.0,
  enable_trailing_stop: false,
  trailing_stop_pct: 3.0,
  trailing_activation_pct: 2.0,
  max_holding_days: 30,
  cooldown_days: 30,
  enable_filters: false,
  ema_fast_period: 9,
  ema_slow_period: 21,
  pivot_type: "classic",
  breakout_buffer_pct: 0.1,
  min_rr_ratio: 2.0,
  screener_profiles: [],
};

export function getInitialValues(props: {
  mode: StrategyFormProps["mode"];
  strategy?: StrategyFormProps["strategy"];
  template?: StrategyFormProps["template"];
}): StrategyFormData {
  const { mode, strategy, template } = props;

  if (mode === "edit" && strategy) {
    return {
      name: strategy.name,
      strategy_type: strategy.strategy_type,
      parent_id: strategy.parent_id || undefined,
      description: strategy.description || "",
      or_minutes: strategy.or_minutes,
      sl_pct: strategy.sl_pct,
      tp_pct: strategy.tp_pct,
      min_or_range_pct: strategy.min_or_range_pct,
      max_or_range_pct: strategy.max_or_range_pct,
      max_positions: strategy.max_positions,
      max_capital_per_trade_pct: strategy.max_capital_per_trade_pct,
      max_daily_loss_pct: strategy.max_daily_loss_pct,
      max_total_exposure_pct: strategy.max_total_exposure_pct,
      risk_per_trade_pct: strategy.risk_per_trade_pct,
      min_trade_value: strategy.min_trade_value,
      max_trade_value: strategy.max_trade_value,
      cooldown_minutes: strategy.cooldown_minutes,
      max_distance_from_or_pct: strategy.max_distance_from_or_pct,
      entry_threshold_pct: strategy.entry_threshold_pct,
      enable_trailing_stop: strategy.enable_trailing_stop,
      trailing_stop_pct: strategy.trailing_stop_pct,
      trailing_activation_pct: strategy.trailing_activation_pct,
      max_holding_days: strategy.max_holding_days,
      cooldown_days: strategy.cooldown_days,
      enable_filters: strategy.enable_filters,
      ema_fast_period: strategy.ema_fast_period,
      ema_slow_period: strategy.ema_slow_period,
      pivot_type: strategy.pivot_type,
      breakout_buffer_pct: strategy.breakout_buffer_pct,
      min_rr_ratio: strategy.min_rr_ratio,
      screener_profiles: strategy.screener_profiles || [],
    };
  }

  if (template) {
    return {
      ...DEFAULT_VALUES,
      strategy_type: template.strategy_type,
      parent_id: template.internal_id ?? Number(template.id),
      name: `${template.name} - Custom`,
      or_minutes: template.or_minutes,
      sl_pct: template.sl_pct,
      tp_pct: template.tp_pct,
      min_or_range_pct: template.min_or_range_pct,
      max_or_range_pct: template.max_or_range_pct,
      max_positions: template.max_positions,
      max_capital_per_trade_pct: template.max_capital_per_trade_pct,
      max_daily_loss_pct: template.max_daily_loss_pct,
      max_total_exposure_pct: template.max_total_exposure_pct,
      risk_per_trade_pct: template.risk_per_trade_pct,
      min_trade_value: template.min_trade_value,
      max_trade_value: template.max_trade_value,
      cooldown_minutes: template.cooldown_minutes,
      max_distance_from_or_pct: template.max_distance_from_or_pct,
      entry_threshold_pct: template.entry_threshold_pct,
      enable_trailing_stop: template.enable_trailing_stop,
      trailing_stop_pct: template.trailing_stop_pct,
      trailing_activation_pct: template.trailing_activation_pct,
      max_holding_days: template.max_holding_days,
      cooldown_days: template.cooldown_days,
      enable_filters: template.enable_filters,
      ema_fast_period: template.ema_fast_period,
      ema_slow_period: template.ema_slow_period,
      pivot_type: template.pivot_type,
      breakout_buffer_pct: template.breakout_buffer_pct,
      min_rr_ratio: template.min_rr_ratio,
      screener_profiles: template.screener_profiles || [],
    };
  }

  return DEFAULT_VALUES;
}
