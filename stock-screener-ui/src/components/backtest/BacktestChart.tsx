import { useEffect, useRef } from "react";
import { Box, Text, useMantineColorScheme } from "@mantine/core";
import type { SymbolChartData, ChartTrade } from "../../types/backtest";
import type { MarketHoliday } from "../../types/holidays";
import { theme } from "../../config/theme";
import { normalizeTime } from "../../utils/ui-helpers";
import { buildHighlightMarkers, buildHighlightLevelSeries } from "../../utils/chartUtils";
import { buildChartOption } from "./buildBacktestChartOption";

const chartInstances = new Map<string, any>();

interface BacktestChartProps {
  symbol: string;
  chartData: SymbolChartData | null | undefined;
  isLoading?: boolean;
  onTradeClick?: (tradeId: number) => void;
  holidays?: MarketHoliday[];
}

function findCandleIdx(
  marker: ChartTrade,
  candleTimeMap: Map<string, number>,
  candleDateMap: Map<string, number>,
): number | undefined {
  if (marker.candle_idx !== undefined) return marker.candle_idx;
  const entryTime = normalizeTime(marker.time);
  let idx = candleTimeMap.get(entryTime);
  if (idx === undefined && marker.date) {
    idx = candleDateMap.get(marker.date);
  }
  return idx;
}

function computeZoomRange(
  chartData: SymbolChartData,
  entryMarker: ChartTrade,
  exitMarker: ChartTrade | undefined,
  entryIdx: number,
  exitIdx: number | undefined,
) {
  const totalCandles = chartData.candles.length;
  const entryDate = entryMarker.date || normalizeTime(entryMarker.time).split("T")[0];
  const exitDate =
    exitMarker?.date || (exitMarker ? normalizeTime(exitMarker.time).split("T")[0] : entryDate);
  const isSameDay = entryDate === exitDate;
  const resolvedExitIdx = exitIdx ?? entryIdx;

  let startIdx: number;
  let endIdx: number;

  if (isSameDay) {
    const dayIndices = chartData.candles
      .map((c, idx) => ({ date: c.date, idx }))
      .filter((item) => item.date === entryDate)
      .map((item) => item.idx);

    if (dayIndices.length > 0) {
      startIdx = dayIndices[0];
      endIdx = dayIndices[dayIndices.length - 1];
    } else {
      const padding = 5;
      startIdx = Math.max(0, entryIdx - padding);
      endIdx = Math.min(totalCandles - 1, resolvedExitIdx + padding);
    }
  } else {
    const padding = 3;
    startIdx = Math.max(0, entryIdx - padding);
    endIdx = Math.min(totalCandles - 1, resolvedExitIdx + padding);
  }

  return { startIdx, endIdx, totalCandles, entryDate, resolvedExitIdx, isSameDay };
}

function applyZoomToChart(chart: any, startIdx: number, endIdx: number, totalCandles: number) {
  const startPercent = (startIdx / totalCandles) * 100;
  const endPercent = ((endIdx + 1) / totalCandles) * 100;
  chart.dispatchAction({
    type: "dataZoom",
    dataZoomIndex: 0,
    start: startPercent,
    end: endPercent,
  });
  chart.dispatchAction({
    type: "dataZoom",
    dataZoomIndex: 1,
    start: startPercent,
    end: endPercent,
  });
}

