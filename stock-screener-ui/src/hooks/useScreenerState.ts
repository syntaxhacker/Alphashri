import { createEffect, createMemo } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
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

/**
 * Screener page state.
 *
 * Every field is exposed as a **getter** so the caller reads it live. A Solid
 * component body runs once, so a destructured snapshot would never update —
 * the consumer must hold the object and read `s.isLoading`, not `const
 * { isLoading } = s`.
 */
export function useScreenerState(initialScreener?: string) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  useStoreSubscription(subscribe);

  let initialLoadDone = false;

  // Load data on mount — only once. `createEffect` with no reactive read runs
  // exactly once, which is what the React `[]` dependency array meant here.
  createEffect(() => {
    if (initialLoadDone) return;
    initialLoadDone = true;

    const useUrlScreener =
      initialScreener && (!state.screenerOptions.length || initialScreener !== state.activeScreener);
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
          initialLoadDone = false;
        });
    } else {
      fetchScreener(undefined, undefined, state.activeScreener);
      setupAutoRefresh();
    }
  });

  const approachingStocks = createMemo(() => approachingStocksOf(state.data));
  const touchedStocks = createMemo(() => touchedStocksOf(state.data));

  // Actions are plain functions: a Solid function defined in the component body
  // is already referentially stable, so useCallback has nothing to memoise.
  const onRefresh = () => {
    fetchScreener(undefined, undefined, state.activeScreener);
  };

  const onAutoRefreshChange = (seconds: number) => {
    state.setAutoRefreshSeconds(seconds);
    setupAutoRefresh();
  };

  const onProviderChange = (newProvider: string) => {
    fetchScreener(newProvider, undefined, state.activeScreener);
  };

  const onModeChange = (newMode: string) => {
    fetchScreener(undefined, newMode, state.activeScreener);
  };

  const onScreenerChange = (screenerId: string) => {
    const cleanId = screenerId.replace(/^builtin:/, "");
    state.setActiveScreener(cleanId);
    fetchScreener(undefined, undefined, cleanId);
    setupAutoRefresh();
    const next = new URLSearchParams(searchParams as unknown as Record<string, string>);
    next.set("screener", cleanId);
    setSearchParams(next as never, { replace: true });
  };

  const onConfigScreenerSelect = (screenerId: string) => {
    state.setActiveScreener(screenerId);
  };

  const onSymbolClick = (symbol: string) => {
    navigate(`/chart/${symbol}`);
  };

  const onSymbolHover = (_symbol: string | null) => {};

  return {
    get approachingStocks() {
      return approachingStocks();
    },
    get touchedStocks() {
      return touchedStocks();
    },
    get screenerOptions() {
      return state.screenerOptions;
    },
    get activeScreener() {
      return state.activeScreener;
    },
    get isLoading() {
      return state.isLoading;
    },
    get error() {
      return state.error;
    },
    get warning() {
      return state.data?.warning || null;
    },
    get autoRefreshSeconds() {
      return state.autoRefreshSeconds;
    },
    get provider() {
      return getScreenerDefaults(state.data).provider;
    },
    get mode() {
      return getScreenerDefaults(state.data).mode;
    },
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