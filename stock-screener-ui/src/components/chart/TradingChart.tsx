import { forwardRef, useImperativeHandle, useEffect } from "react";
import { useECharts } from "../../hooks/useECharts";
import { useChartZoom } from "../../hooks/useChartZoom";
import { buildChartOption } from "../../utils/chart/buildChartOption";
import type { ChartInput } from "../../utils/chart/types";
import { Box, Loader, Center } from "@mantine/core";

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
      <Center style={{ ...style, height: 400 }}>
        <Loader size="lg" />
      </Center>
    );
  }

  return <Box ref={chartRef} style={{ ...style, flex: 1, minHeight: 0 }} />;
});
