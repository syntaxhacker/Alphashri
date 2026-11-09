import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMarketSnapshot,
  type MarketSnapshotParams,
} from "../api/marketScreener";
import type { MarketRow, MarketSnapshot, MarketUniverse } from "../types/marketScreener";

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
}

/**
 * Fetches the market snapshot for a universe. The request carries an
 * AbortSignal that is cancelled on universe change, refresh or unmount —
 * a slow previous universe can never overwrite the newer one.
 */
export function useMarketSnapshot(
  universe: MarketUniverse,
  options: { force?: boolean } = {},
): UseMarketSnapshotResult {
  const force = options.force === true;
  const [nonce, setNonce] = useState(0);
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestedUniverseRef = useRef(universe);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;
    // A snapshot for a different universe must never render under the new
    // selector value — drop it and show the skeleton for the new fetch.
    if (requestedUniverseRef.current !== universe) {
      requestedUniverseRef.current = universe;
      setSnapshot(null);
    }
    setIsLoading(true);
    setError(null);

    const params: MarketSnapshotParams = { universe, force };
    fetchMarketSnapshot(params, { signal: controller.signal })
      .then((res) => {
        if (cancelled || controller.signal.aborted) return;
        setSnapshot(res);
        setIsLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
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
  };
}
