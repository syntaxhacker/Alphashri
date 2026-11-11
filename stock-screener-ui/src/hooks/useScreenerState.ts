import { useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as state from "../state";
import { subscribe } from "../state";
import { fetchData, setupAutoRefresh, loadScreeners } from "../api";
import { useStoreSubscription } from "./useStoreSubscription";
import { approachingStocksOf, touchedStocksOf } from "@/api/screenerQuery";
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

function fetchScreener(provider: string | undefined, mode: string | undefined, screener: string) {
  const defaults = getScreenerDefaults(state.data);
  return fetchData(provider || defaults.provider, mode || defaults.mode, screener);
}

export function useScreenerState(initialScreener?: string) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useStoreSubscription(subscribe);
  const initialLoadDone = useRef(false);

  // Load data on mount - only once
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    const useUrlScreener = initialScreener && (!state.screenerOptions.length || initialScreener !== state.activeScreener);
    if (useUrlScreener) {
      state.setActiveScreener(initialScreener);
    }

    if (state.screenerOptions.length === 0) {
      loadScreeners(!useUrlScreener)
        .then(() => {
          if (useUrlScreener) {
            state.setActiveScreener(initialScreener);
          }
          fetchScreener(undefined, undefined, state.activeScreener);
          setupAutoRefresh();
        })
        .catch((err) => {
          console.error("Failed to load screeners:", err);
          initialLoadDone.current = false;
        });
    } else {
      fetchScreener(undefined, undefined, state.activeScreener);
      setupAutoRefresh();
    }
  }, []);

  // Derived state from global state
  const approachingStocks = useMemo(() => {
    return approachingStocksOf(state.data);
  }, [state.data]);

  const touchedStocks = useMemo(() => {
    return touchedStocksOf(state.data);
  }, [state.data]);

  // Actions
  const onRefresh = useCallback(() => {
    fetchScreener(undefined, undefined, state.activeScreener);
  }, []);

  const onAutoRefreshChange = useCallback((seconds: number) => {
    state.setAutoRefreshSeconds(seconds);
    setupAutoRefresh();
  }, []);

  const onProviderChange = useCallback((newProvider: string) => {
    fetchScreener(newProvider, undefined, state.activeScreener);
  }, []);

  const onModeChange = useCallback((newMode: string) => {
    fetchScreener(undefined, newMode, state.activeScreener);
  }, []);

  const onScreenerChange = useCallback((screenerId: string) => {
    const cleanId = screenerId.replace(/^builtin:/, "");
    state.setActiveScreener(cleanId);
    fetchScreener(undefined, undefined, cleanId);
    setupAutoRefresh();
    const next = new URLSearchParams(searchParams);
    next.set("screener", cleanId);
    setSearchParams(next, { replace: true });
  }, [searchParams]);

  const onConfigScreenerSelect = useCallback((screenerId: string) => {
    state.setActiveScreener(screenerId);
  }, []);

  const onSymbolClick = useCallback(
    (symbol: string) => {
      navigate(`/chart/${symbol}`);
    },
    [navigate],
  );

  const onSymbolHover = useCallback((_symbol: string | null) => {}, []);

  const { provider, mode } = getScreenerDefaults(state.data);

  return {
    approachingStocks,
    touchedStocks,
    screenerOptions: state.screenerOptions,
    activeScreener: state.activeScreener,
    isLoading: state.isLoading,
    error: state.error,
    warning: state.data?.warning || null,
    autoRefreshSeconds: state.autoRefreshSeconds,
    provider,
    mode,
    onRefresh,
    onAutoRefreshChange,
    onProviderChange,
    onModeChange,
    onScreenerChange,
    onConfigScreenerSelect,
    onSymbolClick,
    onSymbolHover,
  };
}
