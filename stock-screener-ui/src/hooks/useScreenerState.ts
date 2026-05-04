import { useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import * as state from "../state";
import { subscribe } from "../state";
import { fetchData, setupAutoRefresh, loadScreeners } from "../api";
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
  const navigate = useNavigate();
  useStoreSubscription(subscribe);

  // Load data on mount
  useEffect(() => {
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

  const onSymbolClick = useCallback(
    (symbol: string) => {
      navigate(`/chart/${symbol}`);
    },
    [navigate],
  );

  const onSymbolHover = useCallback((_symbol: string | null) => {}, []);

  return {
    approachingStocks,
    touchedStocks,
    screenerOptions: state.screenerOptions,
    activeScreener: state.activeScreener,
    isLoading: state.isLoading,
    error: state.error,
    warning: state.data?.warning || null,
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