function applyHighlightOnChart(
  chart: any,
  chartData: SymbolChartData,
  entryMarker: ChartTrade,
  exitMarker: ChartTrade | undefined,
  entryIdx: number,
  resolvedExitIdx: number,
  entryDate: string,
  isSameDay: boolean,
  tradeIndex: number,
  fontSizes: Record<string, number>,
) {
  if (!selectedTrade || !entryDate) return;
  const { highlightEntryMarker, highlightExitMarker } = buildHighlightMarkers(
    entryMarker,
    exitMarker,
    entryIdx,
    resolvedExitIdx,
    tradeIndex,
    fontSizes,
  );
  const levelSeries = buildHighlightLevelSeries(
    chartData.candles,
    entryDate,
    entryIdx,
    resolvedExitIdx,
    selectedTrade,
    isSameDay,
    fontSizes,
  );
  const highlightSeries = [
    ...levelSeries,
    {
      id: "highlight-entry",
      name: "Selected Entry",
      type: "scatter",
      data: [highlightEntryMarker],
      symbolSize: 32,
      z: 25,
      animation: true,
      animationDuration: 200,
    },
    ...(highlightExitMarker
      ? [
          {
            id: "highlight-exit",
            name: "Selected Exit",
            type: "scatter",
            data: [highlightExitMarker],
            symbolSize: 28,
            z: 25,
            animation: true,
            animationDuration: 200,
          },
        ]
      : []),
  ];
  chart.setOption({ series: highlightSeries });
  setTimeout(() => {
    chart.setOption({
      series: [
        { id: "highlight-entry", data: [] },
        { id: "highlight-exit", data: [] },
        { id: "trade-connect-line", data: [] },
      ],
    });
  }, 5000);
}

export function zoomToTrade(
  symbol: string,
  tradeIndex: number,
  chartData: SymbolChartData | undefined,
) {
  if (!chartData) return;

  const fontSizes = theme.fontSizes;
  const chart = chartInstances.get(symbol);
  if (!chart) return;

  const entryMarker = chartData.trades.find(
    (t) => t.type === "entry" && t.trade_id === tradeIndex + 1,
  );
  const exitMarker = chartData.trades.find(
    (t) => t.type === "exit" && t.trade_id === tradeIndex + 1,
  );
  if (!entryMarker) return;

  const candleTimeMap = new Map(chartData.candles.map((c, i) => [normalizeTime(c.time), i]));
  const candleDateMap = new Map<string, number>();
  chartData.candles.forEach((c, i) => {
    if (c.date) candleDateMap.set(c.date, i);
    if (c.date_raw) candleDateMap.set(c.date_raw!, i);
  });

  const entryIdx = findCandleIdx(entryMarker, candleTimeMap, candleDateMap);
  const exitIdx = exitMarker ? findCandleIdx(exitMarker, candleTimeMap, candleDateMap) : undefined;
  if (entryIdx === undefined) return;

  const { startIdx, endIdx, totalCandles, entryDate, resolvedExitIdx, isSameDay } =
    computeZoomRange(chartData, entryMarker, exitMarker, entryIdx, exitIdx);

  applyZoomToChart(chart, startIdx, endIdx, totalCandles);
  applyHighlightOnChart(
    chart,
    chartData,
    entryMarker,
    exitMarker,
    entryIdx,
    resolvedExitIdx,
    entryDate,
    isSameDay,
    tradeIndex,
    fontSizes,
  );
}

export function BacktestChart({
  symbol,
  chartData,
  isLoading,
  onTradeClick,
  holidays,
}: BacktestChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  useEffect(() => {
    if (!chartRef.current || !chartData) return;

    const echartsLib = (window as any).echarts;
    if (!echartsLib) {
      console.error("BacktestChart: ECharts not loaded");
      return;
    }

    if (chartInstance.current) {
      chartInstance.current.dispose();
    }

    chartInstance.current = echartsLib.init(chartRef.current, isDark ? "dark" : null);
    chartInstances.set(symbol, chartInstance.current);

    const option = buildChartOption(chartData, isDark, holidays);
    chartInstance.current.setOption(option);
    chartInstance.current.resize();

    if (onTradeClick) {
      chartInstance.current.on("click", (params: any) => {
        if (params.componentType === "series" && params.seriesType === "scatter") {
          const data = params.data;
          if (data && data.trade_id !== undefined) {
            onTradeClick(data.trade_id - 1);
          }
        }
      });
    }

    const handleResize = () => {
      chartInstance.current?.resize();
    };
    window.addEventListener("resize", handleResize);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            chartInstance.current?.resize();
          })
        : null;

    resizeObserver?.observe(chartRef.current);

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
      chartInstance.current?.dispose();
      chartInstances.delete(symbol);
      chartInstance.current = null;
    };
  }, [chartData, onTradeClick, symbol, isDark, holidays]);

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
