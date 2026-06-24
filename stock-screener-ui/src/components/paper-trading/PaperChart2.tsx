import { useCallback, useEffect, useMemo, useState } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  Box,
  Button,
  Text,
  Group,
  Select,
  Flex,
  useMantineColorScheme,
  Badge,
  LoadingOverlay,
  ActionIcon,
  Popover,
  Chip,
  Divider,
  Stack,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconDots } from "@tabler/icons-react";
import dayjs from "dayjs";
import {
  getPaperTradingState,
  setChartTimeframe,
  setShowAllTrades,
  setShowOrbLines,
  setShowPivotLines,
  setShow52wLines,
  setShowEmaLines,
  subscribe,
} from "../../state/paperTrading";
import { fetchPaperChart } from "../../api/paperTrading";
import { CompactPanel } from "../common/compact";
import { getPnLTextColor, formatPercentage } from "../../utils/ui-helpers";
import { TradingChart } from "../chart/TradingChart";
import { normalizePaper } from "../../utils/chart/normalizePaper";
import type { PaperPosition } from "../../types/paperTrading";
import { TIMEFRAMES } from "../../config/constants";

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

const TIMEFRAME_OPTIONS = TIMEFRAMES.map((tf) => ({
  value: toApiFormat(tf.value),
  label: tf.label,
}));


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

function ChartLegend({ orbLabel, hasWeek52, hasTrades, position }: { orbLabel?: string; hasWeek52: boolean; hasTrades: boolean; position?: PaperPosition }) {
  const items: { color: string; label: string; shape: "square" | "circle" }[] = [];
  if (hasTrades) {
    items.push(
      { color: "#00FFFF", label: "Entry", shape: "square" },
      { color: "#FFFF00", label: "TP", shape: "circle" },
      { color: "#FF00FF", label: "SL", shape: "circle" },
    );
  }
  if (orbLabel) items.push({ color: "#2196F3", label: orbLabel, shape: "square" });
  if (hasWeek52) items.push({ color: "#E91E63", label: "52W High", shape: "square" });

  if (items.length === 0 && !position) return null;

  return (
    <Flex gap="xs" justify="center" align="center" wrap="wrap" py={2} px="xs" data-testid="chart-legend" className="paper-chart-legend" id="chart-legend">
      {items.map((item, i) => (
        <Flex key={i} align="center" gap={2}>
          <Box className={`legend-marker ${item.label.toLowerCase()}`} w={8} h={8} bg={item.color} style={{ borderRadius: item.shape === "circle" ? "50%" : 2 }} />
          <Text size="xs" c="dimmed">{item.label}</Text>
        </Flex>
      ))}
      {position && <PositionInfo position={position} />}
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
      <Box data-testid={icon ? undefined : "chart-placeholder-content"} style={{ textAlign: "center" }}>
        {icon && (
          <Text size="lg" c="dimmed" mb="xs">
            {icon}
          </Text>
        )}
        {children}
      </Box>
    </CompactPanel>
  );
}

const QUICK_RANGES = [
  { label: "1D", days: 0 },
  { label: "5D", days: 4 },
  { label: "1M", days: 29 },
  { label: "3M", days: 89 },
  { label: "6M", days: 179 },
  { label: "1Y", days: 364 },
  { label: "Max", days: -1 },
] as const;

const OVERLAY_ITEMS = [
  { label: "All", key: "showAllTrades" as const, setter: setShowAllTrades },
  { label: "ORB", key: "showOrbLines" as const, setter: setShowOrbLines },
  { label: "Pivot", key: "showPivotLines" as const, setter: setShowPivotLines },
  { label: "52W", key: "show52wLines" as const, setter: setShow52wLines },
  { label: "EMA", key: "showEmaLines" as const, setter: setShowEmaLines },
] as const;

