import { useCallback, useMemo, useState } from "react";
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
  SegmentedControl,
} from "@mantine/core";
import dayjs from "dayjs";
import { TradingDatePicker } from "../common/TradingDatePicker";
import {
  getPaperTradingState,
  setChartTimeframe,
  setShowAllTrades,
  setShowOrbLines,
  setShowPivotLines,
  setShow52wLines,
  setShowEmaLines,
  setIntradayOnly,
  subscribe,
} from "../../state/paperTrading";
import { fetchPaperChart } from "../../api/paperTrading";
import { CompactPanel } from "../common/compact";
import { getPnLTextColor, formatPercentage } from "../../utils/ui-helpers";
import { TradingChart } from "../chart/TradingChart";
import { normalizePaper } from "../../utils/chart/normalizePaper";
import type { PaperPosition } from "../../types/paperTrading";
import { TIMEFRAMES } from "../../config/constants";

// Map numeric values to API format: 1 -> "1min", 60 -> "1hour", etc.
const toApiFormat = (val: number): string => {
  if (val === 1) return "1min";
  if (val === 5) return "5min";
  if (val === 15) return "15min";
  if (val === 30) return "30min";
  if (val === 60) return "1hour";
  if (val === 120) return "2hour";
  if (val === 240) return "4hour";
  if (val === 720) return "12hour";
  if (val === 1440) return "1day";
  return `${val}min`;
};

// Select shows label but stores API format value
const TIMEFRAME_OPTIONS = TIMEFRAMES.map((tf) => ({
  value: toApiFormat(tf.value),
  label: tf.label,
}));

// Format date range for display: "2026-03-24 to 2026-04-24" → "Mar 24 - Apr 24"
const formatDateRange = (range: string): string => {
  if (!range.includes(" to ")) return range;
  const [start, end] = range.split(" to ");
  const fmt = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  return `${fmt(start)} - ${fmt(end)}`;
};

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

