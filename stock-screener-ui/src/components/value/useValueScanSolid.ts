import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import {
  valueScan,
  type ValueFilters,
  type ValueRow,
  type ValueScanResponse,
  type ValueSector,
} from "../../api/valueScan";

export interface ValueScanMeta {
  market: string;
  currency: string;
  as_of: string;
  scanned: number;
  matched: number;
  fields_complete: boolean;
  filters_applied: Record<string, unknown>;
}

export interface UseValueScanResult {
  data: () => ValueScanResponse | null;
  rows: () => ValueRow[];
  sectors: () => ValueSector[];
  meta: () => ValueScanMeta | null;
  warnings: () => string[];
  isLoading: () => boolean;
  error: () => Error | null;
  refresh: () => void;
  lastUpdated: () => string | null;
}

const DEBOUNCE_MS = 300;

/**
 * Solid-native port of src/hooks/useValueScan (which is still on React).
 * Same wire contract: debounced fetch, per-filter response cache, abort on
 * re-request. `filters` must be an accessor — the fetch re-arms when the
 * serialized filters change.
 */
export function useValueScanSolid(filters: () => ValueFilters): UseValueScanResult {
  const cacheRef = new Map<string, ValueScanResponse>();
  let abortController: AbortController | null = null;
  let immediateRef = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const [nonce, setNonce] = createSignal(0);
  const [data, setData] = createSignal<ValueScanResponse | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<Error | null>(null);

  const refresh = () => {
    immediateRef = true;
    setNonce((n) => n + 1);
  };

  const key = createMemo(() => JSON.stringify(filters()));

  createEffect(() => {
    const k = key();
    const n = nonce();
    void n;
    const cached = cacheRef.get(k);
    if (cached) {
      setData(cached);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
    setError(null);

    let cancelled = false;

    const run = async (signal: AbortSignal): Promise<void> => {
      try {
        const res = await valueScan(filters(), { signal });
        if (cancelled || signal.aborted) return;
        cacheRef.set(k, res);
        setData(res);
        setError(null);
        setIsLoading(false);
      } catch (e) {
        if (cancelled || signal.aborted) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setIsLoading(false);
      }
    };

    const startFetch = () => {
      abortController?.abort();
      const controller = new AbortController();
      abortController = controller;
      void run(controller.signal);
    };

    if (immediateRef) {
      immediateRef = false;
      startFetch();
      onCleanup(() => {
        cancelled = true;
        abortController?.abort();
      });
      return;
    }

    timer = setTimeout(startFetch, DEBOUNCE_MS);
    onCleanup(() => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      abortController?.abort();
    });
  });

  const rows = createMemo(() => data()?.rows ?? []);
  const sectors = createMemo(() => data()?.sectors ?? []);
  const warnings = createMemo(() => data()?.warnings ?? []);
  const meta = createMemo<ValueScanMeta | null>(() => {
    const d = data();
    return d
      ? {
          market: d.market,
          currency: d.currency,
          as_of: d.as_of,
          scanned: d.scanned,
          matched: d.matched,
          fields_complete: d.fields_complete,
          filters_applied: d.filters_applied,
        }
      : null;
  });

  return {
    data,
    rows,
    sectors,
    meta,
    warnings,
    isLoading,
    error,
    refresh,
    lastUpdated: () => data()?.as_of ?? null,
  };
}
