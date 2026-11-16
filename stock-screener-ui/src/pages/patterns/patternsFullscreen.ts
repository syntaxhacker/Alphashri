/**
 * patternsFullscreen.ts — Solid port of src/hooks/usePatternFullscreen.ts.
 *
 * Same state machine as the React hook: the fullscreen chart shared by the
 * Patterns page and (eventually) the report pages, with a monotonic request
 * token so a stale fetch can never overwrite a newer selection.
 */

import { createSignal, createEffect, onCleanup } from "solid-js";
import { TZ_IST } from "@/config/constants";
import type {
  ChartCandle,
  PatternHitDTO,
  PatternOverlay,
  TrendLine,
} from "@/types/chartPatterns";
import { fetchPatternHit, fetchSymbolChart } from "@/api/chartPatterns";
import { fetchQuotes } from "@/api/marketScreener";
import {
  newestHit,
  sortHitsNewest,
} from "@/components/patterns/FullscreenPatternList";

/** Payload returned by the symbol-chart endpoint (candles + detected hits). */
type SymbolChartPayload = Awaited<ReturnType<typeof fetchSymbolChart>>;
const SYMBOL_CHART_CACHE_MS = 60_000;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const istDayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ_IST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * IST session date (`YYYY-MM-DD`) of an ISO timestamp, or null.
 * Daily bars arrive as `18:30Z` (= 00:00 IST of the session), so the raw
 * string's first 10 chars are the *previous* day — always convert to IST.
 * Date-only inputs are already session dates and pass through.
 */
function istSessionDate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (DATE_ONLY_RE.test(trimmed)) return trimmed;
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  const parts = istDayFmt.formatToParts(new Date(ms));
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/**
 * Stale markers from a chart payload. A stale-first response can still append
 * today's tape bar to the *displayed* candles while `as_of` stays pinned to the
 * detection frame — so a displayed series newer than `as_of` is current and
 * must not carry a "Cached <old date>" badge over a newer candle.
 */
const staleFields = (
  chart: SymbolChartPayload,
): Pick<FullscreenChartState, "stale" | "dataAsOf"> => {
  const candles = chart.candles ?? [];
  const candleDate = istSessionDate(candles.length ? candles[candles.length - 1].t : null);
  const asOfDate = istSessionDate(chart.as_of);
  if (candleDate && asOfDate && candleDate > asOfDate) {
    return { stale: false, dataAsOf: null };
  }
  return chart.stale === true
    ? { stale: true, dataAsOf: chart.as_of ?? null }
    : { stale: false, dataAsOf: null };
};

/**
 * The endpoint answers 200 with `error`/`note` when it has no candles. This
 * module is the Patterns page's state machine; the dock has its own copy
 * (`hooks/usePatternFullscreenSolid.ts`). Every writer of `candles` must also
 * write these, or the page shows a blank chart with no reason.
 */
