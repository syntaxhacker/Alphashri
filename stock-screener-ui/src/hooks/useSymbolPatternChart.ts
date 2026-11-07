import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSymbolChart } from "@/api/chartPatterns";
import {
  newestHit,
  sortHitsNewest,
} from "@/components/patterns/FullscreenPatternList";
import type {
  ChartCandle,
  PatternHitDTO,
  TrendLine,
} from "@/types/chartPatterns";

export interface SymbolPatternChartState {
  symbol: string;
  /** Newest detected pattern (null when the timeframe has no patterns). */
  hit: PatternHitDTO | null;
  /** Every detected pattern for the symbol/timeframe, newest first. */
  hits: PatternHitDTO[];
  candles: ChartCandle[];
  /** Standalone support/resistance lines from the symbol-chart payload. */
  trendLines: TrendLine[];
  loading: boolean;
  /** Fetch/transport error (distinct from "no candles / no patterns"). */
  error: string | null;
}

export interface UseSymbolPatternChartArgs {
  symbol: string;
  timeframe: string;
  /** Replay cutoff (ISO local datetime); null/undefined = live. */
  asOf?: string | null;
  /** Replay window start (ISO local datetime); null/undefined = any. */
  fromDate?: string | null;
  /** Optionally cap the trailing window (same semantics as the scan param). */
  lookbackBars?: number | null;
  /** Skip server-side standalone trendlines when false (default: compute). */
  computeTrendlines?: boolean;
}

const EMPTY_LISTS = {
  hit: null,
  hits: [] as PatternHitDTO[],
  candles: [] as ChartCandle[],
  trendLines: [] as TrendLine[],
};

/**
 * Declarative symbol-chart loader for the `/chart/:symbol` page.
 *
 * The Patterns page and the Daily Report open the same screen imperatively via
 * `usePatternFullscreen` (a card/symbol click starts the fetch). A route has no
 * click — the symbol comes from the URL — so this hook runs the identical
 * `fetchSymbolChart(..., { detectPatterns: true })` call in an effect and
 * exposes the same state shape (newest hit first, single active pattern).
 *
 * Never throws: a transport error lands in `error` and the previous candles are
 * kept; a response with no candles/no hits is a normal empty state. A monotonic
 * request token discards stale responses when the symbol/timeframe changes
 * while a fetch is in flight.
 */
export function useSymbolPatternChart({
  symbol,
  timeframe,
  asOf = null,
  fromDate = null,
  lookbackBars = null,
  computeTrendlines = true,
}: UseSymbolPatternChartArgs): SymbolPatternChartState & {
  selectHit: (hit: PatternHitDTO) => void;
  reload: () => void;
} {
  const [state, setState] = useState<SymbolPatternChartState>({
    symbol,
    ...EMPTY_LISTS,
    loading: Boolean(symbol),
    error: null,
  });
  const requestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(() => {
    if (!symbol) {
      setState({ symbol, ...EMPTY_LISTS, loading: false, error: null });
      return;
    }
    const token = requestRef.current + 1;
    requestRef.current = token;
    // A different symbol must not keep showing the previous chart while the
    // new one loads; a timeframe/as-of change keeps the candles (less flicker).
    setState((prev) =>
      prev.symbol === symbol
        ? { ...prev, loading: true, error: null }
        : { symbol, ...EMPTY_LISTS, loading: true, error: null },
    );

    const options = {
      detectPatterns: true,
      computeTrendlines,
      ...(asOf ? { asOf } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(lookbackBars != null ? { lookbackBars } : {}),
    };

    void fetchSymbolChart(symbol, timeframe, options)
      .then((chart) => {
        if (!mountedRef.current || requestRef.current !== token) return;
        const hits = sortHitsNewest(chart.hits ?? []);
        setState({
          symbol,
          hit: newestHit(hits),
          hits,
          candles: chart.candles ?? [],
          trendLines: chart.trend_lines ?? [],
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (!mountedRef.current || requestRef.current !== token) return;
        setState((prev) =>
          prev.symbol === symbol
            ? {
                ...prev,
                loading: false,
                error: err instanceof Error ? err.message : "Failed to load chart",
              }
            : prev,
        );
      });
  }, [symbol, timeframe, asOf, fromDate, lookbackBars, computeTrendlines]);

  useEffect(() => {
    load();
  }, [load]);

  const selectHit = useCallback((hit: PatternHitDTO) => {
    setState((prev) => (prev.symbol === hit.symbol ? { ...prev, hit } : prev));
  }, []);

  return { ...state, selectHit, reload: load };
}
