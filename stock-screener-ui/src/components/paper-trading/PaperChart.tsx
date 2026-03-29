import { useEffect, useRef, useCallback } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { Box, Text, Group, Badge, Select, Flex, useMantineColorScheme } from "@mantine/core";
import { getPaperTradingState, setChartTimeframe, subscribe } from "../../state/paperTrading";
import { fetchPaperChart } from "../../api/paperTrading";
import type {
  PaperChartData,
  CandleData,
  PaperTrade,
  PaperPosition,
} from "../../types/paperTrading";
import { theme } from "../../theme";
import { CompactPanel } from "../common/compact";
import { getPnLTextColor, formatPercentage } from "../../utils/ui-helpers";

const TIMEFRAME_OPTIONS = [
  { value: "1min", label: "1m" },
  { value: "5min", label: "5m" },
  { value: "15min", label: "15m" },
  { value: "1hour", label: "1H" },
];

function buildChartOption(data: PaperChartData, isDark: boolean): any {
  const { candles, trades, orb_levels, week52_levels, current_position } = data;
  const fontSizes = theme.fontSizes;

  if (!candles || candles.length === 0) {
    return {};
  }

  const bgColor = isDark ? theme.colors.dark[7] : theme.white;
  const textColor = isDark ? theme.white : theme.colors.gray[8];
  const mutedColor = isDark ? theme.colors.dark[1] : theme.colors.gray[6];
  const borderColor = isDark ? theme.colors.dark[4] : theme.colors.gray[3];
  const splitLineColor = isDark ? theme.colors.dark[5] : theme.colors.gray[2];
  const axisLineColor = isDark ? theme.colors.dark[4] : theme.colors.gray[3];
  const tooltipBg = isDark ? "rgba(26, 27, 30, 0.96)" : "rgba(255, 255, 255, 0.96)";

  const ohlcData = candles.map((c: CandleData) => [c.open, c.close, c.low, c.high]);

  const volumeData = candles.map((c: CandleData, i: number) => [
    i,
    c.volume,
    c.close >= c.open ? 1 : -1,
  ]);

  const times = candles.map((c: CandleData) => {
    const time = c.time.split("T")[1]?.substring(0, 5) || c.time;
    return time;
  });

  const entryMarkers: any[] = [];
  const tpMarkers: any[] = [];
  const slMarkers: any[] = [];
  const eodMarkers: any[] = [];

  const findCandleIndex = (timeStr: string): number => {
    if (!timeStr || candles.length === 0) return -1;

    const parseTimeToMinutes = (str: string): number => {
      const timePart = str.split("T")[1] || str;
      const parts = timePart.split(":");
      if (parts.length >= 2) {
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        return hours * 60 + minutes;
      }
      return -1;
    };

    const targetMinutes = parseTimeToMinutes(timeStr);
    if (targetMinutes < 0) return -1;

    for (let i = 0; i < candles.length; i++) {
      const candleMinutes = parseTimeToMinutes(candles[i].time);
      if (candleMinutes === targetMinutes) {
        return i;
      }
    }

    let closestIdx = 0;
    let minDiff = Infinity;

    for (let i = 0; i < candles.length; i++) {
      const candleMinutes = parseTimeToMinutes(candles[i].time);
      const diff = Math.abs(candleMinutes - targetMinutes);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }

    if (minDiff <= 10) {
      return closestIdx;
    }

    return -1;
  };

  trades.forEach((trade: PaperTrade, _idx: number) => {
    const entryIdx = findCandleIndex(trade.entry_time);
    const exitIdx = findCandleIndex(trade.exit_time);

    if (entryIdx >= 0) {
      entryMarkers.push({
        value: [entryIdx, trade.entry_price],
        itemStyle: { color: "#00FFFF", borderColor: "#FFFFFF", borderWidth: 2 },
        symbol: trade.side === "BUY" ? "triangle" : "triangleRotated",
        symbolSize: 18,
        trade: trade,
      });
    }

    if (exitIdx >= 0) {
      if (trade.exit_reason === "TP") {
        tpMarkers.push({
          value: [exitIdx, trade.exit_price],
          itemStyle: { color: "#FFFF00", borderColor: "#FFFFFF", borderWidth: 2 },
          symbol: "circle",
          symbolSize: 16,
          trade: trade,
        });
      } else if (trade.exit_reason === "SL") {
        slMarkers.push({
          value: [exitIdx, trade.exit_price],
          itemStyle: { color: "#FF00FF", borderColor: "#FFFFFF", borderWidth: 2 },
          symbol: "circle",
          symbolSize: 16,
          trade: trade,
        });
      } else {
        eodMarkers.push({
          value: [exitIdx, trade.exit_price],
          itemStyle: { color: "#FFA500", borderColor: "#FFFFFF", borderWidth: 2 },
          symbol: "diamond",
          symbolSize: 16,
          trade: trade,
        });
      }
    }
  });

  if (current_position) {
    const entryIdx = findCandleIndex(current_position.entry_time);

    if (entryIdx >= 0) {
      entryMarkers.push({
        value: [entryIdx, current_position.entry_price],
        itemStyle: { color: "#00FFFF", borderColor: "#FFFFFF", borderWidth: 3 },
        symbol: current_position.side === "BUY" ? "triangle" : "triangleRotated",
        symbolSize: 22,
        trade: current_position,
        label: {
          show: true,
          formatter: "LIVE",
          position: "top",
          color: textColor,
          fontSize: fontSizes.sm,
        },
      });
    }
  }

  const markLines: any[] = [];

  if (current_position) {
    markLines.push({
      name: "SL",
      yAxis: current_position.stop_loss,
      lineStyle: { color: "#FF00FF", type: "dashed", width: 2 },
      label: { formatter: "SL", position: "end", color: "#FF00FF" },
    });
    markLines.push({
      name: "TP",
      yAxis: current_position.take_profit,
      lineStyle: { color: "#FFFF00", type: "dashed", width: 2 },
      label: { formatter: "TP", position: "end", color: "#FFFF00" },
    });
  }

  if (orb_levels) {
    markLines.push({
      name: "OR High",
      yAxis: orb_levels.or_high,
      lineStyle: { color: "#2196F3", type: "dashed", width: 1 },
      label: { formatter: "OR High", position: "start", color: "#2196F3", fontSize: fontSizes.sm },
    });
    markLines.push({
      name: "OR Low",
      yAxis: orb_levels.or_low,
      lineStyle: { color: "#2196F3", type: "dashed", width: 1 },
      label: { formatter: "OR Low", position: "start", color: "#2196F3", fontSize: fontSizes.sm },
    });
  }

  if (week52_levels) {
    markLines.push({
      name: "52W High",
      yAxis: week52_levels.high_52w,
      lineStyle: { color: "#E91E63", type: "dashed", width: 2 },
      label: { formatter: "52W High", position: "start", color: "#E91E63", fontSize: fontSizes.sm },
    });
    if (week52_levels.low_52w > 0) {
      markLines.push({
        name: "52W Low",
        yAxis: week52_levels.low_52w,
        lineStyle: { color: "#9C27B0", type: "dashed", width: 1 },
        label: {
          formatter: "52W Low",
          position: "start",
          color: "#9C27B0",
          fontSize: fontSizes.sm,
        },
      });
    }
  }

  const formatVolume = (vol: number): string => {
    if (vol >= 1000000) return (vol / 1000000).toFixed(1) + "M";
    if (vol >= 1000) return (vol / 1000).toFixed(1) + "K";
    return vol.toString();
  };

  return {
    backgroundColor: bgColor,
    animation: false,
    legend: {
      data: ["Price", "Entry", "TP Exit", "SL Exit", "Other Exit"],
      bottom: 10,
      textStyle: { color: mutedColor },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      backgroundColor: tooltipBg,
      borderColor: borderColor,
      borderWidth: 1,
      textStyle: { color: textColor, fontSize: fontSizes.sm },
      formatter: function (params: any[]) {
        for (const p of params) {
          if (p.data && p.data.trade) {
            const t = p.data.trade;
            const isPosition = "order_id" in t;

            if (isPosition) {
              const pos = t as PaperPosition;
              const pnlColor = pos.pnl >= 0 ? "#00E676" : "#FF1744";
              return `
                <div style="padding: 6px 8px; fontFamily: fontFamily; font-size: fontSizes.sm; line-height: 1.4;">
                  <div style="color: #00BFFF; font-weight: bold; margin-bottom: 4px;">
                    LIVE POSITION | ${pos.side}
                  </div>
                  <div style="display: flex; gap: 12px; margin-bottom: 2px;">
                    <span>Entry: <b>₹${pos.entry_price.toFixed(2)}</b></span>
                    <span>Current: <b>₹${pos.current_price.toFixed(2)}</b></span>
                    <span>Qty: ${pos.quantity}</span>
                  </div>
                  <div style="display: flex; gap: 12px;">
                    <span style="color: #FF00FF;">SL: ₹${pos.stop_loss.toFixed(2)}</span>
                    <span style="color: #FFFF00;">TP: ₹${pos.take_profit.toFixed(2)}</span>
                  </div>
                  <div style="margin-top: 4px;">
                    <span style="color: ${pnlColor}; font-weight: bold;">
                      P&L: ₹${pos.pnl.toFixed(0)} (${pos.pnl_pct >= 0 ? "+" : ""}${pos.pnl_pct.toFixed(2)}%)
                    </span>
                  </div>
                </div>
              `;
            } else {
              const trade = t as PaperTrade;
              const pnlColor = trade.net_pnl >= 0 ? "#00E676" : "#FF1744";
              const formatTime = (iso: string) => iso.split("T")[1]?.substring(0, 5) || iso;

              return `
                <div style="padding: 6px 8px; fontFamily: fontFamily; font-size: fontSizes.sm; line-height: 1.4;">
                  <div style="color: #00BFFF; font-weight: bold; margin-bottom: 4px;">
                    Trade | ${trade.side} | ${trade.exit_reason}
                  </div>
                  <div style="color: #888; margin-bottom: 4px; font-size: fontSizes.sm;">
                    ${formatTime(trade.entry_time)} → ${formatTime(trade.exit_time)}
                  </div>
                  <div style="display: flex; gap: 12px; margin-bottom: 2px;">
                    <span>Entry: <b>₹${trade.entry_price.toFixed(2)}</b></span>
                    <span>Exit: <b>₹${trade.exit_price.toFixed(2)}</b></span>
                    <span>Qty: ${trade.quantity}</span>
                  </div>
                  <div style="display: flex; gap: 12px;">
                    <span style="color: ${pnlColor}; font-weight: bold;">
                      Net: ₹${trade.net_pnl.toFixed(0)} (${trade.pnl_pct >= 0 ? "+" : ""}${trade.pnl_pct.toFixed(2)}%)
                    </span>
                    <span style="color: #888;">Cost: ₹${trade.costs.toFixed(0)}</span>
                  </div>
                </div>
              `;
            }
          }
        }

        const candle = params.find((p: any) => p.seriesType === "candlestick");
        if (candle) {
          const idx = candle.dataIndex;
          const c = candles[idx];
          if (!c) return "";
          const change = (((c.close - c.open) / c.open) * 100).toFixed(2);
          const changeColor = c.close >= c.open ? "#00E676" : "#FF1744";
          const timeStr = c.time.split("T")[1]?.substring(0, 5) || c.time;

          return `
            <div style="padding: 6px 8px; fontFamily: fontFamily; font-size: fontSizes.sm; line-height: 1.4;">
              <div style="font-weight: bold; margin-bottom: 4px;">${timeStr}</div>
              <div style="display: flex; gap: 12px;">
                <span>O: ₹${c.open.toFixed(2)}</span>
                <span>H: ₹${c.high.toFixed(2)}</span>
                <span>L: ₹${c.low.toFixed(2)}</span>
                <span>C: ₹${c.close.toFixed(2)}</span>
              </div>
              <div style="display: flex; gap: 12px; color: #888;">
                <span style="color: ${changeColor}; font-weight: bold;">${c.close >= c.open ? "+" : ""}${change}%</span>
                <span>Vol: ${formatVolume(c.volume)}</span>
              </div>
            </div>
          `;
        }
        return "";
      },
    },
    axisPointer: {
      link: [{ xAxisIndex: "all" }],
    },
    grid: [
      { left: "8%", right: "3%", top: "5%", height: "60%" },
      { left: "8%", right: "3%", top: "72%", height: "18%" },
    ],
    xAxis: [
      {
        type: "category",
        data: times,
        boundaryGap: true,
        axisLine: { lineStyle: { color: axisLineColor } },
        axisLabel: { color: mutedColor, fontSize: fontSizes.sm },
        splitLine: { show: false },
        min: "dataMin",
        max: "dataMax",
      },
      {
        type: "category",
        gridIndex: 1,
        data: times,
        boundaryGap: true,
        axisLine: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
        min: "dataMin",
        max: "dataMax",
      },
    ],
    yAxis: [
      {
        scale: true,
        axisLine: { lineStyle: { color: axisLineColor } },
        axisLabel: { color: mutedColor, fontSize: fontSizes.sm },
        splitLine: { lineStyle: { color: splitLineColor } },
      },
      {
        scale: true,
        gridIndex: 1,
        axisLine: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
    ],
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: [0, 1],
        start: 0,
        end: 100,
      },
    ],
    series: [
      {
        name: "Price",
        type: "candlestick",
        data: ohlcData,
        itemStyle: {
          color: "#00E676",
          color0: "#FF1744",
          borderColor: "#00E676",
          borderColor0: "#FF1744",
        },
        markLine:
          markLines.length > 0
            ? {
                symbol: ["none", "none"],
                data: markLines,
                label: {
                  color: textColor,
                  fontSize: fontSizes.sm,
                },
              }
            : undefined,
        markArea: orb_levels
          ? {
              data: [
                [
                  {
                    xAxis: times[0],
                    yAxis: orb_levels.or_low,
                    itemStyle: { color: "rgba(33, 150, 243, 0.15)" },
                  },
                  { xAxis: times[Math.min(8, times.length - 1)], yAxis: orb_levels.or_high },
                ],
              ],
            }
          : undefined,
      },
      {
        name: "Entry",
        type: "scatter",
        data: entryMarkers,
        symbolSize: 18,
        z: 10,
      },
      {
        name: "TP Exit",
        type: "scatter",
        data: tpMarkers,
        symbolSize: 16,
        z: 10,
      },
      {
        name: "SL Exit",
        type: "scatter",
        data: slMarkers,
        symbolSize: 16,
        z: 10,
      },
      {
        name: "Other Exit",
        type: "scatter",
        data: eodMarkers,
        symbolSize: 16,
        z: 10,
      },
      {
        name: "Volume",
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumeData,
        itemStyle: {
          color: function (params: any) {
            return params.data[2] === 1 ? "rgba(0, 230, 118, 0.5)" : "rgba(255, 23, 68, 0.5)";
          },
        },
      },
    ],
  };
}

