import { useState, useEffect, useMemo, useCallback } from "react";
import * as state from "../state";
import { subscribe } from "../state";
import { getUniqueSectors } from "../components/filters";
import { getActiveProfileMeta, initProfileFilters } from "../components/profile";
import { fetchData, setupAutoRefresh, loadScreeners } from "../api";
import { initPreviewChartHandlers } from "../components/common/previewChart";

export function useScreenerState() {
  const [, forceUpdate] = useState(0);

  // Subscribe to state changes
  useEffect(() => {
    const unsubscribe = subscribe(() => {
      forceUpdate((n) => n + 1);
    });
    return unsubscribe;
  }, []);

  // Load data on mount
  useEffect(() => {
    // Initialize preview chart handlers for hover/click functionality
    initPreviewChartHandlers();

    // Initialize screeners if not loaded
    if (state.screenerOptions.length === 0) {
      loadScreeners(initProfileFilters).then(() => {
        fetchData(
          state.data?.provider || "upstox",
          state.data?.mode || "intraday",
          state.activeScreener,
        );
        setupAutoRefresh();
      });
    } else {
      fetchData(
        state.data?.provider || "upstox",
        state.data?.mode || "intraday",
        state.activeScreener,
      );
      setupAutoRefresh();
    }
  }, []);

  // Derived state from global state
  const approachingStocks = useMemo(() => {
    return state.data?.approaching || [];
  }, [state.data]);

  const touchedStocks = useMemo(() => {
    return state.data?.touched || [];
  }, [state.data]);

  const allStocks = useMemo(() => {
    return [...approachingStocks, ...touchedStocks];
  }, [approachingStocks, touchedStocks]);

  const sectors = useMemo(() => getUniqueSectors(allStocks), [allStocks]);

  const profileFilters = useMemo(() => {
    const meta = getActiveProfileMeta();
    return meta?.filters?.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      min: f.min,
      max: f.max,
      step: f.step,
      options: f.options?.map((opt) => ({ value: opt, label: opt })),
    }));
  }, [state.activeScreener]);

  // Actions
  const onRefresh = useCallback(() => {
    fetchData(
      state.data?.provider || "upstox",
      state.data?.mode || "intraday",
      state.activeScreener,
    );
  }, []);

  const onAutoRefreshChange = useCallback((seconds: number) => {
    state.setAutoRefreshSeconds(seconds);
    setupAutoRefresh();
  }, []);

  const onProviderChange = useCallback((newProvider: string) => {
    fetchData(newProvider, state.data?.mode || "intraday", state.activeScreener);
  }, []);

  const onModeChange = useCallback((newMode: string) => {
    fetchData(state.data?.provider || "upstox", newMode, state.activeScreener);
  }, []);

  const onScreenerChange = useCallback((screenerId: string) => {
    state.setActiveScreener(screenerId);
    initProfileFilters(screenerId);
    fetchData(state.data?.provider || "upstox", state.data?.mode || "intraday", screenerId);
  }, []);

  const onFilterChange = useCallback((key: string, value: any) => {
    state.updateFilter(key as keyof typeof state.filters, value);
  }, []);

  const onResetFilters = useCallback(() => {
    state.resetFilters();
    initProfileFilters(state.activeScreener);
  }, []);

  const onSymbolClick = useCallback((symbol: string) => {
    if ((window as any).onSymbolClick) {
      (window as any).onSymbolClick(symbol);
    }
  }, []);

  const onSymbolHover = useCallback((symbol: string | null) => {
    if ((window as any).onSymbolHover) {
      (window as any).onSymbolHover(symbol);
    }
  }, []);

  return {
    approachingStocks,
    touchedStocks,
    filters: state.filters,
    sectors,
    screenerOptions: state.screenerOptions,
    activeScreener: state.activeScreener,
    isLoading: state.isLoading,
    error: state.error,
    autoRefreshSeconds: state.autoRefreshSeconds,
    provider: state.data?.provider || "upstox",
    mode: state.data?.mode || "intraday",
    profileFilters,
    onRefresh,
    onAutoRefreshChange,
    onProviderChange,
    onModeChange,
    onScreenerChange,
    onFilterChange,
    onResetFilters,
    onSymbolClick,
    onSymbolHover,
  };
}
