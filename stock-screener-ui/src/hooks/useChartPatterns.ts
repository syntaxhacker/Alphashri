/**
 * `useChartPatterns` — subscribes to the chart-patterns store and exposes the
 * frozen contract shape (CONTRACT §6). Consumers never call `useState` for this
 * data; the store is the single source of truth.
 */

import { useCallback } from "react";
import { useStoreSubscription } from "./useStoreSubscription";
import type { JobDTO, PatternFilters } from "../types/chartPatterns";
import {
  subscribe,
  getChartPatternsState,
  loadSymbolDetail,
  selectTimeframe,
  selectUniverse,
  setFilter,
  resetFilters,
  applyFilters,
  triggerScan,
  refresh,
  setSelectedSymbol,
} from "../state/chartPatterns";

export interface UseChartPatternsResult {
  timeframes: ReturnType<typeof getChartPatternsState>["timeframes"];
  universes: ReturnType<typeof getChartPatternsState>["universes"];
  patterns: ReturnType<typeof getChartPatternsState>["patterns"];
  timeframe: string;
  setTimeframe: (v: string) => void;
  universe: string;
  setUniverse: (v: string) => void;
  filters: PatternFilters;
  setFilter: (k: string, v: unknown) => void;
  resetFilters: () => void;
  applyFilters: (filters: Partial<PatternFilters>) => void;
  job: JobDTO | null;
  scanning: boolean;
  queuePosition: number | null;
  summary: ReturnType<typeof getChartPatternsState>["summary"];
  results: ReturnType<typeof getChartPatternsState>["results"];
  total: number;
  selectedSymbol: string | null;
  setSelectedSymbol: (s: string | null) => void;
  detail: ReturnType<typeof getChartPatternsState>["detail"];
  detailChart: ReturnType<typeof getChartPatternsState>["detailChart"];
  loading: boolean;
  error: string | null;
  scan: () => void;
  refresh: () => void;
  loadSymbol: (s: string) => void;
}

export function useChartPatterns(): UseChartPatternsResult {
  useStoreSubscription(subscribe);
  const state = getChartPatternsState();

  // Stable identity: components use `setFilter` in effect dependency arrays, so a
  // fresh closure per render would re-trigger those effects (and reload loops).
  const handleSetFilter = useCallback((key: string, value: unknown) => {
    setFilter(key as keyof PatternFilters, value as PatternFilters[keyof PatternFilters]);
  }, []);

  return {
    timeframes: state.timeframes,
    universes: state.universes,
    patterns: state.patterns,
    timeframe: state.timeframe,
    setTimeframe: selectTimeframe,
    universe: state.universe,
    setUniverse: selectUniverse,
    filters: state.filters,
    setFilter: handleSetFilter,
    resetFilters,
    applyFilters,
    job: state.job,
    scanning: state.scanning,
    queuePosition: state.job?.queue_position ?? null,
    summary: state.summary,
    results: state.results,
    total: state.total,
    selectedSymbol: state.selectedSymbol,
    setSelectedSymbol,
    detail: state.detail,
    detailChart: state.detailChart,
    loading: state.loading,
    error: state.error,
    scan: () => {
      void triggerScan();
    },
    refresh,
    loadSymbol: (symbol: string) => {
      void loadSymbolDetail(symbol);
    },
  };
}
