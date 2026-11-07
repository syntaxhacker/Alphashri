import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPatternMatrix } from "../api/chartPatterns";
import type { PatternMatrixResponse } from "../types/chartPatterns";

export interface UsePatternMatrixResult {
  data: PatternMatrixResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function usePatternMatrix(
  universe: string,
  enabled = true,
  refreshKey: string | null = null,
  timeframes: string[] = [],
): UsePatternMatrixResult {
  const [data, setData] = useState<PatternMatrixResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const tokenRef = useRef(0);
  const timeframeKey = timeframes.join(",");

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !universe) return;
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    setLoading(true);
    setError(null);
    const ids = timeframeKey ? timeframeKey.split(",") : [];
    const timer = setTimeout(() => {
      fetchPatternMatrix(universe, { limit: 1000, timeframes: ids })
        .then((response) => {
          if (tokenRef.current !== token) return;
          setData(response);
        })
        .catch((err: unknown) => {
          if (tokenRef.current !== token) return;
          setError(err instanceof Error ? err.message : "Failed to load pattern matrix");
        })
        .finally(() => {
          if (tokenRef.current !== token) return;
          setLoading(false);
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      if (tokenRef.current === token) tokenRef.current += 1;
    };
  }, [universe, enabled, refreshKey, nonce, timeframeKey]);

  return { data, loading, error, reload };
}
