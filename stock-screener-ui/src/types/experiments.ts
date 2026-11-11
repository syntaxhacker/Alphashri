/**
 * Experiments Types
 *
 * Type definitions for the autoresearch experiment sweeps feature.
 * Shared shapes live in ./shared and are re-exported here so existing imports keep working.
 */

import type { BaseChartData, StrategyParam } from "./shared";

export type { StrategyParam } from "./shared";

export interface ExperimentStrategy {
  key: string;
  params: StrategyParam[];
}

export interface RunMetrics {
  total_trades: number;
  wins: number;
  losses: number;
  net_pnl: number;
  profit_factor: number;
  win_rate: number;
  tp_exits: number;
  sl_exits: number;
  eod_exits: number;
}

export interface ExperimentRun {
  run: number;
  metric: number;
  metrics: RunMetrics;
  per_symbol: Record<string, RunMetrics>;
  config: Record<string, any>;
  strategy: string;
  symbols: string[];
  tf: number;
  status: "keep" | "discard";
  description: string;
  timestamp: number;
}

export interface ExperimentSession {
  session: string;
  strategy: string;
  tf: number;
  symbols: string[];
  runs: number;
  status: string;
}

export interface ExperimentState {
  status: string;
  current: number;
  total: number;
  best_pf: number;
  best_desc: string;
  last_result: any;
  strategy: string;
  symbols: string[];
  tf: number;
}

export interface SweepParam {
  key: string;
  label: string;
  values: (number | string | boolean)[];
}

// Chart payload shares the backtest shape via ./shared (adds no RSI overlay).
export interface ExperimentChartData extends BaseChartData {}

/**
 * Loading state keys for experiment data-fetching operations.
 * Mirrors the keyed-loading pattern used by the bots module.
 */
export type ExperimentLoadingKey = "strategies" | "sessions" | "chart";
