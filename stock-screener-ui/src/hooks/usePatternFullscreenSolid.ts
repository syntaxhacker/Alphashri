/**
 * Solid port of src/hooks/usePatternFullscreen (which is still React and
 * cannot mount under SolidJS). Identical state machine and behavior, with
 * accessor-based API: `fullscreen()` instead of a destructured value.
 *
 * The hooks owner should fold this back into src/hooks/usePatternFullscreen.ts
 * once their scope converts; until then this is the report page's local twin.
 */
import { createEffect, createSignal } from "solid-js";
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

export type SymbolChartPayload = Awaited<ReturnType<typeof fetchSymbolChart>>;
const SYMBOL_CHART_CACHE_MS = 60_000;

const staleFields = (
  chart: SymbolChartPayload,
): Pick<FullscreenChartState, "stale" | "dataAsOf"> =>
  chart.stale === true
    ? { stale: true, dataAsOf: chart.as_of ?? null }
    : { stale: false, dataAsOf: null };

export interface FullscreenChartState {
  symbol: string;
  hit: PatternHitDTO | null;
  hits: PatternHitDTO[];
  timeframe: string;
  candles: ChartCandle[];
  overlays: PatternOverlay[];
  trendLines: TrendLine[];
  loading: boolean;
  patternsLoading?: boolean;
  detectPatterns?: boolean;
  asOf: string | null;
  fromDate: string | null;
  stale?: boolean;
  dataAsOf?: string | null;
  pinned: boolean;
}

export interface UsePatternFullscreenArgs {
  timeframe: string;
  lookbackBars?: number | null;
  computeTrendlines?: boolean;
  scopeKey?: string | null;
  resolutionKey?: string | null;
}

export function fullscreenHitIdentity(hit: PatternHitDTO): string {
  return `${hit.id ?? `${hit.symbol}|${hit.timeframe}|${hit.pattern_id}|${hit.start_date}`}`;
}

export function fullscreenDedupeKey(hit: PatternHitDTO): string {
  return `${hit.symbol}|${hit.timeframe}|${hit.pattern_id}|${hit.start_date}|${hit.end_date}`;
}

