import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import {
  fetchMarketSnapshot,
  readCachedMarketSnapshot,
  writeCachedMarketSnapshot,
  type MarketSnapshotParams,
} from "../../api/marketScreener";
import type { MarketRow, MarketSnapshot, MarketUniverse } from "../../types/marketScreener";

/** A snapshot fetch that has not answered within this window is failed as timed out. */
export const MARKET_SNAPSHOT_TIMEOUT_MS = 15_000;
/** After this long still loading, the UI may hint that All NSE is warming up. */
export const MARKET_SNAPSHOT_WARMING_HINT_MS = 4_000;

export interface UseMarketSnapshotResult {
  snapshot: () => MarketSnapshot | null;
  rows: () => MarketRow[];
  total: () => number;
  updateMode: () => string | null;
  asOf: () => string | null;
  isLoading: () => boolean;
  error: () => Error | null;
  refresh: () => void;
  lastUpdated: () => string | null;
  stale: () => boolean;
  warming: () => boolean;
}

/**
 * Solid-native port of src/hooks/useMarketSnapshot (still on React).
 * Restores the last snapshot from sessionStorage synchronously on mount so the
 * page paints instantly; the network fetch then replaces it.
 */
export function useMarketSnapshotSolid(
  universe: () => MarketUniverse,
  options: { force?: boolean } = {},
): UseMarketSnapshotResult {
  const force = options.force === true;
  const [nonce, setNonce] = createSignal(0);
  const [snapshot, setSnapshot] = createSignal<MarketSnapshot | null>(
    readCachedMarketSnapshot(universe()),
  );
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<Error | null>(null);
  const [stale, setStale] = createSignal<boolean>(readCachedMarketSnapshot(universe()) !== null);
  const [warming, setWarming] = createSignal(false);
  let requestedUniverse = universe();
  let abortController: AbortController | null = null;

  const refresh = () => setNonce((n) => n + 1);

  createEffect(() => {
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

    const params: MarketSnapshotParams = { universe: u, force };
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
