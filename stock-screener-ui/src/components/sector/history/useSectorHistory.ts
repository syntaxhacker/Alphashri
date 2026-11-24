import { createEffect, createSignal, onCleanup } from "solid-js";
import { fetchSectorHistory } from "../../../api/sectorHistory";
import type { SectorHistoryMarket, SectorHistoryResponse } from "../../../types/sectorHistory";

export interface UseSectorHistoryResult {
  data: () => SectorHistoryResponse | null;
  loading: () => boolean;
  error: () => string | null;
  refresh: () => void;
}

export function useSectorHistory(
  market: () => SectorHistoryMarket,
  years: () => number,
): UseSectorHistoryResult {
  const [data, setData] = createSignal<SectorHistoryResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [requestKey, setRequestKey] = createSignal(0);

  createEffect(() => {
    const currentMarket = market();
    const currentYears = years();
    requestKey();

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchSectorHistory({ market: currentMarket, years: currentYears, signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setData(response);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load sector history");
        setData(null);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
      });

    onCleanup(() => controller.abort());
  });

  const refresh = () => setRequestKey((value) => value + 1);

  return { data, loading, error, refresh };
}