function ChartLegend({ orbLabel, hasWeek52 }: { orbLabel?: string; hasWeek52: boolean }) {
  const items = [
    { color: "#00FFFF", label: "Entry", shape: "square" as const },
    { color: "#FFFF00", label: "TP", shape: "circle" as const },
    { color: "#FF00FF", label: "SL", shape: "circle" as const },
  ];
  if (orbLabel) items.push({ color: "#2196F3", label: orbLabel, shape: "square" as const });
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
      data-testid="paper-chart-empty"
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

function ChartHeader({ state }: { state: ReturnType<typeof getPaperTradingState> }) {
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const handlePreset = useCallback(
    (label: string, days: number) => {
      setActivePreset(label);
      const from = dayjs().subtract(days, "day").format("YYYY-MM-DD");
      if (state.selectedSymbol && state.chartData?.date) {
        fetchPaperChart(
          state.selectedSymbol,
          state.chartData.date,
          state.chartTimeframe,
          state.selectedStrategyId,
          state.intradayOnly,
          from,
        );
      }
    },
    [
      state.selectedSymbol,
      state.chartData?.date,
      state.chartTimeframe,
      state.selectedStrategyId,
      state.intradayOnly,
    ],
  );

  const handleCustomDate = useCallback(
    (date: string) => {
      setActivePreset(null);
      if (state.selectedSymbol && state.chartData?.date && date) {
        fetchPaperChart(
          state.selectedSymbol,
          state.chartData.date,
          state.chartTimeframe,
          state.selectedStrategyId,
          state.intradayOnly,
          date,
        );
      }
    },
    [
      state.selectedSymbol,
      state.chartData?.date,
      state.chartTimeframe,
      state.selectedStrategyId,
      state.intradayOnly,
    ],
  );

  const handleTimeframeChange = useCallback(
    async (value: string | null) => {
      if (!value) return;
      setChartTimeframe(value);
      if (state.selectedSymbol && state.chartData?.date) {
        const from = activePreset
          ? dayjs()
              .subtract(PRESET_DAYS[activePreset] ?? 7, "day")
              .format("YYYY-MM-DD")
          : undefined;
        await fetchPaperChart(
          state.selectedSymbol,
          state.chartData.date,
          value,
          state.selectedStrategyId,
          state.intradayOnly,
          from,
        );
      }
    },
    [
      state.selectedSymbol,
      state.chartData?.date,
      state.intradayOnly,
      state.selectedStrategyId,
      activePreset,
    ],
  );

  const handleIntradayToggle = useCallback(
    async (checked: boolean) => {
      setIntradayOnly(checked);
      if (state.selectedSymbol && state.chartData?.date) {
        const from = activePreset
          ? dayjs()
              .subtract(PRESET_DAYS[activePreset] ?? 7, "day")
              .format("YYYY-MM-DD")
          : undefined;
        await fetchPaperChart(
          state.selectedSymbol,
          state.chartData.date,
          state.chartTimeframe,
          state.selectedStrategyId,
          checked,
          from,
        );
      }
    },
    [
      state.selectedSymbol,
      state.chartData?.date,
      state.chartTimeframe,
      state.selectedStrategyId,
      activePreset,
    ],
  );

  return (
    <Flex
      data-testid="paper-chart-header"
      className="paper-chart-header"
      id="chart-header"
      p="sm"
      pb={0}
      direction="column"
      gap={6}
      style={{ flex: "0 0 auto" }}
    >
      <Flex justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap="sm">
          <Text fw={600} size="lg">
            {state.chartData?.symbol} - {state.chartData?.date}
            {state.chartData?.actual_date &&
              state.chartData.actual_date !== state.chartData.date && (
                <Text span size="xs" c="dimmed" ml={4}>
                  ({formatDateRange(state.chartData.actual_date)})
                </Text>
              )}
          </Text>
          <Select
            data-testid="paper-chart-timeframe"
            size="xs"
            value={state.chartTimeframe}
            onChange={handleTimeframeChange}
            data={TIMEFRAME_OPTIONS}
            styles={{ input: { width: 72 } }}
          />
        </Group>
        <Group gap={6}>
          <SegmentedControl
            size="xs"
            value={activePreset ?? ""}
            onChange={(v) => {
              const found = PRESETS.find((p) => p.label === v);
              if (found) handlePreset(found.label, found.days);
            }}
            data={[
              { value: "1W", label: "1W" },
              { value: "1M", label: "1M" },
              { value: "3M", label: "3M" },
              { value: "6M", label: "6M" },
              { value: "1Y", label: "1Y" },
            ]}
          />
          <TradingDatePicker
            value=""
            onChange={(v) => handleCustomDate(v)}
            w={130}
            placeholder="Custom"
            size="xs"
          />
        </Group>
      </Flex>
      <Group gap="xs">
        <Switch
          size="xs"
          label="Intraday"
          checked={state.intradayOnly}
          onChange={(e) => handleIntradayToggle(e.currentTarget.checked)}
          data-testid="intraday-switch"
        />
        <Switch
          size="xs"
          label="All trades"
          checked={state.showAllTrades}
          onChange={(e) => setShowAllTrades(e.currentTarget.checked)}
          data-testid="show-all-trades-switch"
        />
        <Badge size="sm" variant="outline" color="gray" style={{ opacity: 0.5 }}>
          |
        </Badge>
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
          styles={{ label: { color: "#E91063" } }}
          data-testid="show-52w-lines"
        />
        <Switch
          size="xs"
          label="EMA"
          checked={state.showEmaLines}
          onChange={(e) => setShowEmaLines(e.currentTarget.checked)}
          styles={{ label: { color: "#10ac84" } }}
          data-testid="show-ema-lines"
        />
        {state.chartData?.current_position && (
          <PositionInfo position={state.chartData.current_position} />
        )}
      </Group>
    </Flex>
  );
}

const PRESETS = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
];

const PRESET_DAYS: Record<string, number> = Object.fromEntries(
  PRESETS.map((p) => [p.label, p.days]),
);

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
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const state = getPaperTradingState();

  useStoreSubscription(subscribe);

  const chartInput = useMemo(() => {
    if (!state.chartData) return null;
    return normalizePaper(
      state.chartData,
      isDark,
      state.selectedTradeId,
      state.showAllTrades,
      state.showOrbLines,
      state.showPivotLines,
      state.show52wLines,
      state.showEmaLines,
    );
  }, [
    state.chartData,
    isDark,
    state.selectedTradeId,
    state.showAllTrades,
    state.showOrbLines,
    state.showPivotLines,
    state.show52wLines,
    state.showEmaLines,
  ]);

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
      style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}
    >
      <ChartHeader state={state} />
      {chartInput && <TradingChart input={chartInput} style={{ flex: 1, minHeight: 0 }} />}
      <ChartLegend
        orbLabel={
          state.chartData?.orb_levels
            ? `ORB (${state.chartData.orb_levels.or_minutes}m)`
            : undefined
        }
        hasWeek52={!!state.chartData?.week52_levels}
      />
    </CompactPanel>
  );
}
