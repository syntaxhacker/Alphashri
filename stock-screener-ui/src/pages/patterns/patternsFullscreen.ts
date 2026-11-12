/**
 * patternsFullscreen.ts — Solid port of src/hooks/usePatternFullscreen.ts.
 *
 * Same state machine as the React hook: the fullscreen chart shared by the
 * Patterns page and (eventually) the report pages, with a monotonic request
 * token so a stale fetch can never overwrite a newer selection.
 */

import { createSignal, createEffect, onCleanup } from "solid-js";
import type {
  ChartCandle,
  PatternHitDTO,
  PatternOverlay,
  TrendLine,
} from "@/types/chartPatterns";
import { fetchPatternHit, fetchSymbolChart } from "@/api/chartPatterns";
import {
  newestHit,
  sortHitsNewest,
} from "@/components/patterns/FullscreenPatternList";

/** Payload returned by the symbol-chart endpoint (candles + detected hits). */
type SymbolChartPayload = Awaited<ReturnType<typeof fetchSymbolChart>>;
const SYMBOL_CHART_CACHE_MS = 60_000;

/** Stale markers from a chart payload — only an explicit `stale:true` marks the frame. */
const staleFields = (
  chart: SymbolChartPayload,
): Pick<FullscreenChartState, "stale" | "dataAsOf"> =>
  chart.stale === true
    ? { stale: true, dataAsOf: chart.as_of ?? null }
    : { stale: false, dataAsOf: null };

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
  /** True while a fullscreen fetch/reload is in flight (phase 1: candles). */
  loading: boolean;
  /** True while phase-2 pattern detection is in flight (candles already rendered). */
  patternsLoading?: boolean;
  /** False = candles-only (market/global dock); skips pattern detection. */
  detectPatterns?: boolean;
  /** As-of replay cutoff (ISO local datetime, null = live). */
  asOf: string | null;
  /** Replay window start (ISO local datetime, null = any). */
  fromDate: string | null;
  /** True while the rendered candles come from the stale disk cache. */
  stale?: boolean;
  /** The stale frame's last session date (`YYYY-MM-DD`); null when fresh. */
  dataAsOf?: string | null;
  /** `true` when the user explicitly opened the chart; `false` for a hover preview. */
  pinned: boolean;
}

export interface UsePatternFullscreenArgs {
  /** Default timeframe for symbol-only opens. */
  timeframe: string;
  lookbackBars?: number | null;
  computeTrendlines?: boolean;
  /**
   * Scope identity (typically `universe|timeframe`). When it changes after
   * mount the open chart is closed: it belongs to the previous scope.
   */
  scopeKey?: string | null;
  /**
   * Resolution identity (typically the last completed scan timestamp). When it
   * changes after mount and a *stored* hit is open, the hit is re-fetched so a
   * rescan that replaced/deleted the row cannot leave a stale panel.
   */
  resolutionKey?: string | null;
}

/** Full hit identity — distinguishes two instances on the same symbol/timeframe. */
export function fullscreenHitIdentity(hit: PatternHitDTO): string {
  return `${hit.id ?? `${hit.symbol}|${hit.timeframe}|${hit.pattern_id}|${hit.start_date}`}`;
}

/** Structural identity for de-duplicating a clicked card hit against live-detected hits. */
export function fullscreenDedupeKey(hit: PatternHitDTO): string {
  return `${hit.symbol}|${hit.timeframe}|${hit.pattern_id}|${hit.start_date}|${hit.end_date}`;
}

/**
 * Fullscreen pattern-chart state machine, shared by the Patterns page and
 * (eventually) the report pages so a symbol click opens the identical
 * fullscreen chart. Never throws; fetch failures keep the current chart and
 * clear the spinner.
 */
