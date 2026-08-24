import { forwardRef, useImperativeHandle, useEffect } from "react";
import { useECharts } from "../../hooks/useECharts";
import { useChartZoom } from "../../hooks/useChartZoom";
import { buildChartOption } from "../../utils/chart/buildChartOption";
import type { ChartInput } from "../../utils/chart/types";
import { Loader } from "@/ui";
import Box from "@mui/material/Box";

export interface TradingChartHandle {
  chartInstance: React.MutableRefObject<any>;
  zoomToTradeByTime: (entryTime: string, exitTime: string) => void;
  zoomToTradeByIndex: (startIdx: number, endIdx: number, total: number) => void;
}

interface TradingChartProps {
  input: ChartInput;
  isLoading?: boolean;
  onTradeClick?: (tradeId: number) => void;
  style?: React.CSSProperties;
}

export const TradingChart = forwardRef<TradingChartHandle, TradingChartProps>(function TradingChart(
  { input, isLoading, onTradeClick, style },
  ref,
) {
  const { chartRef, chartInstance, setChartOption } = useECharts({
    isDark: input.isDark,
    onChartClick: onTradeClick
      ? (params: any) => {
          if (params.componentType === "series" && params.seriesType === "scatter") {
            const data = params.data;
            if (data?.trade_id !== undefined) onTradeClick(data.trade_id);
          }
        }
      : undefined,
  });

  const { allTimesRef, zoomToTradeByTime, zoomToTradeByIndex } = useChartZoom({
    chartInstance,
  });

  useImperativeHandle(ref, () => ({
    chartInstance,
    zoomToTradeByTime,
    zoomToTradeByIndex,
  }));

  useEffect(() => {
    if (!(window as any).echarts) {
      void import("echarts").then((mod) => {
        (window as any).echarts = (mod as any).default ?? mod;
      });
    }
  }, []);

  useEffect(() => {
    if (isLoading || !input.candles.length) return;

    const times = input.candles.map((c) => {
      if (c.time_str) return c.time_str;
      const parts = c.time.split(/[T ]/);
      return parts.length > 1 ? parts[parts.length - 1].substring(0, 5) : c.time.substring(0, 5);
    });
    allTimesRef.current = times;

    const option = buildChartOption(input);
    setChartOption(option);
  }, [input, isLoading, setChartOption, allTimesRef]);

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, height: 400, width: "100%" }} style={style as any}>
        <Loader size="lg" />
      </Box>
    );
  }

  return <Box ref={chartRef} sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, flex: 1, minHeight: 0, width: "100%" }} style={style} />;
});
