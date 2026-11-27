import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import {
  lookupPatterns,
  PATTERN_LOOKUP_MAX_SYMBOLS,
  type PatternLookupItem,
  type PatternLookupPattern,
} from "../../api/patternLookup";

/** What the PATTERNS column needs for one symbol. */
export interface PatternSummaryItem {
  count: number;
  patterns: PatternLookupPattern[];
}

export interface UsePatternSummaryResult {
  /** Symbols with at least one stored hit, keyed by symbol. Missing = show a dash. */
  summary: () => ReadonlyMap<string, PatternSummaryItem>;
  /** A window request is pending. Deliberately one flag for the whole table. */
  loading: () => boolean;
}

export const PATTERN_SUMMARY_DEBOUNCE_MS = 200;
/** A failed window is retried once, then the column stays quiet. */
const MAX_ATTEMPTS = 2;

interface InFlight {
  symbols: Set<string>;
  scope: string;
  controller: AbortController;
}

function normalizeSymbols(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const symbol = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (symbol === "" || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
    if (out.length >= PATTERN_LOOKUP_MAX_SYMBOLS) break;
  }
  // Order-insensitive: a re-sort that keeps the same membership is not a window
  // change, so it must not cost a request.
  return out.sort();
}

/**
 * Stored 1D patterns for the rows the table is actually mounting.
 *
 * One batch request per visible window — never per row and never per symbol.
 * The window is debounced so a scroll/sort burst settles into one call, answers
 * are cached per symbol (including "asked, nothing stored") until the backend
 * reports a new session, and failures are silent because the pattern column is
 * context, not a feature the user asked for.
 */
export function usePatternSummary(
  symbols: () => string[],
  universe: () => string,
  timeframe = "1D",
): UsePatternSummaryResult {
  const [summary, setSummary] = createSignal<ReadonlyMap<string, PatternSummaryItem>>(new Map());
  const [loading, setLoading] = createSignal(false);

  /** symbol → stored hits; an empty array means "asked, nothing stored". */
  const cache = new Map<string, PatternLookupPattern[]>();
  let cacheSession: string | null = null;
  let cacheScope: string | null = null;
  let inFlight: InFlight | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const wanted = createMemo<string[]>(() => normalizeSymbols(symbols()), [], {
    equals: (a, b) => a.length === b.length && a.every((symbol, i) => symbol === b[i]),
  });

  const publish = () => {
    const next = new Map<string, PatternSummaryItem>();
    for (const [symbol, patterns] of cache) {
      if (patterns.length > 0) next.set(symbol, { count: patterns.length, patterns });
    }
    setSummary(next);
  };

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const abortInFlight = () => {
    inFlight?.controller.abort();
    inFlight = null;
  };

  const resetCache = (scope: string) => {
    cacheScope = scope;
    cache.clear();
    cacheSession = null;
    setSummary(new Map());
  };

  const merge = (
    scope: string,
    session: string | null,
    asked: string[],
    items: PatternLookupItem[],
  ) => {
    if (cacheScope !== scope) resetCache(scope);
    // A different session means every cached answer describes an older scan; a
    // partial merge would put two sessions in one column.
    if (session !== null && cacheSession !== null && session !== cacheSession) cache.clear();
    if (session !== null) cacheSession = session;
    // Record the misses too: a symbol with no stored hit must not be re-asked
    // on every scroll.
    for (const symbol of asked) cache.set(symbol, []);
    for (const item of items) cache.set(item.symbol, item.patterns);
    publish();
  };

  const start = (missing: string[], scope: string, retry = 0) => {
    const controller = new AbortController();
    const record: InFlight = { symbols: new Set(missing), scope, controller };
    inFlight = record;
    setLoading(true);

    lookupPatterns({ symbols: missing, timeframe, universe: scope }, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        if (inFlight === record) inFlight = null;
        merge(scope, res.session ?? res.data_through ?? null, missing, res.items);
        setLoading(false);
        // The window may have grown while this was in flight; cover the rest now
        // rather than waiting for another scroll event.
        schedule();
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        if (inFlight === record) inFlight = null;
        if (retry < MAX_ATTEMPTS - 1) {
          start(missing, scope, retry + 1);
          return;
        }
        // Silent by design: cells keep their dash, and the next window change or
        // universe switch is a clean retry.
        setLoading(false);
      });
  };

  /** Debounced dispatch of whatever the current window still needs. */
  const schedule = () => {
    clearTimer();
    const scope = universe();
    const needs = wanted().filter((symbol) => !cache.has(symbol));
    if (needs.length === 0) {
      setLoading(false);
      return;
    }
    // A landed-and-partial answer would cost a second request for the same
    // window, so an in-flight call only survives when it already covers every
    // symbol the window now asks for.
    if (inFlight && !(inFlight.scope === scope && needs.every((s) => inFlight!.symbols.has(s)))) {
      abortInFlight();
    }
    if (inFlight) return;
    setLoading(true);
    timer = setTimeout(() => {
      timer = null;
      start(
        wanted().filter((symbol) => !cache.has(symbol)),
        scope,
      );
    }, PATTERN_SUMMARY_DEBOUNCE_MS);
  };

  createEffect(() => {
    const scope = universe();
    if (cacheScope !== null && cacheScope !== scope) {
      abortInFlight();
      resetCache(scope);
    }
    void wanted();
    schedule();
  });

  onCleanup(() => {
    clearTimer();
    abortInFlight();
  });

  return { summary, loading };
}
