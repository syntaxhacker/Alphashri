import { useRef, useState } from "react";
import type {
  ChartCandle,
  PatternHitDTO,
  PatternOverlay,
  TrendLine,
} from "../types/chartPatterns";
import { fetchPatternHit, fetchSymbolChart } from "../api/chartPatterns";
import {
  newestHit,
  sortHitsNewest,
} from "../components/patterns/FullscreenPatternList";

/** Payload returned by the symbol-chart endpoint (candles + detected hits). */
type SymbolChartPayload = Awaited<ReturnType<typeof fetchSymbolChart>>;
const SYMBOL_CHART_CACHE_MS = 60_000;

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
  /**
   * `true` when the user explicitly opened the chart (row/card click, chart
   * icon). `false` for a hover preview, which the host may auto-dismiss.
   */
  pinned: boolean;
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
    const stored = hit.id != null;
    setFullscreen({
      symbol: hit.symbol,
      hit,
      hits: [hit],
      timeframe: hit.timeframe,
      candles: hit.candles ?? [],
      overlays: [],
      trendLines: hit.trend_lines ?? [],
      loading: true,
      asOf: null,
      fromDate: null,
      pinned: true,
    });

    const fullHit = stored ? fetchPatternHit(hit.id as number).catch(() => hit) : Promise.resolve(hit);
    const chartPromise = fetchSymbolChart(hit.symbol, hit.timeframe, {
      detectPatterns: !stored,
      ...(lookbackBars != null ? { lookbackBars } : {}),
      computeTrendlines,
    });

    void Promise.all([fullHit, chartPromise])
      .then(([full, chart]) => {
        if (chartRequestRef.current !== token) return;
        const fetched = chart.hits ?? [];
        const resolved = stored
          ? (full ?? hit)
          : (newestHit(mergeHits(hit, fetched)) ?? hit);
        setFullscreen((prev) =>
          prev && prev.hit && fullscreenHitIdentity(prev.hit) === identity
            ? {
                ...prev,
                hit: resolved,
                hits: [resolved],
                candles: chart.candles?.length ? chart.candles : prev.candles,
                overlays: [],
                trendLines: chart.trend_lines ?? resolved.trend_lines ?? prev.trendLines,
                loading: false,
              }
            : prev,
        );
      })
      .catch(() => {
        if (chartRequestRef.current !== token) return;
        setFullscreen((prev) =>
          prev && prev.hit && fullscreenHitIdentity(prev.hit) === identity
            ? { ...prev, loading: false }
            : prev,
        );
      });
  };

  // Open from a bare symbol (report rows, watch rows): fetch the chart with
  // live detection and promote the newest hit (or null when there is none).
  // Shared by the pinned open (chart icon/row click) and the hover preview so
  // both render the same widget.
  const symbolChartCacheRef = useRef(
    new Map<string, { chart: SymbolChartPayload; ts: number }>(),
  );

  const loadSymbolChart = (
    symbol: string,
    timeframe: string | undefined,
    pinned: boolean,
  ) => {
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
      pinned,
    });

    const apply = (chart: SymbolChartPayload) => {
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
    };

    const key = `${symbol}|${tf}`;
    const cached = symbolChartCacheRef.current.get(key);
    if (cached && Date.now() - cached.ts < SYMBOL_CHART_CACHE_MS) {
      apply(cached.chart);
      return;
    }

    void fetchSymbolChart(symbol, tf, {
      detectPatterns: true,
      ...(lookbackBars != null ? { lookbackBars } : {}),
      computeTrendlines,
    })
      .then((chart) => {
        symbolChartCacheRef.current.set(key, { chart, ts: Date.now() });
        apply(chart);
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

  const openFromSymbol = (symbol: string, timeframe?: string) =>
    loadSymbolChart(symbol, timeframe, true);

  /** Hover preview: same widget, but dismissible (pinned = false). */
  const previewFromSymbol = (symbol: string, timeframe?: string) =>
    loadSymbolChart(symbol, timeframe, false);

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

  /** Promote a hover preview to a pinned chart (user interacted with it). */
  const pinFullscreen = () => {
    setFullscreen((prev) => (prev && !prev.pinned ? { ...prev, pinned: true } : prev));
  };

  return {
    fullscreen,
    openFromCard,
    openFromSymbol,
    previewFromSymbol,
    pinFullscreen,
    changeFullscreenTimeframe,
    changeFullscreenAsOf,
    selectFullscreenHit,
    closeFullscreen,
  };
}
