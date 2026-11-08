import { useCallback, useEffect, useRef, useState } from "react";
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
  /**
   * Scope identity (typically `universe|timeframe`). When it changes after
   * mount the open chart is closed: it belongs to the previous scope and its
   * hit may no longer exist there. Filters/search must NOT be part of this key.
   */
  scopeKey?: string | null;
  /**
   * Resolution identity (typically the last completed scan timestamp). When it
   * changes after mount and a *stored* hit (`hit.id != null`) is open, the hit
   * is re-fetched so a rescan that replaced/deleted the row cannot leave a
   * stale panel. A failed re-fetch closes the fullscreen.
   */
  resolutionKey?: string | null;
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
  scopeKey = null,
  resolutionKey = null,
}: UsePatternFullscreenArgs) {
  const [fullscreen, setFullscreen] = useState<FullscreenChartState | null>(null);
  // Monotonic request token: rapid successive opens must not let a stale
  // fetch overwrite the newer selection.
  const chartRequestRef = useRef(0);
  // Latest committed state, readable from effects without making them re-run
  // on every chart update (scope/resolution watchers below).
  const fullscreenStateRef = useRef<FullscreenChartState | null>(null);
  fullscreenStateRef.current = fullscreen;
  // Previous scope/resolution keys: the first render only seeds these, so the
  // initial mount never closes the chart or re-fetches a hit.
  const prevScopeKeyRef = useRef<string | null>(scopeKey);
  const prevResolutionKeyRef = useRef<string | null>(resolutionKey);

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

  // Shared landing pads for "symbol chart resolved" payloads: promote the
  // newest hit and swap candles/trendlines (or just clear `loading` on
  // error), dropping stale token responses. `extra` carries call-site state
  // that must ride along (the as-of replay cutoff).
  const applySymbolChart = (
    chart: SymbolChartPayload,
    symbol: string,
    tf: string,
    token: number,
    extra?: Partial<FullscreenChartState>,
  ) => {
    if (chartRequestRef.current !== token) return;
    const hits = sortHitsNewest(chart.hits ?? []);
    setFullscreen((prev) =>
      prev && prev.symbol === symbol && prev.timeframe === tf
        ? {
            ...prev,
            ...extra,
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

  const applySymbolChartError = (
    symbol: string,
    tf: string,
    token: number,
    extra?: Partial<FullscreenChartState>,
  ) => {
    if (chartRequestRef.current !== token) return;
    setFullscreen((prev) =>
      prev && prev.symbol === symbol && prev.timeframe === tf
        ? { ...prev, ...extra, loading: false }
        : prev,
    );
  };

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

    const apply = (chart: SymbolChartPayload) => applySymbolChart(chart, symbol, tf, token);

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
      .catch(() => applySymbolChartError(symbol, tf, token));
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
      .then((chart) => applySymbolChart(chart, symbol, tf, token))
      .catch(() => applySymbolChartError(symbol, tf, token));
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
      .then((chart) => applySymbolChart(chart, symbol, tf, token, { asOf, fromDate }))
      .catch(() => applySymbolChartError(symbol, tf, token, { asOf, fromDate }));
  };

  /** Fullscreen single-select: switch the chart to the chosen pattern. */
  const selectFullscreenHit = (hit: PatternHitDTO) => {
    setFullscreen((prev) => (prev ? { ...prev, hit } : prev));
  };

  const closeFullscreen = useCallback(() => {
    chartRequestRef.current += 1;
    setFullscreen(null);
  }, []);

  // Scope / resolution watchers. One effect so a scope change (which closes
  // the chart) supersedes a same-commit resolution change: the old hit must
  // not be re-fetched for a scope it does not belong to.
  useEffect(() => {
    const nextScope = scopeKey ?? null;
    const nextResolution = resolutionKey ?? null;
    const scopeChanged = prevScopeKeyRef.current !== nextScope;
    const resolutionChanged = prevResolutionKeyRef.current !== nextResolution;
    prevScopeKeyRef.current = nextScope;
    prevResolutionKeyRef.current = nextResolution;

    if (scopeChanged) {
      closeFullscreen();
      return;
    }
    if (!resolutionChanged) return;

    const current = fullscreenStateRef.current;
    const openHit = current?.hit;
    // Only stored hits can be re-resolved; a live-detected hit has no id.
    if (!current || !openHit || openHit.id == null) return;

    const hitId = openHit.id;
    const token = chartRequestRef.current + 1;
    chartRequestRef.current = token;
    void fetchPatternHit(hitId)
      .then((fresh) => {
        if (chartRequestRef.current !== token) return;
        // A failed/empty response means the hit was replaced or deleted.
        if (!fresh) {
          closeFullscreen();
          return;
        }
        setFullscreen((prev) => {
          if (!prev || !prev.hit || prev.hit.id !== hitId) return prev;
          const updated: PatternHitDTO = {
            ...prev.hit,
            status: fresh.status,
            quality: fresh.quality,
            confidence: fresh.confidence,
            end_date: fresh.end_date,
            trendlines: fresh.trendlines,
          };
          return {
            ...prev,
            hit: updated,
            hits: prev.hits.map((h) => (h.id === hitId ? updated : h)),
          };
        });
      })
      .catch(() => {
        if (chartRequestRef.current !== token) return;
        // 404 / failure: the stored hit no longer exists — close the chart.
        closeFullscreen();
      });
  }, [scopeKey, resolutionKey, closeFullscreen]);

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
