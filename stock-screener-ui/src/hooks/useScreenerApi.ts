import { useState, useCallback, useRef, useEffect } from "react";
import { useApi, UseApiState } from "./useApi";
import type { Stock, ScreenerData } from "../types";
export interface ScreenerParams {
  provider?: string;
  mode?: string;
  screener: string;
  columns?: string[];
  filters?: Record<string, string | number | boolean | undefined>;
}
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";
function buildScreenerUrl(params: ScreenerParams): string {
  const searchParams = new URLSearchParams();
  searchParams.set("provider", params.provider || "upstox");
  searchParams.set("mode", params.mode || "intraday");
  searchParams.set("screener", params.screener);
  if (params.filters) {
    Object.entries(params.filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.set(key, String(value));
      }
    });
  }
  return `${API_BASE}/api/screener?${searchParams.toString()}`;
}
export type ScreenerApiState = UseApiState<ScreenerData>;
export function useScreenerApi(params: ScreenerParams): ScreenerApiState {
  const url = buildScreenerUrl(params);
  const state = useApi<ScreenerData>({
    url,
    params: {},
    immediate: false,
  });
  return state;
}
export function useScreenerPreview(
  activeScreener: string,
  columns?: string[],
  filters?: Record<string, any>,
): {
  stocks: Stock[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  abort: () => void;
} {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const paramsRef = useRef({
    activeScreener,
    columns,
    filters,
  });
  useEffect(() => {
    paramsRef.current = {
      activeScreener,
      columns,
      filters,
    };
  }, [activeScreener, columns, filters]);
  const buildPreviewUrl = useCallback(() => {
    const { activeScreener: screener, columns: cols, filters: filts } = paramsRef.current;
    const searchParams = new URLSearchParams();
    searchParams.set("provider", "upstox");
    searchParams.set("mode", "intraday");
    searchParams.set("screener", screener.replace("builtin:", ""));
    if (cols && cols.length > 0) {
      searchParams.set("columns", cols.join(","));
    }
    if (filts && filts.length > 0) {
      filts.forEach((filter) => {
        if (filter.default !== undefined) {
          searchParams.set(filter.key, String(filter.default));
        }
      });
    }
    return `${API_BASE}/api/screener?${searchParams.toString()}`;
  }, []);
  const state = useApi<{
    approaching: Stock[];
    touched: Stock[];
  }>({
    url: buildPreviewUrl,
    immediate: true,
  });
  useEffect(() => {
    if (state.data) {
      setStocks(state.data.approaching || []);
    }
    if (state.error) {
    }
  }, [state.data, state.error]);
  return {
    stocks,
    loading: state.isLoading,
    error: state.error,
    refresh: state.execute,
    abort: state.abort,
  };
}