const chartProblem = (
  chart: SymbolChartPayload,
): Pick<FullscreenChartState, "chartError" | "chartNote"> => ({
  chartError: chart.error ?? null,
  chartNote: chart.note ?? null,
});

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
  /** Chart endpoint failure code (`no_data`, `fetch_timeout`, …). */
  chartError?: string | null;
  /** Human-readable reason shown when the chart has no candles. */
  chartNote?: string | null;
  /** Latest traded price from the market snapshot; null until it resolves (or on failure). */
  livePrice?: number | null;
  /** Day change % paired with `livePrice`; null when unavailable. */
  liveChange?: number | null;
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
   * Pass a function to keep it reactive — it is read inside a createEffect.
   */
  scopeKey?: string | null | (() => string | null);
  /**
   * Resolution identity (typically the last completed scan timestamp). When it
   * changes after mount and a *stored* hit is open, the hit is re-fetched so a
   * rescan that replaced/deleted the row cannot leave a stale panel.
   * Pass a function to keep it reactive — it is read inside a createEffect.
   */
  resolutionKey?: string | null | (() => string | null);
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
  const readScopeKey = () => (typeof args.scopeKey === "function" ? args.scopeKey() : args.scopeKey ?? null);
  const readResolutionKey = () =>
    typeof args.resolutionKey === "function" ? args.resolutionKey() : args.resolutionKey ?? null;
  let prevScopeKey: string | null = readScopeKey();
  let prevResolutionKey: string | null = readResolutionKey();
  // The hit the user explicitly picked from the list. Reloads (refresh,
  // timeframe, as-of) keep this pick while its identity survives the new
  // payload; a card open or a fresh symbol open clears it so newest wins.
  let selectedHit: PatternHitDTO | null = null;

  const resolveHit = (hits: PatternHitDTO[]): PatternHitDTO | null => {
    const picked = selectedHit;
    if (picked && hits.some((h) => fullscreenHitIdentity(h) === fullscreenHitIdentity(picked))) {
      return picked;
    }
    return newestHit(hits);
  };

  // Symbol-chart response cache (`symbol|tf|l` = candles, `symbol|tf|p` = patterns).
  const symbolChartCache = new Map<string, { chart: SymbolChartPayload; ts: number }>();

  // Poll the live quote every 15s while the fullscreen panel is open. One
  // interval at most per hook instance, superseded on load/timeframe/as-of
  // changes, close, and cleanup via an AbortController + monotonic token.
  const POLL_INTERVAL_MS = 15_000;
  let liveTimer: ReturnType<typeof setInterval> | null = null;
  let liveController: AbortController | null = null;

  const stopLivePoll = () => {
    if (liveTimer !== null) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
    liveController?.abort();
    liveController = null;
  };

  const startLivePoll = (symbol: string, token: number) => {
    stopLivePoll();
    liveController = new AbortController();
    const signal = liveController.signal;
    liveTimer = setInterval(() => {
      fetchLiveQuote(symbol, token, signal);
    }, POLL_INTERVAL_MS);
    fetchLiveQuote(symbol, token, signal);
  };

  /** Drop both cached phases (and every replay window) for one symbol+timeframe. */
  const invalidateSymbolChartCache = (symbol: string, tf: string) => {
    const prefix = `${symbol}|${tf}|`;
    for (const key of symbolChartCache.keys()) {
      if (key.startsWith(`${prefix}l|`) || key.startsWith(`${prefix}p|`)) {
        symbolChartCache.delete(key);
      }
    }
  };

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
    selectedHit = null;
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
      livePrice: null,
      liveChange: null,
    });

    const fullHitStored = hit.id != null ? hit.id : null;
    const fullHit = stored && fullHitStored != null
      ? Promise.resolve(fetchPatternHit(fullHitStored)).catch(() => hit)
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
                ...chartProblem(chart),
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
    startLivePoll(hit.symbol, token);
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
            ...chartProblem(chart),
            hit: resolveHit(hits),
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
      refresh?: boolean;
    },
    // Only a refresh/load keeps the visible hit; timeframe switches still
    // default to newest (or the explicit list pick) for the new timeframe.
    preserveCurrentHit = false,
  ) => {
    const baseOpts: Record<string, unknown> = {
      ...(extra.lookbackBars != null ? { lookbackBars: extra.lookbackBars } : {}),
      ...(extra.asOf ? { asOf: extra.asOf } : {}),
      ...(extra.fromDate ? { fromDate: extra.fromDate } : {}),
      ...(extra.refresh ? { refresh: true } : {}),
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
              ...chartProblem(chart),
              candles: chart.candles ?? [],
              overlays: [],
              trendLines: chart.trend_lines ?? [],
              loading: false,
            }
          : prev,
      );
    };

    const applyCandlesError = (_err: unknown) => {
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
      setFullscreen((prev) => {
        if (!prev || prev.symbol !== symbol || prev.timeframe !== tf) return prev;
        const current = prev.hit;
        // Preserve the selection identity, but take the object from the new
        // hits array — the old object carries a stale `close_bar_date` (null),
        // which would make the panel fall back to the chart close instead of
        // the refreshed hit's own dated pair.
        const matches = current
          ? hits.find((h) => fullscreenHitIdentity(h) === fullscreenHitIdentity(current))
          : undefined;
        return {
          ...prev,
          ...staleFields(chart),
          ...chartProblem(chart),
          hit: preserveCurrentHit
            ? matches ?? newestHit(hits)
            : resolveHit(hits),
          hits,
          trendLines: chart.trend_lines ?? [],
          patternsLoading: false,
        };
      });
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
      const key = `${symbol}|${tf}|p|${extra.asOf ?? ""}|${extra.fromDate ?? ""}`;
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
      const key = `${symbol}|${tf}|l|${extra.asOf ?? ""}|${extra.fromDate ?? ""}`;
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

  /** Best-effort live quote; a failure leaves the LTP fields null, never blocks the chart. */
  const fetchLiveQuote = (symbol: string, token: number, signal?: AbortSignal) => {
    void Promise.resolve()
      .then(() => fetchQuotes([symbol], { signal }))
      .then((quotes) => {
        if (chartRequest !== token) return;
        const upper = symbol.toUpperCase();
        const quote = quotes.find((q) => q.symbol.toUpperCase() === upper);
        setFullscreen((prev) =>
          prev && prev.symbol === symbol
            ? {
                ...prev,
                livePrice: quote?.close ?? null,
                liveChange: quote?.change ?? null,
              }
            : prev,
        );
      })
      .catch((_err) => {
        if (signal?.aborted) return; // superseded by a newer tick/load — stay silent
        if (chartRequest !== token) return;
        setFullscreen((prev) =>
          prev && prev.symbol === symbol
            ? { ...prev, livePrice: null, liveChange: null }
            : prev,
        );
      });
  };

  const loadSymbolChart = (
    symbol: string,
    timeframe: string | undefined,
    pinned: boolean,
    detectPatterns = true,
    replay?: { asOf?: string | null; fromDate?: string | null },
    keepHit: PatternHitDTO | null = null,
    refresh = false,
  ) => {
    const tf = timeframe ?? args.timeframe;
    const token = chartRequest + 1;
    chartRequest = token;
    const startedAt = performance.now();
    // A new load always supersedes the previous poll: one interval at most.
    stopLivePoll();
    setFullscreen({
      symbol,
      hit: keepHit,
      hits: [],
      timeframe: tf,
      candles: [],
      overlays: [],
      trendLines: [],
      loading: true,
      detectPatterns,
      asOf: replay?.asOf ?? null,
      fromDate: replay?.fromDate ?? null,
      pinned,
      patternsLoading: undefined,
      stale: false,
      dataAsOf: null,
      livePrice: null,
      liveChange: null,
    });

    void runTwoPhase(symbol, tf, token, detectPatterns, startedAt, {
      lookbackBars: args.lookbackBars,
      computeTrendlines: args.computeTrendlines,
      asOf: replay?.asOf ?? undefined,
      fromDate: replay?.fromDate ?? undefined,
      refresh,
    }, true);
    // Live frames poll the quote every 15s; historical (as-of) frames never do.
    if (replay?.asOf == null) {
      startLivePoll(symbol, token);
    }
  };

  /** Clear this symbol's cached frames and refetch the open chart in place. */
  const refreshSymbolChart = () => {
    const current = fullscreen();
    if (!current) return;
    invalidateSymbolChartCache(current.symbol, current.timeframe);
    loadSymbolChart(
      current.symbol,
      current.timeframe,
      current.pinned,
      current.detectPatterns !== false,
      { asOf: current.asOf, fromDate: current.fromDate },
      current.hit,
      true,
    );
  };

  const openFromSymbol = (symbol: string, timeframe?: string, detectPatterns = true) => {
    selectedHit = null;
    return loadSymbolChart(symbol, timeframe, true, detectPatterns);
  };

  /** Hover preview: same widget, but dismissible (pinned = false). */
  const previewFromSymbol = (symbol: string, timeframe?: string, detectPatterns = true) => {
    selectedHit = null;
    return loadSymbolChart(symbol, timeframe, false, detectPatterns);
  };

  // Fullscreen timeframe switch: candles first (phase 1), then patterns only
  // when the current chart has detection enabled (phase 2). Preserves as-of.
  const changeFullscreenTimeframe = (tf: string) => {
    const current = fullscreen();
    if (!current || tf === current.timeframe) return;
    const token = chartRequest + 1;
    chartRequest = token;
    const { symbol, asOf, fromDate } = current;
    const startedAt = performance.now();
    stopLivePoll();
    setFullscreen((prev) =>
      prev
        ? {
            ...prev,
            timeframe: tf,
            loading: true,
            patternsLoading: undefined,
            livePrice: null,
            liveChange: null,
          }
        : prev,
    );
    void runTwoPhase(symbol, tf, token, current.detectPatterns !== false, startedAt, {
      asOf: asOf ?? undefined,
      fromDate: fromDate ?? undefined,
      // Deliberately omitted: the pre-two-phase timeframe switch did not send
      // compute_trendlines (server default).
      computeTrendlines: undefined,
    });
    // The reload for the new timeframe repopulates the quote via its poll.
    if (asOf == null) startLivePoll(symbol, token);
  };

  // Fullscreen as-of replay: re-runs detection truncated at the cutoff.
  const changeFullscreenAsOf = (asOf: string | null, fromDate: string | null) => {
    const current = fullscreen();
    if (!current) return;
    const token = chartRequest + 1;
    chartRequest = token;
    const { symbol, timeframe: tf } = current;
    stopLivePoll();
    setFullscreen((prev) =>
      prev
        ? {
            ...prev,
            asOf,
            fromDate,
            loading: true,
            // A live quote must not sit on a historical frame.
            livePrice: null,
            liveChange: null,
          }
        : prev,
    );
    void fetchSymbolChart(symbol, tf, {
      detectPatterns: true,
      asOf: asOf ?? undefined,
      fromDate: fromDate ?? undefined,
    })
      .then((chart) => applySymbolChart(chart, symbol, tf, token, { asOf, fromDate }))
      .catch(() => applySymbolChartError(symbol, tf, token, { asOf, fromDate }));
    // Returning to live restarts the quote fetch/poll; historical frames never poll.
    if (asOf == null) startLivePoll(symbol, token);
  };

  /** Fullscreen single-select: switch the chart to the chosen pattern. */
  const selectFullscreenHit = (hit: PatternHitDTO) => {
    selectedHit = hit;
    setFullscreen((prev) => (prev ? { ...prev, hit } : prev));
  };

  const closeFullscreen = () => {
    selectedHit = null;
    stopLivePoll();
    chartRequest += 1;
    setFullscreen(null);
  };

  // Scope / resolution watchers. One effect so a scope change (which closes
  // the chart) supersedes a same-commit resolution change.
  createEffect(() => {
    const nextScope = readScopeKey();
    const nextResolution = readResolutionKey();
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
    stopLivePoll();
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
    refreshSymbolChart,
    selectFullscreenHit,
    closeFullscreen,
  };
}
