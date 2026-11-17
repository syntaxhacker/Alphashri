/**
 * Solid port of src/hooks/usePatternFullscreen (which is still React and
 * cannot mount under SolidJS). Identical state machine and behavior, with
 * accessor-based API: `fullscreen()` instead of a destructured value.
 *
 * The hooks owner should fold this back into src/hooks/usePatternFullscreen.ts
 * once their scope converts; until then this is the report page's local twin.
 */
import { createEffect, createSignal, onCleanup } from "solid-js";
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

export type SymbolChartPayload = Awaited<ReturnType<typeof fetchSymbolChart>>;
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
export function istSessionDate(value: string | null | undefined): string | null {
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
 *
 * `detectionAsOf` is the base frame whose hits (and their `bars_ago`) were
 * detected. It is a *separate* axis from display freshness: the displayed series
 * may legitimately be newer than the detected one, and the consumer must say so
 * instead of implying the pattern read is current.
 */
const staleFields = (
  chart: SymbolChartPayload,
): Pick<FullscreenChartState, "stale" | "dataAsOf" | "detectionAsOf"> => {
  const candles = chart.candles ?? [];
  const candleDate = istSessionDate(candles.length ? candles[candles.length - 1].t : null);
  const asOfDate = istSessionDate(chart.as_of);
  const detectionAsOf = istSessionDate(chart.detection_as_of);
  if (candleDate && asOfDate && candleDate > asOfDate) {
    return { stale: false, dataAsOf: null, detectionAsOf };
  }
  return chart.stale === true
    ? { stale: true, dataAsOf: chart.as_of ?? null, detectionAsOf }
    : { stale: false, dataAsOf: null, detectionAsOf };
};

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
  /**
   * Completed-session frame (`YYYY-MM-DD`) the open hits were detected on. The
   * displayed series can be newer (today's tape bar is display-only), so a
   * docked panel must label a detection date that trails the last candle.
   */
  detectionAsOf?: string | null;
  /** Latest traded price from the market snapshot; null until it resolves (or on failure). */
  livePrice?: number | null;
  /** Day change % paired with `livePrice`; null when unavailable. */
  liveChange?: number | null;
  /** Chart endpoint failure code (`no_data`, `fetch_timeout`, …). */
  chartError?: string | null;
  /** Human-readable reason shown instead of a blank chart. */
  chartNote?: string | null;
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
  // The hit the user explicitly picked from the list. Reloads (refresh,
  // timeframe, as-of) keep this pick while its identity survives the new
  // payload; a card open or a fresh symbol open clears it so newest wins.
  let selectedHit: PatternHitDTO | null = null;
  // One live-quote poll at most per hook instance: a timer handle plus the
  // AbortController that cancels the in-flight tick whenever the poll is
  // superseded by a new load, a timeframe/as-of change, a close, or cleanup.
  let liveTimer: ReturnType<typeof setInterval> | null = null;
  let liveController: AbortController | null = null;

  // Poll the live quote every 15s while the fullscreen dock/modal is open.
  const POLL_INTERVAL_MS = 15_000;

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

  const resolveHit = (hits: PatternHitDTO[]): PatternHitDTO | null => {
    const picked = selectedHit;
    if (picked && hits.some((h) => fullscreenHitIdentity(h) === fullscreenHitIdentity(picked))) {
      return picked;
    }
    return newestHit(hits);
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

  const openFromCard = (hit: PatternHitDTO) => {
    selectedHit = null;
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
      detectionAsOf: null,
      livePrice: null,
      liveChange: null,
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
        if (chartRequestToken !== token) return;
        setFullscreen((prev) =>
          prev && prev.hit && fullscreenHitIdentity(prev.hit) === identity
            ? { ...prev, loading: false }
            : prev,
        );
    });
    startLivePoll(hit.symbol, token);
  };

  const symbolChartCache = new Map<string, { chart: SymbolChartPayload; ts: number }>();

  /** Drop both cached phases (and every replay window) for one symbol+timeframe. */
  const invalidateSymbolChartCache = (symbol: string, tf: string) => {
    const prefix = `${symbol}|${tf}|`;
    for (const key of symbolChartCache.keys()) {
      if (key.startsWith(`${prefix}l|`) || key.startsWith(`${prefix}p|`)) {
        symbolChartCache.delete(key);
      }
    }
  };

  /** The endpoint answers 200 with `error`/`note` when it has no candles. */
  const chartProblem = (chart: SymbolChartPayload) => ({
    chartError: chart.error ?? null,
    chartNote: chart.note ?? null,
  });

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
              ...chartProblem(chart),
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
          ? {
              ...prev,
              loading: false,
              chartError: "request_failed",
              chartNote: `Could not load candles for ${symbol} ${tf}.`,
            }
          : prev,
      );
    };

    const applyPatterns = (chart: SymbolChartPayload) => {
      if (chartRequestToken !== token) return;
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
      const key = `${symbol}|${tf}|p|${extra.asOf ?? ""}|${extra.fromDate ?? ""}`;
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

    // Stored-first by default. An explicit live request and as-of/replay frames
    // never accept stored hits: replay is live-only, and an explicit live request
    // must not be short-circuited by a stale stored scan. Otherwise a stored hit
    // wins and only an unscanned symbol triggers one live fallback detection.
    const forceLive = detectPatterns || extra.asOf != null;

    const phase1 = async () => {
      const key = `${symbol}|${tf}|l|${extra.asOf ?? ""}|${extra.fromDate ?? ""}`;
      const cached = symbolChartCache.get(key);
      if (cached && Date.now() - cached.ts < SYMBOL_CHART_CACHE_MS) {
        applyCandles(cached.chart);
        if (forceLive || (cached.chart.hits ?? []).length === 0) {
          await phase2();
        } else {
          applyPatterns(cached.chart);
        }
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
        if (forceLive || (chart.hits ?? []).length === 0) {
          await phase2();
        } else {
          applyPatterns(chart);
        }
      } catch {
        applyCandlesError();
      }
    };

    void phase1();
  };

  /** Best-effort live quote; a failure leaves the LTP fields null, never blocks the chart. */
  const fetchLiveQuote = (symbol: string, token: number, signal?: AbortSignal) => {
    void Promise.resolve()
      .then(() => fetchQuotes([symbol], { signal }))
      .then((quotes) => {
        if (chartRequestToken !== token) return;
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
        if (chartRequestToken !== token) return;
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
    detectPatterns = false,
    replay?: { asOf?: string | null; fromDate?: string | null },
    keepHit: PatternHitDTO | null = null,
    refresh = false,
  ) => {
    const tf = timeframe ?? defaultTimeframe;
    const token = ++chartRequestToken;
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
      detectionAsOf: null,
      chartError: null,
      chartNote: null,
      livePrice: null,
      liveChange: null,
    });

    void runTwoPhase(symbol, tf, token, detectPatterns, {
      lookbackBars,
      computeTrendlines,
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

  const openFromSymbol = (
    symbol: string,
    timeframe?: string,
    detectPatterns = false,
  ) => {
    selectedHit = null;
    return loadSymbolChart(symbol, timeframe, true, detectPatterns);
  };

  const previewFromSymbol = (
    symbol: string,
    timeframe?: string,
    detectPatterns = false,
  ) => {
    selectedHit = null;
    return loadSymbolChart(symbol, timeframe, false, detectPatterns);
  };

  const changeFullscreenTimeframe = (tf: string) => {
    const current = fullscreen();
    if (!current || tf === current.timeframe) return;
    const token = ++chartRequestToken;
    const { symbol, asOf, fromDate } = current;
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
    void runTwoPhase(symbol, tf, token, current.detectPatterns !== false, {
      asOf,
      fromDate,
      computeTrendlines: undefined,
    });
    // The reload for the new timeframe repopulates the quote via its poll.
    if (asOf == null) startLivePoll(symbol, token);
  };

  const changeFullscreenAsOf = (asOf: string | null, fromDate: string | null) => {
    const current = fullscreen();
    if (!current) return;
    const token = ++chartRequestToken;
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

  const selectFullscreenHit = (hit: PatternHitDTO) => {
    selectedHit = hit;
    setFullscreen((prev) => (prev ? { ...prev, hit } : prev));
  };

  const closeFullscreen = () => {
    selectedHit = null;
    stopLivePoll();
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

  onCleanup(() => {
    stopLivePoll();
    // Bump the token so a response already in flight cannot write to state
    // after the owner is disposed.
    chartRequestToken += 1;
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
    refreshSymbolChart,
    selectFullscreenHit,
    closeFullscreen,
  };
}