function PositionInfo({ position }: { position: PaperPosition }) {
  const pnlClass = position.pnl >= 0 ? "positive" : "negative";
  const sideIcon = position.side === "BUY" ? "▲" : "▼";

  return (
    <Group
      gap="xs"
      data-testid="position-info"
      className={`position-info paper-position-info ${pnlClass}`}
      id={`position-info-${position.symbol}`}
    >
      <Badge size="sm" variant="light" color={position.side === "BUY" ? "green" : "red"}>
        {sideIcon} {position.side}
      </Badge>
      <Text size="sm" fw={500}>
        {position.quantity} @ ₹{position.entry_price.toFixed(2)}
      </Text>
      <Text size="sm" fw={600} c={getPnLTextColor(position.pnl)}>
        P&L: ₹{position.pnl.toFixed(0)} ({formatPercentage(position.pnl_pct, 2, true)})
      </Text>
    </Group>
  );
}

function ChartLegend({ hasOrb, hasWeek52 }: { hasOrb: boolean; hasWeek52: boolean }) {
  return (
    <Group
      gap="sm"
      data-testid="chart-legend"
      className="paper-chart-legend"
      id="chart-legend"
      style={{ padding: "8px 0" }}
    >
      <Group gap={4}>
        <Box
          className="legend-marker entry"
          style={{
            width: 12,
            height: 12,
            backgroundColor: "#00FFFF",
            borderRadius: 2,
            display: "inline-block",
          }}
        />
        <Text size="sm" c="dimmed">
          Entry
        </Text>
      </Group>
      <Group gap={4}>
        <Box
          className="legend-marker tp"
          style={{
            width: 12,
            height: 12,
            backgroundColor: "#FFFF00",
            borderRadius: "50%",
            display: "inline-block",
          }}
        />
        <Text size="sm" c="dimmed">
          TP
        </Text>
      </Group>
      <Group gap={4}>
        <Box
          className="legend-marker sl"
          style={{
            width: 12,
            height: 12,
            backgroundColor: "#FF00FF",
            borderRadius: "50%",
            display: "inline-block",
          }}
        />
        <Text size="sm" c="dimmed">
          SL
        </Text>
      </Group>
      {hasOrb && (
        <Group gap={4}>
          <Box
            className="legend-marker orb"
            style={{
              width: 12,
              height: 12,
              backgroundColor: "#2196F3",
              borderRadius: 2,
              display: "inline-block",
            }}
          />
          <Text size="sm" c="dimmed">
            OR
          </Text>
        </Group>
      )}
      {hasWeek52 && (
        <Group gap={4}>
          <Box
            className="legend-marker w52"
            style={{
              width: 12,
              height: 12,
              backgroundColor: "#E91E63",
              borderRadius: 2,
              display: "inline-block",
            }}
          />
          <Text size="sm" c="dimmed">
            52W High
          </Text>
        </Group>
      )}
    </Group>
  );
}

