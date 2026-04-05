import { useEffect, useMemo, useCallback } from "react";
import * as state from "../state";
import { subscribe } from "../state";
import { fetchData, setupAutoRefresh, loadScreeners } from "../api";
import { initPreviewChartHandlers } from "../components/common/previewChart";
import { useStoreSubscription } from "./useStoreSubscription";
import type { ScreenerData } from "../types";

interface ScreenerDefaults {
  provider: string;
  mode: string;
}

export function getScreenerDefaults(data?: ScreenerData | null): ScreenerDefaults {
  return {
    provider: data?.provider || "upstox",
    mode: data?.mode || "intraday",
  };
}

export function useScreenerState() {
  useStoreSubscription(subscribe);

  // Load data on mount
  useEffect(() => {
    // Initialize preview chart handlers for hover/click functionality
    initPreviewChartHandlers();

    // Initialize screeners if not loaded
    if (state.screenerOptions.length === 0) {
      loadScreeners()
        .then(() => {
          fetchData(
            state.data?.provider || "upstox",
            state.data?.mode || "intraday",
            state.activeScreener,
          );
          setupAutoRefresh();
        })
        .catch((err) => {
          console.error("Failed to load screeners:", err);
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
    fetchData(state.data?.provider || "upstox", state.data?.mode || "intraday", screenerId);
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
    screenerOptions: state.screenerOptions,
    activeScreener: state.activeScreener,
    isLoading: state.isLoading,
    error: state.error,
    autoRefreshSeconds: state.autoRefreshSeconds,
    provider: state.data?.provider || "upstox",
    mode: state.data?.mode || "intraday",
    onRefresh,
    onAutoRefreshChange,
    onProviderChange,
    onModeChange,
    onScreenerChange,
    onSymbolClick,
    onSymbolHover,
  };
}
