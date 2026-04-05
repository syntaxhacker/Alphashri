import { useEffect, useRef, useCallback } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  Box,
  Text,
  Group,
  Badge,
  Select,
  Flex,
  useMantineColorScheme,
  Switch,
} from "@mantine/core";
import {
  getPaperTradingState,
  setChartTimeframe,
  setShowAllTrades,
  setShowOrbLines,
  setShowPivotLines,
  setShow52wLines,
  subscribe,
  setError,
} from "../../state/paperTrading";
import { fetchPaperChart } from "../../api/paperTrading";
import { CompactPanel } from "../common/compact";
import { getPnLTextColor, formatPercentage } from "../../utils/ui-helpers";
import { buildChartOption, TIMEFRAME_OPTIONS } from "./chartOptions";
import type { PaperPosition } from "../../types/paperTrading";

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
  const items = [
    { color: "#00FFFF", label: "Entry", shape: "square" as const },
    { color: "#FFFF00", label: "TP", shape: "circle" as const },
    { color: "#FF00FF", label: "SL", shape: "circle" as const },
  ];
  if (hasOrb) items.push({ color: "#2196F3", label: "OR", shape: "square" as const });
  if (hasWeek52) items.push({ color: "#E91E63", label: "52W High", shape: "square" as const });

  return (
    <Flex
      gap="sm"
      justify="center"
      align="center"
      wrap="wrap"
      py={8}
      data-testid="chart-legend"
      className="paper-chart-legend"
      id="chart-legend"
    >
      {items.map((item, i) => (
        <Flex key={i} align="center" gap={4}>
          <Box
            className={`legend-marker ${item.label.toLowerCase()}`}
            w={12}
            h={12}
            bg={item.color}
            style={{ borderRadius: item.shape === "circle" ? "50%" : 2 }}
          />
          <Text size="xs" c="dimmed">
            {item.label}
          </Text>
        </Flex>
      ))}
    </Flex>
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

function useEChart(
  chartRef: React.RefObject<HTMLDivElement | null>,
  state: ReturnType<typeof getPaperTradingState>,
  isDark: boolean,
) {
  const chartInstance = useRef<any>(null);

  useEffect(() => {
    if (!chartRef.current || !state.chartData || !state.selectedSymbol) return;
    const echartsLib = (window as any).echarts;
    if (!echartsLib) {
      setError("PaperChart: ECharts not loaded");
      return;
    }
    if (chartInstance.current) chartInstance.current.dispose();
    chartInstance.current = echartsLib.init(chartRef.current, isDark ? "dark" : null);
    chartInstance.current.setOption(
      buildChartOption(state.chartData, isDark, state.selectedTradeId, state.showAllTrades, state.showOrbLines, state.showPivotLines, state.show52wLines),
    );
    const handleResize = () => chartInstance.current?.resize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, [
    state.chartData,
    state.selectedSymbol,
    state.selectedTradeId,
    state.showAllTrades,
    state.showOrbLines,
    state.showPivotLines,
    state.show52wLines,
    isDark,
    chartRef,
  ]);
}

function ChartHeader({ state }: { state: ReturnType<typeof getPaperTradingState> }) {
  const handleTimeframeChange = useCallback(
    async (value: string | null) => {
      if (!value) return;
      setChartTimeframe(value);
      if (state.selectedSymbol && state.chartData?.date)
        await fetchPaperChart(state.selectedSymbol, state.chartData.date, value);
    },
    [state.selectedSymbol, state.chartData?.date],
  );

  return (
    <Flex
      data-testid="paper-chart-header"
      className="paper-chart-header"
      id="chart-header"
      p="sm"
      pb={0}
      justify="space-between"
      align="center"
      wrap="wrap"
      gap="sm"
      style={{ flex: "0 0 auto" }}
    >
      <Group gap="sm">
        <Text fw={600} size="lg">
          {state.chartData?.symbol} - {state.chartData?.date}
        </Text>
        <Select
          data-testid="paper-chart-timeframe"
          size="sm"
          value={state.chartTimeframe}
          onChange={handleTimeframeChange}
          data={TIMEFRAME_OPTIONS}
          styles={{ input: { width: 70, height: 28 } }}
        />
      </Group>
      <Group gap="sm">
        <Switch
          size="xs"
          label="All trades"
          checked={state.showAllTrades}
          onChange={(e) => setShowAllTrades(e.currentTarget.checked)}
          data-testid="show-all-trades-switch"
        />
        <Switch
          size="xs"
          label="ORB"
          checked={state.showOrbLines}
          onChange={(e) => setShowOrbLines(e.currentTarget.checked)}
          styles={{ label: { color: "#2196F3" } }}
          data-testid="show-orb-lines"
        />
        <Switch
          size="xs"
          label="Pivot"
          checked={state.showPivotLines}
          onChange={(e) => setShowPivotLines(e.currentTarget.checked)}
          styles={{ label: { color: "#AB47BC" } }}
          data-testid="show-pivot-lines"
        />
        <Switch
          size="xs"
          label="52W"
          checked={state.show52wLines}
          onChange={(e) => setShow52wLines(e.currentTarget.checked)}
          styles={{ label: { color: "#E91E63" } }}
          data-testid="show-52w-lines"
        />
        {state.chartData?.current_position && (
          <PositionInfo position={state.chartData.current_position} />
        )}
      </Group>
    </Flex>
  );
}

function getEmptyState(
  state: ReturnType<typeof getPaperTradingState>,
): { className: string; icon?: string; text: string; subtext?: string } | null {
  if (!state.selectedSymbol)
    return { className: "paper-chart-empty", text: "Select a position or trade to view chart" };
  if (state.chartLoading)
    return { className: "paper-chart-loading", text: `Loading ${state.selectedSymbol} chart...` };
  if (!state.chartData)
    return {
      className: "paper-chart-error",
      icon: "⚠️",
      text: `No data available for ${state.selectedSymbol}`,
      subtext: "Stock data may not be available or symbol is invalid",
    };
  if (!state.chartData.candles || state.chartData.candles.length === 0)
    return {
      className: "paper-chart-no-data",
      icon: "⚠️",
      text: `No candle data for ${state.selectedSymbol}`,
      subtext: "Market may be closed or data unavailable for this date",
    };
  return null;
}

export function PaperChart() {
  const chartRef = useRef<HTMLDivElement>(null);
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const state = getPaperTradingState();

  useStoreSubscription(subscribe);
  useEChart(chartRef, state, isDark);

  const emptyState = getEmptyState(state);
  if (emptyState) {
    return (
      <ChartEmptyState className={emptyState.className} icon={emptyState.icon}>
        <Text c="dimmed">{emptyState.text}</Text>
        {emptyState.subtext && (
          <Text size="sm" c="dimmed" mt="xs">
            {emptyState.subtext}
          </Text>
        )}
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
      <ChartHeader state={state} />
      <Box
        ref={chartRef}
        data-testid="paper-echarts"
        className="paper-chart-canvas"
        id="echarts-container"
        style={{ flex: 1, width: "100%", minHeight: 0 }}
      />
      <Flex
        px="sm"
        pb="sm"
        className="paper-chart-footer"
        id="chart-footer"
        justify="center"
        align="center"
        gap="xs"
        style={{ flex: "0 0 auto" }}
      >
        <ChartLegend
          hasOrb={!!state.chartData?.orb_levels}
          hasWeek52={!!state.chartData?.week52_levels}
        />
      </Flex>
    </CompactPanel>
  );
}