function ChartEmptyState({
  className,
  icon,
  children,
}: {
  className: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <CompactPanel
      data-testid="paper-chart-container"
      className={`paper-chart-container ${className}`}
      id="paper-chart"
      style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <Box
        data-testid={icon ? undefined : "chart-placeholder-content"}
        style={{ textAlign: "center" }}
      >
        {icon && (
          <Text size="lg" c="dimmed" mb="sm">
            {icon}
          </Text>
        )}
        {children}
      </Box>
    </CompactPanel>
  );
}

export function PaperChart() {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  const state = getPaperTradingState();

  useStoreSubscription(subscribe);

  useEffect(() => {
    if (!chartRef.current || !state.chartData || !state.selectedSymbol) {
      return;
    }

    const echartsLib = (window as any).echarts;
    if (!echartsLib) {
      console.error("PaperChart: ECharts not loaded");
      return;
    }

    if (chartInstance.current) {
      chartInstance.current.dispose();
    }

    chartInstance.current = echartsLib.init(chartRef.current, isDark ? "dark" : null);

    const option = buildChartOption(state.chartData, isDark);
    chartInstance.current.setOption(option);

    const handleResize = () => {
      chartInstance.current?.resize();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, [state.chartData, state.selectedSymbol, isDark]);

  const handleTimeframeChange = useCallback(
    async (value: string | null) => {
      if (!value) return;
      setChartTimeframe(value);

      if (state.selectedSymbol && state.chartData?.date) {
        await fetchPaperChart(state.selectedSymbol, state.chartData.date, value);
      }
    },
    [state.selectedSymbol, state.chartData?.date],
  );

  if (!state.selectedSymbol) {
    return (
      <ChartEmptyState className="paper-chart-empty">
        <Text c="dimmed">Select a position or trade to view chart</Text>
      </ChartEmptyState>
    );
  }

  if (state.chartLoading) {
    return (
      <ChartEmptyState className="paper-chart-loading">
        <Text c="dimmed">Loading {state.selectedSymbol} chart...</Text>
      </ChartEmptyState>
    );
  }

  if (!state.chartData) {
    return (
      <ChartEmptyState className="paper-chart-error" icon="⚠️">
        <Text c="dimmed">No data available for {state.selectedSymbol}</Text>
        <Text size="sm" c="dimmed" mt="xs">
          Stock data may not be available or symbol is invalid
        </Text>
      </ChartEmptyState>
    );
  }

  if (!state.chartData.candles || state.chartData.candles.length === 0) {
    return (
      <ChartEmptyState className="paper-chart-no-data" icon="⚠️">
        <Text c="dimmed">No candle data for {state.selectedSymbol}</Text>
        <Text size="sm" c="dimmed" mt="xs">
          Market may be closed or data unavailable for this date
        </Text>
      </ChartEmptyState>
    );
  }

  return (
    <CompactPanel
      data-testid="paper-chart-container"
      className="paper-chart-container"
      id="paper-chart"
      h="100%"
      style={{
        padding: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Box
        data-testid="paper-chart-header"
        className="paper-chart-header"
        id="chart-header"
        p="sm"
        pb={0}
        style={{ flex: "0 0 auto" }}
      >
        <Flex justify="space-between" align="center" wrap="wrap" gap="sm">
          <Group gap="sm">
            <Text fw={600} size="lg">
              {state.chartData.symbol} - {state.chartData.date}
            </Text>
            <Select
              data-testid="paper-chart-timeframe"
              size="sm"
              value={state.chartTimeframe}
              onChange={handleTimeframeChange}
              data={TIMEFRAME_OPTIONS}
              styles={{
                input: {
                  width: 70,
                  height: 28,
                },
              }}
            />
          </Group>
          {state.chartData.current_position && (
            <PositionInfo position={state.chartData.current_position} />
          )}
        </Flex>
      </Box>

      <Box
        ref={chartRef}
        data-testid="paper-echarts"
        className="paper-chart-canvas"
        id="echarts-container"
        style={{ flex: 1, width: "100%", minHeight: 0 }}
      />

      <Box
        px="sm"
        pb="sm"
        className="paper-chart-footer"
        id="chart-footer"
        style={{ flex: "0 0 auto" }}
      >
        <ChartLegend
          hasOrb={!!state.chartData.orb_levels}
          hasWeek52={!!state.chartData.week52_levels}
        />
      </Box>
    </CompactPanel>
  );
}