export function usePatternFullscreen(args: UsePatternFullscreenArgs) {
  const [fullscreen, setFullscreen] = createSignal<FullscreenChartState | null>(null);
  // Monotonic request token: rapid successive opens must not let a stale
  // fetch overwrite the newer selection.
  let chartRequest = 0;
  // Previous scope/resolution keys: the first render only seeds these.
  let prevScopeKey: string | null = args.scopeKey ?? null;
  let prevResolutionKey: string | null = args.resolutionKey ?? null;
  // Symbol-chart response cache (`symbol|tf|l` = candles, `symbol|tf|p` = patterns).
  const symbolChartCache = new Map<string, { chart: SymbolChartPayload; ts: number }>();

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
    const token = chartRequest + 1;
    chartRequest = token;
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
      stale: false,
      dataAsOf: null,
    });

    const fullHit = stored
      ? fetchPatternHit(hit.id as number).catch(() => hit)
      : Promise.resolve(hit);
    const chartPromise = fetchSymbolChart(hit.symbol, hit.timeframe, {
      detectPatterns: !stored,
      ...(args.lookbackBars != null ? { lookbackBars: args.lookbackBars } : {}),
      computeTrendlines: args.computeTrendlines,
    });

    void Promise.all([fullHit, chartPromise])
      .then(([full, chart]) => {
        if (chartRequest !== token) return;
        const fetched = chart.hits ?? [];
        const resolved = stored
          ? (full ?? hit)
          : (newestHit(mergeHits(hit, fetched)) ?? hit);
        setFullscreen((prev) =>
          prev && prev.hit && fullscreenHitIdentity(prev.hit) === identity
            ? {
                ...prev,
                ...staleFields(chart),
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
        if (chartRequest !== token) return;
        setFullscreen((prev) =>
          prev && prev.hit && fullscreenHitIdentity(prev.hit) === identity
            ? { ...prev, loading: false }
            : prev,
        );
      });
  };

  // Shared landing pads for "symbol chart resolved" payloads.
  const applySymbolChart = (
    chart: SymbolChartPayload,
    symbol: string,
    tf: string,
    token: number,
    extra?: Partial<FullscreenChartState>,
  ) => {
    if (chartRequest !== token) return;
    const hits = sortHitsNewest(chart.hits ?? []);
    setFullscreen((prev) =>
      prev && prev.symbol === symbol && prev.timeframe === tf
        ? {
            ...prev,
            ...extra,
            ...staleFields(chart),
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
    if (chartRequest !== token) return;
    setFullscreen((prev) =>
      prev && prev.symbol === symbol && prev.timeframe === tf
        ? { ...prev, ...extra, loading: false }
        : prev,
    );
  };

  // Two-phase symbol chart load: phase 1 fetches candles only and renders
  // them immediately; phase 2 runs detection asynchronously so the chart is
  // never blocked by pattern computation. Each phase is gated by the shared
  // request token so a symbol/timeframe switch cancels stale responses.
  const runTwoPhase = (
    symbol: string,
    tf: string,
    token: number,
    detectPatterns: boolean,
    startedAt: number,
    extra: {
      lookbackBars?: number | null;
      computeTrendlines?: boolean;
      asOf?: string;
      fromDate?: string;
    },
  ) => {
    const baseOpts: Record<string, unknown> = {
      ...(extra.lookbackBars != null ? { lookbackBars: extra.lookbackBars } : {}),
      ...(extra.asOf ? { asOf: extra.asOf } : {}),
      ...(extra.fromDate ? { fromDate: extra.fromDate } : {}),
    };
    // `computeTrendlines` is only forwarded when explicitly provided — the
    // timeframe switch deliberately omits it (server default).
    if (extra.computeTrendlines != null) {
      baseOpts.computeTrendlines = extra.computeTrendlines;
    }

    const applyCandles = (chart: SymbolChartPayload) => {
      if (chartRequest !== token) return;
      setFullscreen((prev) =>
        prev && prev.symbol === symbol && prev.timeframe === tf
          ? {
              ...prev,
              ...staleFields(chart),
              candles: chart.candles ?? [],
              overlays: [],
              trendLines: chart.trend_lines ?? [],
              loading: false,
            }
          : prev,
      );
    };

    const applyCandlesError = (err: unknown) => {
      if (chartRequest !== token) return;
      console.warn("[chart-dock] failed", { symbol, timeframe: tf, ms: Math.round(performance.now() - startedAt) });
      setFullscreen((prev) =>
        prev && prev.symbol === symbol && prev.timeframe === tf
          ? { ...prev, loading: false }
          : prev,
      );
    };

    const applyPatterns = (chart: SymbolChartPayload) => {
      if (chartRequest !== token) return;
      const hits = sortHitsNewest(chart.hits ?? []);
      setFullscreen((prev) =>
        prev && prev.symbol === symbol && prev.timeframe === tf
          ? {
              ...prev,
              ...staleFields(chart),
              hit: newestHit(hits),
              hits,
              trendLines: chart.trend_lines ?? [],
              patternsLoading: false,
            }
          : prev,
      );
    };

    const applyPatternsError = (_err: unknown) => {
      if (chartRequest !== token) return;
      setFullscreen((prev) =>
        prev && prev.symbol === symbol && prev.timeframe === tf
          ? { ...prev, patternsLoading: false }
          : prev,
      );
    };

    const phase2 = async () => {
      if (chartRequest !== token) return;
      setFullscreen((prev) =>
        prev && prev.symbol === symbol && prev.timeframe === tf
          ? { ...prev, patternsLoading: true }
          : prev,
      );
      const key = `${symbol}|${tf}|p`;
      const cached = symbolChartCache.get(key);
      if (cached && Date.now() - cached.ts < SYMBOL_CHART_CACHE_MS) {
        applyPatterns(cached.chart);
        return;
      }
      try {
        const chart = await fetchSymbolChart(symbol, tf, { detectPatterns: true, ...baseOpts });
        if (chartRequest !== token) return;
        symbolChartCache.set(key, { chart, ts: Date.now() });
        applyPatterns(chart);
      } catch (err) {
        applyPatternsError(err);
      }
    };

    const phase1 = async () => {
      const key = `${symbol}|${tf}|l`;
      const cached = symbolChartCache.get(key);
      if (cached && Date.now() - cached.ts < SYMBOL_CHART_CACHE_MS) {
        applyCandles(cached.chart);
        if (detectPatterns) await phase2();
        return;
      }
      try {
        const chart = await fetchSymbolChart(symbol, tf, {
          detectPatterns: false,
          ...baseOpts,
        });
        if (chartRequest !== token) return;
        symbolChartCache.set(key, { chart, ts: Date.now() });
        applyCandles(chart);
        if (detectPatterns) await phase2();
      } catch (err) {
        applyCandlesError(err);
      }
    };

    void phase1();
  };

  const loadSymbolChart = (
    symbol: string,
    timeframe: string | undefined,
    pinned: boolean,
    detectPatterns = true,
  ) => {
    const tf = timeframe ?? args.timeframe;
    const token = chartRequest + 1;
    chartRequest = token;
    const startedAt = performance.now();
    setFullscreen({
      symbol,
      hit: null,
      hits: [],
      timeframe: tf,
      candles: [],
      overlays: [],
      trendLines: [],
      loading: true,
      detectPatterns,
      asOf: null,
      fromDate: null,
      pinned,
      patternsLoading: undefined,
      stale: false,
      dataAsOf: null,
    });

    void runTwoPhase(symbol, tf, token, detectPatterns, startedAt, {
      lookbackBars: args.lookbackBars,
      computeTrendlines: args.computeTrendlines,
    });
  };

  const openFromSymbol = (symbol: string, timeframe?: string, detectPatterns = true) =>
    loadSymbolChart(symbol, timeframe, true, detectPatterns);

  /** Hover preview: same widget, but dismissible (pinned = false). */
  const previewFromSymbol = (symbol: string, timeframe?: string, detectPatterns = true) =>
    loadSymbolChart(symbol, timeframe, false, detectPatterns);

  // Fullscreen timeframe switch: candles first (phase 1), then patterns only
  // when the current chart has detection enabled (phase 2). Preserves as-of.
  const changeFullscreenTimeframe = (tf: string) => {
    const current = fullscreen();
    if (!current || tf === current.timeframe) return;
    const token = chartRequest + 1;
    chartRequest = token;
    const { symbol, asOf, fromDate } = current;
    const startedAt = performance.now();
    setFullscreen({ ...current, timeframe: tf, loading: true, patternsLoading: undefined });
    void runTwoPhase(symbol, tf, token, current.detectPatterns !== false, startedAt, {
      asOf: asOf ?? undefined,
      fromDate: fromDate ?? undefined,
      // Deliberately omitted: the pre-two-phase timeframe switch did not send
      // compute_trendlines (server default).
      computeTrendlines: undefined,
    });
  };

  // Fullscreen as-of replay: re-runs detection truncated at the cutoff.
  const changeFullscreenAsOf = (asOf: string | null, fromDate: string | null) => {
    const current = fullscreen();
    if (!current) return;
    const token = chartRequest + 1;
    chartRequest = token;
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

  const closeFullscreen = () => {
    chartRequest += 1;
    setFullscreen(null);
  };

  // Scope / resolution watchers. One effect so a scope change (which closes
  // the chart) supersedes a same-commit resolution change.
  createEffect(() => {
    const nextScope = args.scopeKey ?? null;
    const nextResolution = args.resolutionKey ?? null;
    const scopeChanged = prevScopeKey !== nextScope;
    const resolutionChanged = prevResolutionKey !== nextResolution;
    prevScopeKey = nextScope;
    prevResolutionKey = nextResolution;

    if (scopeChanged) {
      closeFullscreen();
      return;
    }
    if (!resolutionChanged) return;

    const current = fullscreen();
    const openHit = current?.hit;
    // Only stored hits can be re-resolved; a live-detected hit has no id.
    if (!current || !openHit || openHit.id == null) return;

    const hitId = openHit.id;
    const token = chartRequest + 1;
    chartRequest = token;
    void fetchPatternHit(hitId)
      .then((fresh) => {
        if (chartRequest !== token) return;
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
        if (chartRequest !== token) return;
        // 404 / failure: the stored hit no longer exists — close the chart.
        closeFullscreen();
      });
  });

  /** Promote a hover preview to a pinned chart (user interacted with it). */
  const pinFullscreen = () => {
    setFullscreen((prev) => (prev && !prev.pinned ? { ...prev, pinned: true } : prev));
  };

  onCleanup(() => {
    chartRequest += 1;
  });

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