function ChartHeader({ state }: { state: ReturnType<typeof getPaperTradingState> }) {
  const [range, setRange] = useState<[Date | null, Date | null]>([null, null]);
  const [popoverOpened, setPopoverOpened] = useState(false);

  useEffect(() => {
    if (state.chartFromDate && state.chartData?.date) {
      setRange([new Date(state.chartFromDate), new Date(state.chartData.date)]);
    }
  }, [state.chartFromDate, state.chartData?.date]);

  const todayPresets = useMemo(() => [
    { value: [dayjs().toDate(), dayjs().toDate()], label: "Single day" },
    { value: [dayjs().subtract(1, "day").toDate(), dayjs().toDate()], label: "Last 2 days" },
    { value: [dayjs().subtract(7, "day").toDate(), dayjs().toDate()], label: "Last 7 days" },
    { value: [dayjs().subtract(30, "day").toDate(), dayjs().toDate()], label: "Last 30 days" },
    { value: [dayjs().subtract(90, "day").toDate(), dayjs().toDate()], label: "Last 3 months" },
    { value: [dayjs().startOf("year").toDate(), dayjs().toDate()], label: "Year to date" },
  ], []);

  const chartDate = range[1] ? dayjs(range[1]).format("YYYY-MM-DD") : state.chartData?.date;
  const fromDate = range[0] ? dayjs(range[0]).format("YYYY-MM-DD") : undefined;

  const handleQuickRange = useCallback((days: number) => {
    const to = new Date();
    const from = days === -1 ? new Date(0) : dayjs().subtract(days, "day").toDate();
    setRange([from, to]);
    setPopoverOpened(false);
    const fd = days === -1 ? undefined : dayjs(from).format("YYYY-MM-DD");
    const cd = dayjs(to).format("YYYY-MM-DD");
    const s = getPaperTradingState();
    if (s.selectedSymbol) {
      fetchPaperChart(s.selectedSymbol, cd, s.chartTimeframe, s.selectedStrategyId, fd, true);
    }
  }, []);

  const handleRangeChange = useCallback(
    (r: [Date | null, Date | null]) => {
      setRange(r);
      if (r[0] && r[1] && r[0] > r[1]) return;
      const fd = r[0] ? dayjs(r[0]).format("YYYY-MM-DD") : undefined;
      const s = getPaperTradingState();
      const cd = r[1] ? dayjs(r[1]).format("YYYY-MM-DD") : s.chartData?.date;
      if (s.selectedSymbol && cd) {
        fetchPaperChart(s.selectedSymbol, cd, s.chartTimeframe, s.selectedStrategyId, fd, true);
      }
      if (r[0] && r[1]) setPopoverOpened(false);
    },
    [],
  );

  const handleTimeframeChange = useCallback(
    async (value: string | null) => {
      if (!value) return;
      setChartTimeframe(value);
      const s = getPaperTradingState();
      const cd = s.chartData?.date;
      if (s.selectedSymbol && cd) {
        await fetchPaperChart(s.selectedSymbol, cd, value, s.selectedStrategyId, s.chartFromDate || undefined, true);
      }
    },
    [],
  );

  const shortDate = (() => {
    const d = state.chartData?.actual_date || state.chartData?.date;
    if (!d) return "";
    if (d.includes(" to ")) {
      const [start, end] = d.split(" to ");
      const fmt = (s: string) => dayjs(s).format("MMM D");
      return `${fmt(start)} - ${fmt(end)}`;
    }
    return dayjs(d).format("MMM D");
  })();

  const hasActiveOverlays = OVERLAY_ITEMS.some(({ key }) => state[key]);

  return (
    <Flex
      data-testid="paper-chart-header"
      className="paper-chart-header"
      id="chart-header"
      align="center"
      gap="xs"
      p={4}
      pb={2}
      style={{ flex: "0 0 auto" }}
    >
      {state.chartData?.symbol && (
        <Text fw={600} size="xs" truncate>
          {state.chartData.symbol}
          {shortDate && <Text span size="xs" c="dimmed" fw={400} ml={4}>{shortDate}</Text>}
        </Text>
      )}

      <Select
        data-testid="paper-chart-timeframe"
        size="xs"
        value={state.chartTimeframe}
        onChange={handleTimeframeChange}
        data={fromDate ? TIMEFRAME_OPTIONS : TIMEFRAME_OPTIONS.filter((tf) => tf.value !== "12hour" && tf.value !== "1day")}
        styles={{ input: { width: 64, minHeight: 26 } }}
      />

      <DatePickerInput
        type="range"
        size="xs"
        clearable
        allowSingleDateInRange
        maxDate={new Date()}
        placeholder="Range"
        valueFormat="MMM D"
        value={range}
        onChange={handleRangeChange}
        presets={todayPresets}
        styles={{ input: { width: fromDate ? 160 : 90, minHeight: 26 } }}
      />

      <Popover
        width={260}
        position="bottom-end"
        shadow="md"
        withArrow
        opened={popoverOpened}
        onChange={setPopoverOpened}
      >
        <Popover.Target>
          <ActionIcon
            size="sm"
            variant={hasActiveOverlays ? "light" : "subtle"}
            color={hasActiveOverlays ? "blue" : "gray"}
            data-testid="chart-more-button"
            onClick={() => setPopoverOpened((o) => !o)}
          >
            <IconDots size={16} />
          </ActionIcon>
        </Popover.Target>
        <Popover.Dropdown p="xs">
          <Stack gap="xs">
            <Text size="xs" fw={500} c="dimmed">Range</Text>
            <Group gap={4}>
              {QUICK_RANGES.map((r) => (
                <Button
                  key={r.label}
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => handleQuickRange(r.days)}
                >
                  {r.label}
                </Button>
              ))}
            </Group>

            <Divider my={1} />

            <Text size="xs" fw={500} c="dimmed">Overlays</Text>
            <Group gap={4}>
              {OVERLAY_ITEMS.map(({ label, key, setter }) => (
                <Box key={key} data-testid={`overlay-${label.toLowerCase()}`}>
                  <Chip
                    size="xs"
                    variant="light"
                    radius="sm"
                    checked={state[key]}
                    onChange={(checked) => setter(checked)}
                  >
                    {label}
                  </Chip>
                </Box>
              ))}
            </Group>
          </Stack>
        </Popover.Dropdown>
      </Popover>
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
    state.chartData, isDark, state.selectedTradeId,
    state.showAllTrades, state.showOrbLines, state.showPivotLines,
    state.show52wLines, state.showEmaLines,
  ]);

  const emptyState = getEmptyState(state);
  if (emptyState) {
    return (
      <ChartEmptyState className={emptyState.className} icon={emptyState.icon}>
        <Text c="dimmed">{emptyState.text}</Text>
        {emptyState.subtext && (
          <Text size="sm" c="dimmed" mt={2}>{emptyState.subtext}</Text>
        )}
        {emptyState.className === "paper-chart-error" && state.selectedSymbol && (
          <Button size="xs" variant="light" mt="xs" onClick={() =>
            fetchPaperChart(state.selectedSymbol, state.chartData?.date || dayjs().format("YYYY-MM-DD"), state.chartTimeframe, state.selectedStrategyId, undefined, true)
          }>
            Retry
          </Button>
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
      style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}
    >
      <ChartHeader state={state} />
      <Box style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
        <LoadingOverlay visible={state.chartLoading} zIndex={10} overlayProps={{ radius: "sm", blur: 1 }} />
        {chartInput ? (
          <TradingChart input={chartInput} style={{ flex: 1, minHeight: 0 }} />
        ) : (
          <ChartEmptyState className="paper-chart-loading" icon="⏳">
            <Text c="dimmed">
              {state.chartLoading ? `Loading ${state.selectedSymbol} chart...` : "No data"}
            </Text>
          </ChartEmptyState>
        )}
      </Box>
      {state.chartData && (
        <ChartLegend
          orbLabel={state.chartData?.orb_levels ? `ORB (${state.chartData.orb_levels.or_minutes}m)` : undefined}
          hasWeek52={!!state.chartData?.week52_levels}
          hasTrades={!!state.chartData?.trades?.length}
          position={state.chartData?.current_position}
        />
      )}
    </CompactPanel>
  );
}
