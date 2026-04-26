import { useEffect, useState, useCallback } from "react";
import { fetchChartPreview, type ChartPreviewData } from "../api/chartPreview";

interface UseChartDataOptions {
  symbol: string;
  timeframe: number;
  orMinutes: number;
}

interface UseChartDataResult {
  data: ChartPreviewData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useChartData({
  symbol,
  timeframe,
  orMinutes,
}: UseChartDataOptions): UseChartDataResult {
  const [data, setData] = useState<ChartPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!symbol) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchChartPreview(symbol, timeframe, 5, orMinutes);

      if (!result) {
        setError("No data available");
      } else if (result.error) {
        setError(result.error);
      } else {
        setData(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chart");
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe, orMinutes]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
