import { useEffect, useRef } from "react";
import { buildChartOption } from "../components/chart/chartRenderer";
import type { ChartPreviewData } from "../api/chartPreview";

interface UseChartInstanceOptions {
  data: ChartPreviewData | null;
  showPivots: boolean;
  show52wHigh: boolean;
  isDark: boolean;
  loading: boolean;
}

interface UseChartInstanceResult {
  chartRef: React.RefObject<HTMLDivElement | null>;
  error: string | null;
}

export function useChartInstance({
  data,
  showPivots,
  show52wHigh,
  isDark,
  loading,
}: UseChartInstanceOptions): UseChartInstanceResult {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<any>(null);
  const errorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data || !chartRef.current || loading) {
      errorRef.current = null;
      return;
    }

    // Check if echarts is available
    if (!(window as any).echarts) {
      errorRef.current = "ECharts not loaded";
      return;
    }

    // Dispose previous chart
    if (chartInstanceRef.current) {
      chartInstanceRef.current.dispose();
      chartInstanceRef.current = null;
    }

    // Build chart option
    const chartOption = buildChartOption({
      symbol: data.symbol,
      candles: data.candles,
      orb_zones: data.orb_zones ?? [],
      pivot_levels: data.pivot_levels,
      high_52w: data.high_52w,
      size: "full",
      showPivots,
      show52wHigh,
      isDark,
    });

    if (!chartOption) {
      errorRef.current = "Failed to build chart";
      return;
    }

    // Initialize chart
    chartInstanceRef.current = (window as any).echarts.init(
      chartRef.current,
      isDark ? "dark" : null,
    );
    chartInstanceRef.current.setOption(chartOption);

    // Handle resize
    const handleResize = () => {
      chartInstanceRef.current?.resize();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, [data, showPivots, show52wHigh, loading, isDark]);

  return { chartRef, error: errorRef.current };
}
