import { useState, useCallback, useEffect, useRef } from "react";

interface UseAsyncDataOptions<T> {
  fetchFn: () => Promise<T>;
  autoFetch?: boolean;
  errorMessage?: string;
}

interface UseAsyncDataReturn<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  execute: () => Promise<void>;
  setData: (data: T | null) => void;
  setError: (error: string | null) => void;
}

export function useAsyncData<T>(options: UseAsyncDataOptions<T>): UseAsyncDataReturn<T> {
  const { fetchFn, autoFetch = true, errorMessage = "Failed to load" } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(autoFetch);
  const [error, setError] = useState<string | null>(null);

  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFnRef.current();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : errorMessage);
    } finally {
      setLoading(false);
    }
  }, [errorMessage]);

  useEffect(() => {
    if (autoFetch) {
      execute();
    }
  }, [autoFetch, execute]);

  return { data, loading, error, execute, setData, setError };
}
