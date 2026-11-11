import { useCallback, useEffect, useRef, useState } from "react";
import {
  valueScan,
  type ValueFilters,
  type ValueRow,
  type ValueScanResponse,
  type ValueSector,
} from "../api/valueScan";

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
  data: ValueScanResponse | null;
  rows: ValueRow[];
  sectors: ValueSector[];
  meta: ValueScanMeta | null;
  warnings: string[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
  lastUpdated: string | null;
}

const DEBOUNCE_MS = 300;

export function useValueScan(filters: ValueFilters): UseValueScanResult {
  const filtersRef = useRef<ValueFilters>(filters);
  filtersRef.current = filters;
  const key = JSON.stringify(filters);
  const cacheRef = useRef<Map<string, ValueScanResponse>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const immediateRef = useRef(false);
  const [nonce, setNonce] = useState(0);
  const [data, setData] = useState<ValueScanResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(() => {
    immediateRef.current = true;
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const cached = cacheRef.current.get(key);
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
        const res = await valueScan(filtersRef.current, { signal });
        if (cancelled || signal.aborted) return;
        cacheRef.current.set(key, res);
        setData(res);
        setError(null);
        setIsLoading(false);
      } catch (e) {
        if (cancelled || signal.aborted) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setIsLoading(false);
      }
    };

    const startFetch = (): (() => void) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      void run(controller.signal);
      return () => {
        cancelled = true;
        controller.abort();
      };
    };

    if (immediateRef.current) {
      immediateRef.current = false;
      return startFetch();
    }

    const timer = setTimeout(startFetch, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const rows = data?.rows ?? [];
  const sectors = data?.sectors ?? [];
  const warnings = data?.warnings ?? [];
  const meta: ValueScanMeta | null = data
    ? {
        market: data.market,
        currency: data.currency,
        as_of: data.as_of,
        scanned: data.scanned,
        matched: data.matched,
        fields_complete: data.fields_complete,
        filters_applied: data.filters_applied,
      }
    : null;

  return {
    data,
    rows,
    sectors,
    meta,
    warnings,
    isLoading,
    error,
    refresh,
    lastUpdated: data?.as_of ?? null,
  };
}
