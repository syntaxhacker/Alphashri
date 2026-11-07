import { useCallback, useEffect, useState } from "react";
import { fetchRotationOverview } from "../api/rotation";
import type { RotationKind, RotationOverviewResponse } from "../types/rotation";

interface RotationDataState {
  data: RotationOverviewResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useRotationData(market: string, kind: RotationKind): RotationDataState {
  const [data, setData] = useState<RotationOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchRotationOverview({
      market,
      kind,
      minMembers: 1,
      limit: 48,
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) setData(response);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to load rotation data");
          setData(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [market, kind, version]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  return { data, loading, error, refresh };
}
