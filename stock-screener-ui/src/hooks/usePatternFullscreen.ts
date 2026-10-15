import { useRef, useState } from "react";
import type {
  ChartCandle,
  PatternHitDTO,
  PatternOverlay,
  TrendLine,
} from "../types/chartPatterns";
import { fetchSymbolChart } from "../api/chartPatterns";
import {
  newestHit,
  sortHitsNewest,
} from "../components/patterns/FullscreenPatternList";

export interface FullscreenChartState {
  symbol: string;
  hit: PatternHitDTO | null;
  /** All detected patterns for the symbol (newest-first single-select list). */
  hits: PatternHitDTO[];
  /** Fullscreen timeframe (defaults to the opened hit's timeframe). */
  timeframe: string;
  candles: ChartCandle[];
  overlays: PatternOverlay[];
  trendLines: TrendLine[];
  /** True while a fullscreen fetch/reload is in flight. */
  loading: boolean;
  /** As-of replay cutoff (ISO local datetime, null = live). */
  asOf: string | null;
  /** Replay window start (ISO local datetime, null = any). */
  fromDate: string | null;
}

export interface UsePatternFullscreenArgs {
  /** Default timeframe for symbol-only opens. */
  timeframe: string;
  lookbackBars?: number | null;
  computeTrendlines?: boolean;
}

/** Full hit identity — distinguishes two instances on the same symbol/timeframe. */
export function fullscreenHitIdentity(hit: PatternHitDTO): string {
  return `${hit.id ?? `${hit.symbol}|${hit.timeframe}|${hit.pattern_id}|${hit.start_date}`}`;
}

/**
 * Structural identity for de-duplicating a clicked card hit against
 * live-detected hits. Live detection returns the same pattern with
 * ``id: null`` while a stored card hit carries a DB id, so the id-based
 * identity would keep both as separate rows.
 */
export function fullscreenDedupeKey(hit: PatternHitDTO): string {
  return `${hit.symbol}|${hit.timeframe}|${hit.pattern_id}|${hit.start_date}|${hit.end_date}`;
}

/**
 * Fullscreen pattern-chart state machine, shared by the Patterns page and the
 * Daily Report page so a symbol click opens the identical fullscreen chart:
 * detected-pattern list (newest first), single active pattern, timeframe
 * switch with live re-detection, and as-of replay. Only the newest hit is
 * ever drawn — no dashed siblings. Never throws; fetch failures keep the
 * current chart and clear the spinner.
 */
