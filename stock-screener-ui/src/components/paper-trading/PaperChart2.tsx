import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  Box,
  Button,
  Text,
  Group,
  Select,
  Autocomplete,
  Flex,
  useMantineColorScheme,
  Checkbox,
  Badge,
  LoadingOverlay,
  Tooltip,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useDebouncedValue } from "@mantine/hooks";
import dayjs from "dayjs";
import {
  getPaperTradingState,
  setChartTimeframe,
  setChartFromDate,
  setShowAllTrades,
  setShowOrbLines,
  setShowPivotLines,
  setShow52wLines,
  setShowEmaLines,
  setSelectedSymbol,
  subscribe,
} from "../../state/paperTrading";
import { fetchPaperChart } from "../../api/paperTrading";
import { searchSymbols } from "../../api/symbols";
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

function ChartLegend({ orbLabel, hasWeek52, hasTrades }: { orbLabel?: string; hasWeek52: boolean; hasTrades: boolean }) {
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

  if (items.length === 0) return null;

  return (
    <Flex gap="sm" justify="center" align="center" wrap="wrap" py={8} data-testid="chart-legend" className="paper-chart-legend" id="chart-legend">
      {items.map((item, i) => (
        <Flex key={i} align="center" gap={4}>
          <Box className={`legend-marker ${item.label.toLowerCase()}`} w={12} h={12} bg={item.color} style={{ borderRadius: item.shape === "circle" ? "50%" : 2 }} />
          <Text size="xs" c="dimmed">{item.label}</Text>
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
      <Box data-testid={icon ? undefined : "chart-placeholder-content"} style={{ textAlign: "center" }}>
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

function SymbolSearch({ onSelect }: { onSelect: (symbol: string) => void }) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [debounced] = useDebouncedValue(search, 300);

  useEffect(() => {
    if (debounced.trim().length < 1) { setOptions([]); return; }
    searchSymbols(debounced, 15).then((results) => {
      setOptions(results.map((r) => ({ value: r.symbol, label: `${r.symbol} — ${r.name}` })));
    });
  }, [debounced]);

  return (
    <Autocomplete
      size="xs"
      placeholder="Search symbol..."
      value={search}
      onChange={setSearch}
      onOptionSubmit={(val) => { onSelect(val); setSearch(""); setOptions([]); }}
      data={options}
      limit={15}
      styles={{ dropdown: { maxHeight: 300 } }}
    />
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

function ChartHeader({ state }: { state: ReturnType<typeof getPaperTradingState> }) {
  const [range, setRange] = useState<[Date | null, Date | null]>([null, null]);

  useEffect(() => {
    if (state.chartFromDate && state.chartData?.date) {
      setRange([new Date(state.chartFromDate), new Date(state.chartData.date)]);
    } else if (!state.chartFromDate && state.chartData?.date && range[0] === null && range[1] === null) {
      // keep range null
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
    let from: Date;
    if (days === -1) {
      from = new Date(0); // Max — all time
    } else {
      from = dayjs().subtract(days, "day").toDate(); // 1D = today, 5D = 4 days ago, etc.
    }
    setRange([from, to]);
    setChartFromDate(null);
    const fd = days === -1 ? undefined : dayjs(from).format("YYYY-MM-DD");
    const cd = dayjs(to).format("YYYY-MM-DD");
    if (state.selectedSymbol) {
      fetchPaperChart(state.selectedSymbol, cd, state.chartTimeframe, state.selectedStrategyId, fd, true);
    }
  }, [state.selectedSymbol, state.chartTimeframe, state.selectedStrategyId]);

  const handleRangeChange = useCallback(
    (r: [Date | null, Date | null]) => {
      setRange(r);
      if (r[0] && r[1] && r[0] > r[1]) return;
      setChartFromDate(null);
      const fd = r[0] ? dayjs(r[0]).format("YYYY-MM-DD") : undefined;
      const cd = r[1] ? dayjs(r[1]).format("YYYY-MM-DD") : state.chartData?.date;
      if (state.selectedSymbol && cd) {
        fetchPaperChart(state.selectedSymbol, cd, state.chartTimeframe, state.selectedStrategyId, fd, true);
      }
    },
    [state.selectedSymbol, state.chartData?.date, state.chartTimeframe, state.selectedStrategyId],
  );

  const handleTimeframeChange = useCallback(
    async (value: string | null) => {
      if (!value) return;
      setRange([null, null]);
      setChartTimeframe(value);
      if (state.selectedSymbol && chartDate) {
        await fetchPaperChart(state.selectedSymbol, chartDate, value, state.selectedStrategyId, fromDate, true);
      }
    },
    [state.selectedSymbol, chartDate, state.selectedStrategyId, fromDate],
  );

  const handleSymbolSelect = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    fetchPaperChart(symbol, dayjs().format("YYYY-MM-DD"), state.chartTimeframe, state.selectedStrategyId, undefined, true);
  }, [state.chartTimeframe, state.selectedStrategyId]);

  return (
    <Flex data-testid="paper-chart-header" className="paper-chart-header" id="chart-header" p="sm" pb={0} direction="column" gap={6} style={{ flex: "0 0 auto" }}>
      <Flex justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap="sm">
          <SymbolSearch onSelect={handleSymbolSelect} />
          {state.chartData?.symbol && (
            <Text fw={600} size="lg">
              {state.chartData.symbol} - {state.chartData.date}
              {state.chartData.actual_date && state.chartData.actual_date !== state.chartData.date && (
                <Text span size="xs" c="dimmed" ml={4}>
                  ({formatDateRange(state.chartData.actual_date)})
                </Text>
              )}
            </Text>
          )}
          <Select
            data-testid="paper-chart-timeframe"
            size="xs"
            value={state.chartTimeframe}
            onChange={handleTimeframeChange}
            data={TIMEFRAME_OPTIONS}
            styles={{ input: { width: 72 } }}
          />
        </Group>
      </Flex>
      <Group gap={4} wrap="wrap">
        {QUICK_RANGES.map((r) => (
          <Button key={r.label} size="compact-xs" variant="subtle" onClick={() => handleQuickRange(r.days)}>
            {r.label}
          </Button>
        ))}
        <DatePickerInput
          type="range"
          size="xs"
          clearable
          style={{ maxWidth: 220, flex: 1 }}
          allowSingleDateInRange
          maxDate={new Date()}
          placeholder="Custom range"
          valueFormat="MMM D"
          value={range}
          onChange={handleRangeChange}
          presets={todayPresets}
        />
      </Group>
      <Group gap="md" wrap="wrap">
        {[
          { label: "All trades", tooltip: "Show all completed trades on chart", key: "showAllTrades" as const, color: undefined as string | undefined, setter: setShowAllTrades, testId: "show-all-trades-checkbox", divider: false },
          { label: "ORB", tooltip: "Opening Range Breakout levels", key: "showOrbLines" as const, color: "blue", setter: setShowOrbLines, testId: "show-orb-lines", divider: true },
          { label: "Pivot", tooltip: "Fibonacci pivot levels", key: "showPivotLines" as const, color: "violet", setter: setShowPivotLines, testId: "show-pivot-lines", divider: true },
          { label: "52W", tooltip: "52-week high/low levels", key: "show52wLines" as const, color: "pink", setter: setShow52wLines, testId: "show-52w-lines", divider: true },
          { label: "EMA", tooltip: "Exponential Moving Averages", key: "showEmaLines" as const, color: "teal", setter: setShowEmaLines, testId: "show-ema-lines", divider: true },
        ].map(({ label, tooltip, key, color, setter, testId, divider }) => (
          <Fragment key={key}>
            {divider && <Text span c="dimmed" size="xs">|</Text>}
            <Tooltip label={tooltip}>
              <Checkbox size="xs" label={label} color={color} checked={state[key]} onChange={(e) => setter(e.currentTarget.checked)} data-testid={testId} />
            </Tooltip>
          </Fragment>
        ))}
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
          <Text size="sm" c="dimmed" mt="xs">{emptyState.subtext}</Text>
        )}
        {emptyState.className === "paper-chart-error" && state.selectedSymbol && (
          <Button size="xs" variant="light" mt="sm" onClick={() =>
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
        />
      )}
    </CompactPanel>
  );
}
