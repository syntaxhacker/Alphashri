import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMarketSnapshot,
  readCachedMarketSnapshot,
  writeCachedMarketSnapshot,
  type MarketSnapshotParams,
} from "../api/marketScreener";
import type { MarketRow, MarketSnapshot, MarketUniverse } from "../types/marketScreener";

/** A snapshot fetch that has not answered within this window is failed as timed out. */
export const MARKET_SNAPSHOT_TIMEOUT_MS = 15_000;
/** After this long still loading, the UI may hint that All NSE is warming up. */
export const MARKET_SNAPSHOT_WARMING_HINT_MS = 4_000;

export interface UseMarketSnapshotResult {
  snapshot: MarketSnapshot | null;
  rows: MarketRow[];
  total: number;
  updateMode: string | null;
  asOf: string | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
  lastUpdated: string | null;
  /** True while the painted snapshot came from the sessionStorage cache and no fresh fetch has replaced it yet. */
  stale: boolean;
  /** True once a fetch has been in flight for longer than the warming-hint threshold. */
  warming: boolean;
}

/**
 * Fetches the market snapshot for a universe. The last successful snapshot is
 * restored synchronously from sessionStorage (flagged `stale`) so the page
 * paints immediately; the network fetch then replaces it. The request carries
 * an AbortSignal that is cancelled on universe change, refresh or unmount —
 * a slow previous universe can never overwrite the newer one — and a 15s
 * timeout that fails the request with `Market snapshot timed out`.
 */
export function useMarketSnapshot(
  universe: MarketUniverse,
  options: { force?: boolean } = {},
): UseMarketSnapshotResult {
  const force = options.force === true;
  const [nonce, setNonce] = useState(0);
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(
    () => readCachedMarketSnapshot(universe),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [stale, setStale] = useState<boolean>(() => readCachedMarketSnapshot(universe) !== null);
  const [warming, setWarming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestedUniverseRef = useRef(universe);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;
    let timedOut = false;
    // Hydrate from the cache synchronously on a universe switch — the page
    // paints the last snapshot instantly instead of dropping to the skeleton.
    // (Initial mount is hydrated via the useState initializer; a plain refresh
    // keeps the currently painted snapshot.)
    if (requestedUniverseRef.current !== universe) {
      requestedUniverseRef.current = universe;
      const cached = readCachedMarketSnapshot(universe);
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
      // Settle the UI even if the fetch promise never rejects on abort.
      setError(new Error("Market snapshot timed out"));
      setIsLoading(false);
      setWarming(false);
    }, MARKET_SNAPSHOT_TIMEOUT_MS);
    const warmingId = window.setTimeout(() => setWarming(true), MARKET_SNAPSHOT_WARMING_HINT_MS);

    const params: MarketSnapshotParams = { universe, force };
    fetchMarketSnapshot(params, { signal: controller.signal })
      .then((res) => {
        if (cancelled || controller.signal.aborted) return;
        window.clearTimeout(timeoutId);
        window.clearTimeout(warmingId);
        setSnapshot(res);
        setStale(false);
        setIsLoading(false);
        setWarming(false);
        writeCachedMarketSnapshot(universe, res);
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

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      window.clearTimeout(warmingId);
      controller.abort();
    };
  }, [universe, nonce, force]);

  return {
    snapshot,
    rows: snapshot?.rows ?? [],
    total: snapshot?.total ?? 0,
    updateMode: snapshot?.updateMode ?? null,
    asOf: snapshot?.asOf ?? null,
    isLoading,
    error,
    refresh,
    lastUpdated: snapshot?.asOf ?? null,
    stale,
    warming,
  };
}
