import { useCallback, useEffect, useMemo, useState } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  Box,
  Button,
  Text,
  Group,
  Select,
  Flex,
  useColorScheme,
  Badge,
  LoadingOverlay,
  ActionIcon,
  Popover,
  PopoverTarget,
  PopoverDropdown,
  Chip,
  Divider,
  Stack,
  DatePicker,
} from "@/ui";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Toolbar from "@mui/material/Toolbar";
import { IconDots } from "@tabler/icons-react";
import dayjs from "dayjs";
import {
  getPaperTradingState,
  setChartTimeframe,
  setChartTimeframeHistory,
  setChartTimeframeLive,
  setShowAllTrades,
  setShowOrbLines,
  setShowPivotLines,
  setShow52wLines,
  setShowEmaLines,
  subscribe,
} from "../../state/paperTrading";
import { fetchPaperChart } from "../../api/paperTrading";
import { getPnLTextColor, formatPercentage } from "../../utils/ui-helpers";
import { TradingChart } from "../chart/TradingChart";
import { TradingViewChart } from "../chart/TradingViewChart";
import { normalizePaper } from "../../utils/chart/normalizePaper";
import type { PaperPosition } from "../../types/paperTrading";
import { TIMEFRAMES } from "../../config/constants";
import { PRIMARY, POSITIVE, NEGATIVE, PIVOT_OR_HIGH, PIVOT_52W_HIGH, PIVOT_PP, INDICATOR_BLUE_A } from "@/ui/palette";
import { withAlpha } from "@/utils/color";

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
      id={`position-info-${position.symbol}`}
    >
      <Badge size="sm" variant="filled" color={position.side === "BUY" ? "success" : "error"}>
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
      { color: PRIMARY, label: "Entry", shape: "square" },
      { color: POSITIVE, label: "TP", shape: "circle" },
      { color: NEGATIVE, label: "SL", shape: "circle" },
    );
  }
  if (orbLabel) items.push({ color: PIVOT_OR_HIGH, label: orbLabel, shape: "square" });
  if (hasWeek52) items.push({ color: PIVOT_52W_HIGH, label: "52W High", shape: "square" });

  if (items.length === 0 && !position) return null;

  return (
    <Flex className="paper-chart-legend" gap="xs" justify="center" align="center" wrap="wrap" py={1} px={1} data-testid="chart-legend" id="chart-legend">
      {items.map((item, i) => (
        <Flex key={i} className="paper-chart-legend-item" id={`paper-chart-legend-${item.label.toLowerCase().replace(/\s+/g, "-")}`} align="center" gap={1}>
          <Box className="paper-chart-legend-swatch" w={8} h={8} bg={item.color} sx={{ borderRadius: item.shape === "circle" ? "50%" : 2 }} />
          <Text className="paper-chart-legend-label" size="xs" c="dimmed">{item.label}</Text>
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
    <Card className={`paper-chart-empty ${className}`} elevation={0} data-testid="paper-chart-empty" id="paper-chart" sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <CardContent className="paper-chart-empty-content" sx={{ textAlign: "center" }}>
        {icon && (
          <Text className="paper-chart-empty-icon" size="lg" c="dimmed" mb="xs">
            {icon}
          </Text>
        )}
        {icon ? children : <Box data-testid="chart-placeholder-content">{children}</Box>}
      </CardContent>
    </Card>
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
  { label: "All", key: "showAllTrades" as const, setter: setShowAllTrades, color: PRIMARY },
  { label: "ORB", key: "showOrbLines" as const, setter: setShowOrbLines, color: PIVOT_OR_HIGH },
  { label: "Pivot", key: "showPivotLines" as const, setter: setShowPivotLines, color: PIVOT_PP },
  { label: "52W", key: "show52wLines" as const, setter: setShow52wLines, color: PIVOT_52W_HIGH },
  { label: "EMA", key: "showEmaLines" as const, setter: setShowEmaLines, color: INDICATOR_BLUE_A },
] as const;

function ChartHeader({ state }: { state: ReturnType<typeof getPaperTradingState> }) {
  const [range, setRange] = useState<[Date | null, Date | null]>([null, null]);
  const [popoverOpened, setPopoverOpened] = useState(false);

  useEffect(() => {
    if (state.chartFromDate && state.chartData?.date) {
      setRange([new Date(state.chartFromDate), new Date(state.chartData.date)]);
    }
  }, [state.chartFromDate, state.chartData?.date]);

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
      if (!r) return;
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
      // Persist the user's choice per view so it survives tab switches.
      if (s.currentView === "history") setChartTimeframeHistory(value);
      else if (s.currentView === "live") setChartTimeframeLive(value);
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
    <Toolbar
      disableGutters
      sx={{
        minHeight: 48,
        px: 1,
        py: 0.5,
        gap: 1,
        alignItems: "center",
        flex: "0 0 auto",
        flexWrap: "nowrap",
      }}
      data-testid="paper-chart-header"
      id="chart-header"
    >
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.75, minWidth: 0, flexShrink: 1, mr: 1 }}>
        {state.chartData?.symbol && (
          <Text fw={600} size="xs" truncate sx={{ minWidth: 0 }}>
            {state.chartData.symbol}
          </Text>
        )}
        {shortDate && (
          <Text size="xs" c="dimmed" fw={400} sx={{ whiteSpace: "nowrap" }}>
            · {shortDate}
          </Text>
        )}
      </Box>

      <Select
        data-testid="chart-timeframe-select"
        size="xs"
        value={state.chartTimeframe}
        onChange={handleTimeframeChange}
        data={fromDate ? TIMEFRAME_OPTIONS : TIMEFRAME_OPTIONS.filter((tf) => tf.value !== "12hour" && tf.value !== "1day")}
        style={{ width: 84, minWidth: 84, flex: "0 0 auto" }}
      />

      <DatePicker
        size="xs"
        clearable
        maxDate={new Date()}
        placeholder="From"
        valueFormat="MMM D"
        value={range[0]}
        onChange={(d) => handleRangeChange([d, range[1]])}
        data-testid="chart-date-range-from"
        style={{ width: 150, flex: "0 0 auto" }}
      />

      <DatePicker
        size="xs"
        clearable
        maxDate={new Date()}
        valueFormat="MMM D"
        placeholder="To"
        value={range[1]}
        onChange={(d) => handleRangeChange([range[0], d])}
        data-testid="chart-date-range"
        style={{ width: 150, flex: "0 0 auto" }}
      />

      <Box sx={{ flex: 1 }} />

      <Popover
        width={260}
        position="bottom-end"
        shadow="md"
        withArrow
        opened={popoverOpened}
        onChange={setPopoverOpened}
        onClose={() => setPopoverOpened(false)}
      >
        <PopoverTarget>
          <ActionIcon
            size="sm"
            variant={hasActiveOverlays ? "filled" : "subtle"}
            color={hasActiveOverlays ? "primary" : "secondary"}
            data-testid="chart-more-button"
          >
            <IconDots size={16} />
          </ActionIcon>
        </PopoverTarget>
        <PopoverDropdown p="xs">
          <Stack spacing={1}>
            <Group gap="xs">
              <Box w={3} h={14} sx={(theme) => ({ borderRadius: 2, backgroundColor: theme.palette.primary.main })} />
              <Text size="xs" fw={600}>Range</Text>
            </Group>
            <Group gap={1}>
              {QUICK_RANGES.map((r) => (
                <Button
                  key={r.label}
                  size="compact-xs"
                  variant="light"
                  color="primary"
                  onClick={() => handleQuickRange(r.days)}
                >
                  {r.label}
                </Button>
              ))}
            </Group>

            <Divider my={1} />

            <Group gap="xs">
              <Box w={3} h={14} sx={{ borderRadius: 2, backgroundColor: PRIMARY }} />
              <Text size="xs" fw={600}>Overlays</Text>
            </Group>
            <Group gap={1}>
              {OVERLAY_ITEMS.map(({ label, key, setter, color }) => (
                <Box key={key} data-testid={`overlay-${label.toLowerCase()}`}>
                  <Chip
                    size="xs"
                    variant="outline"
                    radius="sm"
                    checked={state[key]}
                    data-testid={`chip-${label.toLowerCase()}`}
                    onChange={(checked) => setter(checked)}
                    style={
                      state[key]
                        ? { backgroundColor: withAlpha(color, 0.18), color, border: `1px solid ${color}` }
                        : { color: "var(--mui-palette-text-secondary)", border: "1px solid var(--mui-palette-divider)" }
                    }
                  >
                    {label}
                  </Chip>
                </Box>
              ))}
            </Group>
          </Stack>
        </PopoverDropdown>
      </Popover>
    </Toolbar>
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

export function PaperChart({ engine = "echarts" }: { engine?: "echarts" | "tradingview" } = {}) {
  const { colorScheme } = useColorScheme();
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
    <Card className="paper-chart-container" elevation={0} data-testid="paper-chart-container" id="paper-chart" sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <ChartHeader state={state} />
      <Box className="paper-chart-body" id="paper-chart-body" sx={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
        <LoadingOverlay visible={state.chartLoading} zIndex={10} overlayProps={{ radius: "sm", blur: 1 }} />
        {chartInput ? (
          <Box className="paper-chart-canvas-wrap" id="paper-chart-canvas-wrap" sx={{ flex: 1, minHeight: 0, display: "flex" }}>
            {engine === "tradingview" ? (
              <TradingViewChart
                candles={chartInput.candles as any}
                trades={chartInput.trades as any}
                highlightedTradeId={chartInput.highlightedTradeId ?? null}
                showAllTrades={chartInput.showAllTrades}
                markLines={chartInput.markLines}
                emaData={chartInput.emaData}
                livePosition={chartInput.livePosition}
              />
            ) : (
              <TradingChart input={chartInput} style={{ flex: 1, minHeight: 0 }} />
            )}
          </Box>
        ) : (
          <ChartEmptyState className="paper-chart-loading" icon="⏳">
            <Text className="paper-chart-loading-text" c="dimmed">
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
    </Card>
  );
}