export function usePatternFullscreen({
  timeframe: defaultTimeframe,
  lookbackBars = null,
  computeTrendlines = true,
  scopeKey = null,
  resolutionKey = null,
}: UsePatternFullscreenArgs) {
  const [fullscreen, setFullscreen] = createSignal<FullscreenChartState | null>(null);
  // Monotonic request token: rapid successive opens must not let a stale
  // fetch overwrite the newer selection.
  let chartRequestToken = 0;
  // Scope/resolution watchers seed on first run so mount never closes the
  // chart or re-fetches a hit.
  let prevScopeKey: string | null = scopeKey;
  let prevResolutionKey: string | null = resolutionKey;

  const mergeHits = (
    clicked: PatternHitDTO,
    fetched: PatternHitDTO[],
  ): PatternHitDTO[] => {
    const byKey = new Map<string, PatternHitDTO>();
    byKey.set(fullscreenDedupeKey(clicked), clicked);
    for (const hit of fetched) byKey.set(fullscreenDedupeKey(hit), hit);
    return [...byKey.values()];
  };

  const openFromCard = (hit: PatternHitDTO) => {
    const token = ++chartRequestToken;
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

    const fullHit = stored ? fetchPatternHit(hit.id as number).catch(() => hit) : Promise.resolve(hit);
    const chartPromise = fetchSymbolChart(hit.symbol, hit.timeframe, {
      detectPatterns: !stored,
      ...(lookbackBars != null ? { lookbackBars } : {}),
      computeTrendlines,
    });

    void Promise.all([fullHit, chartPromise])
      .then(([full, chart]) => {
        if (chartRequestToken !== token) return;
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
        if (chartRequestToken !== token) return;
        setFullscreen((prev) =>
          prev && prev.hit && fullscreenHitIdentity(prev.hit) === identity
            ? { ...prev, loading: false }
            : prev,
        );
      });
  };

  const symbolChartCache = new Map<string, { chart: SymbolChartPayload; ts: number }>();

  const applySymbolChart = (
    chart: SymbolChartPayload,
    symbol: string,
    tf: string,
    token: number,
    extra?: Partial<FullscreenChartState>,
  ) => {
    if (chartRequestToken !== token) return;
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
    if (chartRequestToken !== token) return;
    setFullscreen((prev) =>
      prev && prev.symbol === symbol && prev.timeframe === tf
        ? { ...prev, ...extra, loading: false }
        : prev,
    );
  };

  const runTwoPhase = (
    symbol: string,
    tf: string,
    token: number,
    detectPatterns: boolean,
    extra: {
      lookbackBars?: number | null;
      computeTrendlines?: boolean;
      asOf?: string | null;
      fromDate?: string | null;
    },
  ) => {
    const baseOpts: Record<string, unknown> = {
      ...(extra.lookbackBars != null ? { lookbackBars: extra.lookbackBars } : {}),
      ...(extra.asOf ? { asOf: extra.asOf } : {}),
      ...(extra.fromDate ? { fromDate: extra.fromDate } : {}),
    };
    if (extra.computeTrendlines != null) {
      baseOpts.computeTrendlines = extra.computeTrendlines;
    }

    const applyCandles = (chart: SymbolChartPayload) => {
      if (chartRequestToken !== token) return;
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

    const applyCandlesError = () => {
      if (chartRequestToken !== token) return;
      setFullscreen((prev) =>
        prev && prev.symbol === symbol && prev.timeframe === tf
          ? { ...prev, loading: false }
          : prev,
      );
    };

    const applyPatterns = (chart: SymbolChartPayload) => {
      if (chartRequestToken !== token) return;
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

    const applyPatternsError = () => {
      if (chartRequestToken !== token) return;
      setFullscreen((prev) =>
        prev && prev.symbol === symbol && prev.timeframe === tf
          ? { ...prev, patternsLoading: false }
          : prev,
      );
    };

    const phase2 = async () => {
      if (chartRequestToken !== token) return;
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
        if (chartRequestToken !== token) return;
        symbolChartCache.set(key, { chart, ts: Date.now() });
        applyPatterns(chart);
      } catch {
        applyPatternsError();
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
        if (chartRequestToken !== token) return;
        symbolChartCache.set(key, { chart, ts: Date.now() });
        applyCandles(chart);
        if (detectPatterns) await phase2();
      } catch {
        applyCandlesError();
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
    const tf = timeframe ?? defaultTimeframe;
    const token = ++chartRequestToken;
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

    void runTwoPhase(symbol, tf, token, detectPatterns, {
      lookbackBars,
      computeTrendlines,
    });
  };

  const openFromSymbol = (
    symbol: string,
    timeframe?: string,
    detectPatterns = true,
  ) => loadSymbolChart(symbol, timeframe, true, detectPatterns);

  const previewFromSymbol = (
    symbol: string,
    timeframe?: string,
    detectPatterns = true,
  ) => loadSymbolChart(symbol, timeframe, false, detectPatterns);

  const changeFullscreenTimeframe = (tf: string) => {
    const current = fullscreen();
    if (!current || tf === current.timeframe) return;
    const token = ++chartRequestToken;
    const { symbol, asOf, fromDate } = current;
    setFullscreen({ ...current, timeframe: tf, loading: true, patternsLoading: undefined });
    void runTwoPhase(symbol, tf, token, current.detectPatterns !== false, {
      asOf,
      fromDate,
      computeTrendlines: undefined,
    });
  };

  const changeFullscreenAsOf = (asOf: string | null, fromDate: string | null) => {
    const current = fullscreen();
    if (!current) return;
    const token = ++chartRequestToken;
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

  const selectFullscreenHit = (hit: PatternHitDTO) => {
    setFullscreen((prev) => (prev ? { ...prev, hit } : prev));
  };

  const closeFullscreen = () => {
    chartRequestToken += 1;
    setFullscreen(null);
  };

  // Scope / resolution watchers. A scope change (which closes the chart)
  // supersedes a same-commit resolution change.
  createEffect(() => {
    const nextScope = scopeKey ?? null;
    const nextResolution = resolutionKey ?? null;
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
    if (!current || !openHit || openHit.id == null) return;

    const hitId = openHit.id;
    const token = ++chartRequestToken;
    void fetchPatternHit(hitId)
      .then((fresh) => {
        if (chartRequestToken !== token) return;
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
        if (chartRequestToken !== token) return;
        closeFullscreen();
      });
  });

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
