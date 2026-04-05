import { useCallback, useEffect, useMemo, useRef } from "react";
import { Box, Text, useMantineColorScheme } from "@mantine/core";
import type { SymbolChartData } from "../../types/backtest";
import { useECharts } from "../../hooks/useECharts";
import { buildChartOption } from "./buildBacktestChartOption";
import { zoomToTrade, chartInstances } from "./zoomToTrade";

export { zoomToTrade };

interface BacktestChartProps {
  symbol: string;
  chartData: SymbolChartData | null | undefined;
  isLoading?: boolean;
  onTradeClick?: (tradeId: number) => void;
}

export function BacktestChart({ symbol, chartData, isLoading, onTradeClick }: BacktestChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  const option = useMemo(() => {
    if (!chartData) return null;
    return buildChartOption(chartData, isDark);
  }, [chartData, isDark]);

  const handleClick = useCallback(
    (params: any) => {
      if (params.componentType === "series" && params.seriesType === "scatter") {
        const data = params.data;
        if (data && data.trade_id !== undefined) {
          onTradeClick?.(data.trade_id - 1);
        }
      }
    },
    [onTradeClick],
  );

  const chartInstance = useECharts(chartRef, option, {
    isDark,
    onClick: onTradeClick ? handleClick : undefined,
  });

  useEffect(() => {
    if (!chartInstance.current || !option) return;
    chartInstances.set(symbol, chartInstance.current);
    return () => {
      chartInstances.delete(symbol);
    };
  }, [option, symbol]);

  if (isLoading) {
    return (
      <Box
        className="backtest-chart-loading"
        data-testid="backtest-chart-loading"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          backgroundColor: "var(--mantine-color-body)",
          borderRadius: "var(--mantine-radius-md)",
        }}
      >
        <Text c="dimmed">Loading {symbol}...</Text>
      </Box>
    );
  }

  if (!chartData) {
    return (
      <Box
        className="backtest-chart-empty"
        data-testid="backtest-chart-empty"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          backgroundColor: "var(--mantine-color-body)",
          borderRadius: "var(--mantine-radius-md)",
        }}
      >
        <Text c="dimmed">No chart data for {symbol}</Text>
      </Box>
    );
  }

  return (
    <Box
      ref={chartRef}
      id={`backtest-chart-${symbol}`}
      className="backtest-chart"
      data-testid="echarts-container"
      data-symbol={symbol}
      style={{ width: "100%", height: "100%", minHeight: 0 }}
    />
  );
}
