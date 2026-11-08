import { useState, useCallback, useRef, useEffect } from "react";
import { useApi, UseApiState } from "./useApi";
import type { Stock, ScreenerData } from "../types";
import {
  approachingStocksOf,
  buildScreenerApiUrl,
  buildScreenerPreviewUrl,
  type ScreenerFilterDefault,
} from "@/api/screenerQuery";
export interface ScreenerParams {
  provider?: string;
  mode?: string;
  screener: string;
  columns?: string[];
  filters?: Record<string, string | number | boolean | undefined>;
}
export type ScreenerApiState = UseApiState<ScreenerData>;
export function useScreenerApi(params: ScreenerParams): ScreenerApiState {
  const url = buildScreenerApiUrl(params);
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
    return buildScreenerPreviewUrl({
      screener,
      columns: cols,
      filters: filts as unknown as ScreenerFilterDefault[] | undefined,
    });
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
      setStocks(approachingStocksOf(state.data));
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