export function usePatternFullscreen({
  timeframe: defaultTimeframe,
  lookbackBars = null,
  computeTrendlines = true,
}: UsePatternFullscreenArgs) {
  const [fullscreen, setFullscreen] = useState<FullscreenChartState | null>(null);
  // Monotonic request token: rapid successive opens must not let a stale
  // fetch overwrite the newer selection.
  const chartRequestRef = useRef(0);

  const mergeHits = (
    clicked: PatternHitDTO,
    fetched: PatternHitDTO[],
  ): PatternHitDTO[] => {
    const byKey = new Map<string, PatternHitDTO>();
    byKey.set(fullscreenDedupeKey(clicked), clicked);
    for (const hit of fetched) byKey.set(fullscreenDedupeKey(hit), hit);
    return [...byKey.values()];
  };

  // Open from a known hit (e.g. a result card): show it immediately, then
  // load every detected pattern for the symbol and promote the newest.
  const openFromCard = (hit: PatternHitDTO) => {
    const token = chartRequestRef.current + 1;
    chartRequestRef.current = token;
    const identity = fullscreenHitIdentity(hit);
    setFullscreen({
      symbol: hit.symbol,
      hit,
      hits: [],
      timeframe: hit.timeframe,
      candles: hit.candles ?? [],
      overlays: [],
      trendLines: hit.trend_lines ?? [],
      loading: false,
      asOf: null,
      fromDate: null,
    });
    // Forward the TLS/TLR opt-out: with computation off the chart endpoint
    // skips the detector and returns empty `trend_lines`.
    void fetchSymbolChart(hit.symbol, hit.timeframe, {
      detectPatterns: true,
      ...(lookbackBars != null ? { lookbackBars } : {}),
      computeTrendlines,
    })
      .then((chart) => {
        // Drop stale responses: only the latest request may update the view.
        if (chartRequestRef.current !== token) return;
        setFullscreen((prev) =>
          prev && prev.hit && fullscreenHitIdentity(prev.hit) === identity
            ? {
                ...prev,
                hits: sortHitsNewest(mergeHits(hit, chart.hits ?? [])),
                hit: newestHit(mergeHits(hit, chart.hits ?? [])),
                candles: chart.candles?.length ? chart.candles : prev.candles,
                overlays: [],
                trendLines: chart.trend_lines ?? prev.trendLines,
              }
            : prev,
        );
      })
      .catch(() => {
        /* non-fatal: keep the card's pattern + candles */
      });
  };

  // Open from a bare symbol (report rows, watch rows): fetch the chart with
  // live detection and promote the newest hit (or null when there is none).
  const openFromSymbol = (symbol: string, timeframe?: string) => {
    const tf = timeframe ?? defaultTimeframe;
    const token = chartRequestRef.current + 1;
    chartRequestRef.current = token;
    setFullscreen({
      symbol,
      hit: null,
      hits: [],
      timeframe: tf,
      candles: [],
      overlays: [],
      trendLines: [],
      loading: true,
      asOf: null,
      fromDate: null,
    });
    void fetchSymbolChart(symbol, tf, {
      detectPatterns: true,
      ...(lookbackBars != null ? { lookbackBars } : {}),
      computeTrendlines,
    })
      .then((chart) => {
        if (chartRequestRef.current !== token) return;
        const hits = sortHitsNewest(chart.hits ?? []);
        setFullscreen((prev) =>
          prev && prev.symbol === symbol && prev.timeframe === tf
            ? {
                ...prev,
                hit: newestHit(hits),
                hits,
                candles: chart.candles ?? [],
                overlays: [],
                trendLines: chart.trend_lines ?? [],
                loading: false,
              }
            : prev,
        );
      })
      .catch(() => {
        if (chartRequestRef.current !== token) return;
        setFullscreen((prev) =>
          prev && prev.symbol === symbol && prev.timeframe === tf
            ? { ...prev, loading: false }
            : prev,
        );
      });
  };

  // Fullscreen timeframe switch: re-runs detection on the new timeframe,
  // swaps candles/trendlines, promotes the newest hit. Preserves as-of.
  const changeFullscreenTimeframe = (tf: string) => {
    const current = fullscreen;
    if (!current || tf === current.timeframe) return;
    const token = chartRequestRef.current + 1;
    chartRequestRef.current = token;
    const { symbol, asOf, fromDate } = current;
    setFullscreen({ ...current, timeframe: tf, loading: true });
    void fetchSymbolChart(symbol, tf, {
      detectPatterns: true,
      ...(asOf ? { asOf } : {}),
      ...(fromDate ? { fromDate } : {}),
    })
      .then((chart) => {
        if (chartRequestRef.current !== token) return;
        const hits = sortHitsNewest(chart.hits ?? []);
        setFullscreen((prev) =>
          prev && prev.symbol === symbol && prev.timeframe === tf
            ? {
                ...prev,
                hit: newestHit(hits),
                hits,
                candles: chart.candles ?? [],
                overlays: [],
                trendLines: chart.trend_lines ?? [],
                loading: false,
              }
            : prev,
        );
      })
      .catch(() => {
        if (chartRequestRef.current !== token) return;
        setFullscreen((prev) =>
          prev && prev.symbol === symbol && prev.timeframe === tf
            ? { ...prev, loading: false }
            : prev,
        );
      });
  };

  // Fullscreen as-of replay: re-runs detection truncated at the cutoff.
  const changeFullscreenAsOf = (asOf: string | null, fromDate: string | null) => {
    const current = fullscreen;
    if (!current) return;
    const token = chartRequestRef.current + 1;
    chartRequestRef.current = token;
    const { symbol, timeframe: tf } = current;
    setFullscreen({ ...current, asOf, fromDate, loading: true });
    void fetchSymbolChart(symbol, tf, {
      detectPatterns: true,
      asOf: asOf ?? undefined,
      fromDate: fromDate ?? undefined,
    })
      .then((chart) => {
        if (chartRequestRef.current !== token) return;
        const hits = sortHitsNewest(chart.hits ?? []);
        setFullscreen((prev) =>
          prev && prev.symbol === symbol && prev.timeframe === tf
            ? {
                ...prev,
                asOf,
                fromDate,
                hit: newestHit(hits),
                hits,
                candles: chart.candles ?? [],
                overlays: [],
                trendLines: chart.trend_lines ?? [],
                loading: false,
              }
            : prev,
        );
      })
      .catch(() => {
        if (chartRequestRef.current !== token) return;
        setFullscreen((prev) =>
          prev && prev.symbol === symbol && prev.timeframe === tf
            ? { ...prev, asOf, fromDate, loading: false }
            : prev,
        );
      });
  };

  /** Fullscreen single-select: switch the chart to the chosen pattern. */
  const selectFullscreenHit = (hit: PatternHitDTO) => {
    setFullscreen((prev) => (prev ? { ...prev, hit } : prev));
  };

  const closeFullscreen = () => {
    chartRequestRef.current += 1;
    setFullscreen(null);
  };

  return {
    fullscreen,
    openFromCard,
    openFromSymbol,
    changeFullscreenTimeframe,
    changeFullscreenAsOf,
    selectFullscreenHit,
    closeFullscreen,
  };
}
