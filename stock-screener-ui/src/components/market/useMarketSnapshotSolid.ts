import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import {
  fetchMarketSnapshot,
  readCachedMarketSnapshot,
  writeCachedMarketSnapshot,
  type MarketSnapshotParams,
} from "../../api/marketScreener";
import type { MarketRow, MarketSnapshot, MarketUniverse } from "../../types/marketScreener";
import { isMarketOpenNow } from "../../state/holidays";
import { isUsMarketOpen } from "../../utils/marketClock";

/** A snapshot fetch that has not answered within this window is failed as timed out. */
export const MARKET_SNAPSHOT_TIMEOUT_MS = 15_000;
/** After this long still loading, the UI may hint that All NSE is warming up. */
export const MARKET_SNAPSHOT_WARMING_HINT_MS = 4_000;
/** Auto-refresh cadence while the selected universe's cash session is live. */
export const MARKET_LIVE_POLL_MS = 5_000;

export interface UseMarketSnapshotResult {
  snapshot: () => MarketSnapshot | null;
  rows: () => MarketRow[];
  total: () => number;
  updateMode: () => string | null;
  asOf: () => string | null;
  isLoading: () => boolean;
  error: () => Error | null;
  /** `force` bypasses the server cache — used by the manual Refresh button. */
  refresh: (force?: boolean) => void;
  lastUpdated: () => string | null;
  stale: () => boolean;
  warming: () => boolean;
}

/** Whether `u`'s cash session is open right now (holiday-aware for India). */
export function isLiveUniverse(u: MarketUniverse): boolean {
  return u === "us" ? isUsMarketOpen() : isMarketOpenNow();
}

/**
 * Solid-native port of src/hooks/useMarketSnapshot (still on React).
 * Restores the last snapshot from sessionStorage synchronously on mount so the
 * page paints instantly; the network fetch then replaces it.
 */
export function useMarketSnapshotSolid(
  universe: () => MarketUniverse,
  options: { force?: boolean; enabled?: () => boolean } = {},
): UseMarketSnapshotResult {
  const forceEveryFetch = options.force === true;
  // Reactive getter, not a snapshot: a view switch must re-run the effect below.
  const enabled = options.enabled ?? (() => true);
  const [nonce, setNonce] = createSignal(0);
  const [snapshot, setSnapshot] = createSignal<MarketSnapshot | null>(
    readCachedMarketSnapshot(universe()),
  );
  const [isLoading, setIsLoading] = createSignal(enabled());
  const [error, setError] = createSignal<Error | null>(null);
  const [stale, setStale] = createSignal<boolean>(readCachedMarketSnapshot(universe()) !== null);
  const [warming, setWarming] = createSignal(false);
  let requestedUniverse = universe();
  let abortController: AbortController | null = null;
  // Not reactive on purpose: a manual force applies to the next fetch only, and
  // writing a signal here would re-run the effect that consumes it.
  let forceNext = false;

  const refresh = (force = false) => {
    if (force) forceNext = true;
    setNonce((n) => n + 1);
  };

  // Auto-refresh only while the selected universe's cash session is live. The
  // timer may tick off-hours; the fetch is what is gated, so no request leaves
  // the browser outside market hours. `universe()` is tracked so a switch
  // re-arms against the new market instead of the previous one.
  createEffect(() => {
    if (!enabled()) return;
    const u = universe();
    const intervalId = window.setInterval(() => {
      // A still-running request is never queued behind the tick: the next tick
      // re-checks, and a hung fetch cannot pile up parallel scans.
      if (!enabled() || isLoading() || !isLiveUniverse(u)) return;
      refresh();
    }, MARKET_LIVE_POLL_MS);
    onCleanup(() => window.clearInterval(intervalId));
  });

  createEffect(() => {
    // Tracking `enabled()` here means a view switch re-runs this effect. While
    // disabled, drop any in-flight request and surface neither loading nor an
    // error — the cached snapshot stays put for an instant paint on re-enable.
    if (!enabled()) {
      abortController?.abort();
      abortController = null;
      setIsLoading(false);
      setError(null);
      setWarming(false);
      return;
    }
    const u = universe();
    const n = nonce();
    void n;
    abortController?.abort();
    const controller = new AbortController();
    abortController = controller;
    let cancelled = false;
    let timedOut = false;
    // Hydrate from the cache synchronously on a universe switch — the page
    // paints the last snapshot instantly instead of dropping to the skeleton.
    if (requestedUniverse !== u) {
      requestedUniverse = u;
      const cached = readCachedMarketSnapshot(u);
      setSnapshot(cached);
      setStale(cached !== null);
    }
    setIsLoading(true);
    setError(null);
    setWarming(false);

    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
      window.clearTimeout(warmingId);
      setError(new Error("Market snapshot timed out"));
      setIsLoading(false);
      setWarming(false);
    }, MARKET_SNAPSHOT_TIMEOUT_MS);
    const warmingId = window.setTimeout(() => setWarming(true), MARKET_SNAPSHOT_WARMING_HINT_MS);

    const params: MarketSnapshotParams = { universe: u, force: forceEveryFetch || forceNext };
    // Consume the one-shot manual force; the next fetch (auto tick or manual
    // unforced refresh) must not inherit it.
    forceNext = false;
    fetchMarketSnapshot(params, { signal: controller.signal })
      .then((res) => {
        if (cancelled || controller.signal.aborted) return;
        window.clearTimeout(timeoutId);
        window.clearTimeout(warmingId);
        setSnapshot(res);
        setStale(false);
        setIsLoading(false);
        setWarming(false);
        writeCachedMarketSnapshot(u, res);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        window.clearTimeout(timeoutId);
        window.clearTimeout(warmingId);
        if (timedOut) {
          setError(new Error("Market snapshot timed out"));
        } else if (controller.signal.aborted) {
          // Aborted by a universe change or unmount — stay silent.
          return;
        } else {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
        setIsLoading(false);
        setWarming(false);
      });

    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      window.clearTimeout(warmingId);
      controller.abort();
    });
  });

  return {
    snapshot,
    rows: createMemo(() => snapshot()?.rows ?? []),
    total: createMemo(() => snapshot()?.total ?? 0),
    updateMode: createMemo(() => snapshot()?.updateMode ?? null),
    asOf: createMemo(() => snapshot()?.asOf ?? null),
    isLoading,
    error,
    refresh,
    lastUpdated: createMemo(() => snapshot()?.asOf ?? null),
    stale,
    warming,
  };
}
