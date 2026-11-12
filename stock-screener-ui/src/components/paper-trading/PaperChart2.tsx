import { createMemo, createEffect, createSignal, For, Show, onCleanup, onMount } from "solid-js";
import { useStoreSnapshot } from "./storeSnapshot";
import { Button, Text, Select, useColorScheme, Badge, LoadingOverlay, ActionIcon, Popover, PopoverTarget, PopoverDropdown, Chip, Divider, DatePicker } from "@/ui";
import { IconDots } from "@/components/common/Icons";
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
import { buildChartOption } from "../../utils/chart/buildChartOption";
import { loadEcharts } from "../../utils/loadEcharts";
import type { ChartInput } from "../../utils/chart/types";
import { normalizePaper } from "../../utils/chart/normalizePaper";
import type { PaperPosition } from "../../types/paperTrading";
import { TIMEFRAMES } from "../../config/constants";
import { PRIMARY, POSITIVE, NEGATIVE, PIVOT_OR_HIGH, PIVOT_52W_HIGH, PIVOT_PP, INDICATOR_BLUE_A, TEXT_MUTED, BORDER } from "@/ui/palette";
import { alpha } from "@/ui/alpha";
import { Box, Group, Flex, Stack, Card } from "./primitives";

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

/**
 * Solid echarts host for the live chart. The React TradingChart wrapper is
 * not portable, but its underlying option builder is framework-free, so this
 * is the same chart rendered directly.
 */
function SolidTradingChart(props: { input: ChartInput | null }) {
  let chartEl: HTMLDivElement | undefined;
  let chart: any = null;
  let echartsLib: any = null;
  let resizeHandler: (() => void) | null = null;
  let ro: ResizeObserver | null = null;
  const [libReady, setLibReady] = createSignal(false);

  onMount(async () => {
    const lib = await loadEcharts();
    if (lib) {
      echartsLib = lib;
      setLibReady(true);
    }
  });

  onCleanup(() => {
    if (resizeHandler) window.removeEventListener("resize", resizeHandler);
    ro?.disconnect();
    if (chart) {
      chart.dispose();
      chart = null;
    }
  });

  createEffect(() => {
    if (!libReady()) return;
    const input = props.input;
    if (!input || !chartEl) return;
    if (!chart) {
      chart = echartsLib.init(chartEl, null);
      resizeHandler = () => chart?.resize();
      window.addEventListener("resize", resizeHandler);
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => chart?.resize());
        ro.observe(chartEl);
      }
    }
    const option = buildChartOption(input);
    chart.setOption(option, true);
    chart.resize();
  });

  return <div ref={chartEl} class="flex-1 min-h-0 w-full" data-testid="paper-trading-chart-canvas" />;
}

function PositionInfo(props: { position: PaperPosition }) {
  const sideIcon = () => props.position.side === "BUY" ? "▲" : "▼";

  return (
    <Group gap="xs" data-testid="position-info" id={`position-info-${props.position.symbol}`}>
      <Badge size="sm" variant="filled" color={props.position.side === "BUY" ? "success" : "error"}>
        {sideIcon()} {props.position.side}
      </Badge>
      <Text size="sm" fw={500} className="font-mono tabular-nums">
        {props.position.quantity} @ ₹{props.position.entry_price.toFixed(2)}
      </Text>
      <Text size="sm" fw={600} c={getPnLTextColor(props.position.pnl)} className="font-mono tabular-nums">
        P&L: ₹{props.position.pnl.toFixed(0)} ({formatPercentage(props.position.pnl_pct, 2, true)})
      </Text>
    </Group>
  );
}

function ChartLegend(props: { orbLabel?: string; hasWeek52: boolean; hasTrades: boolean; position?: PaperPosition }) {
  const items = (): { color: string; label: string; shape: "square" | "circle" }[] => {
    const out: { color: string; label: string; shape: "square" | "circle" }[] = [];
    if (props.hasTrades) {
      out.push(
        { color: PRIMARY, label: "Entry", shape: "square" },
        { color: POSITIVE, label: "TP", shape: "circle" },
        { color: NEGATIVE, label: "SL", shape: "circle" },
      );
    }
    if (props.orbLabel) out.push({ color: PIVOT_OR_HIGH, label: props.orbLabel, shape: "square" });
    if (props.hasWeek52) out.push({ color: PIVOT_52W_HIGH, label: "52W High", shape: "square" });
    return out;
  };

  const hasAny = () => items().length > 0 || !!props.position;

  return (
    <Show when={hasAny()}>
      <Flex className="paper-chart-legend py-2 px-2" gap="xs" justify="center" align="center" wrap="wrap" data-testid="chart-legend" id="chart-legend">
        <For each={items()}>{(item) => (
          <Flex className="paper-chart-legend-item gap-2" id={`paper-chart-legend-${item.label.toLowerCase().replace(/\s+/g, "-")}`} align="center">
            <div class="paper-chart-legend-swatch w-2 h-2 shrink-0" style={{ "border-radius": item.shape === "circle" ? "50%" : "2px", "background-color": item.color }} />
            <Text className="paper-chart-legend-label" size="xs" c="dimmed">{item.label}</Text>
          </Flex>
        )}</For>
        <Show when={props.position}>
          {(position) => <PositionInfo position={position()} />}
        </Show>
      </Flex>
    </Show>
  );
}

function ChartEmptyState(props: { className: string; icon?: string; children?: import("solid-js").JSX.Element }) {
  return (
    <Card className={`paper-chart-empty ${props.className}`} data-testid="paper-chart-empty" id="paper-chart">
      <div class="paper-chart-empty-content text-center">
        <Show when={props.icon}>
          <Text className="paper-chart-empty-icon mb-1" size="lg" c="dimmed">
            {props.icon}
          </Text>
        </Show>
        <Show when={props.icon} fallback={<div data-testid="chart-placeholder-content">{props.children}</div>}>
          {props.children}
        </Show>
      </div>
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

function ChartHeader(props: { state: ReturnType<typeof getPaperTradingState> }) {
  const [range, setRange] = createSignal<[Date | null, Date | null]>([null, null]);
  const [popoverOpened, setPopoverOpened] = createSignal(false);

  createEffect(() => {
    const fromDate = props.state.chartFromDate;
    const dataDate = props.state.chartData?.date;
    if (fromDate && dataDate) {
      setRange([new Date(fromDate), new Date(dataDate)]);
    }
  });

  const fromDate = () => range()[0] ? dayjs(range()[0]).format("YYYY-MM-DD") : undefined;

  const handleQuickRange = (days: number) => {
    const to = new Date();
    const from = days === -1 ? new Date(0) : dayjs().subtract(days, "day").toDate();
    setRange([from, to]);
    setPopoverOpened(false);
    const fd = days === -1 ? undefined : dayjs(from).format("YYYY-MM-DD");
    const cd = dayjs(to).format("YYYY-MM-DD");
    const s = getPaperTradingState();
    if (s.selectedSymbol) {
      fetchPaperChart(s.selectedSymbol, cd, s.chartTimeframe, s.selectedStrategyId, fd, true, s.selectedTradeId || undefined);
    }
  };

  const handleRangeChange = (r: [Date | null, Date | null] | null) => {
    if (!r) return;
    setRange(r);
    if (r[0] && r[1] && r[0] > r[1]) return;
    const fd = r[0] ? dayjs(r[0]).format("YYYY-MM-DD") : undefined;
    const s = getPaperTradingState();
    const cd = r[1] ? dayjs(r[1]).format("YYYY-MM-DD") : s.chartData?.date;
    if (s.selectedSymbol && cd) {
      fetchPaperChart(s.selectedSymbol, cd, s.chartTimeframe, s.selectedStrategyId, fd, true, s.selectedTradeId || undefined);
    }
    if (r[0] && r[1]) setPopoverOpened(false);
  };

  const handleTimeframeChange = async (value: string | null) => {
    if (!value) return;
    setChartTimeframe(value);
    const s = getPaperTradingState();
    if (s.currentView === "history") setChartTimeframeHistory(value);
    else if (s.currentView === "live") setChartTimeframeLive(value);
    const cd = s.chartData?.date;
    if (s.selectedSymbol && cd) {
      await fetchPaperChart(s.selectedSymbol, cd, value, s.selectedStrategyId, s.chartFromDate || undefined, true, s.selectedTradeId || undefined);
    }
  };

  const shortDate = () => {
    const d = props.state.chartData?.actual_date || props.state.chartData?.date;
    if (!d) return "";
    if (d.includes(" to ")) {
      const [start, end] = d.split(" to ");
      const fmt = (s: string) => dayjs(s).format("MMM D");
      return `${fmt(start)} - ${fmt(end)}`;
    }
    return dayjs(d).format("MMM D");
  };

  const hasActiveOverlays = () => OVERLAY_ITEMS.some(({ key }) => props.state[key]);

  return (
    <div role="toolbar" class="paper-chart-header flex items-center flex-none flex-wrap gap-2 row-gap-2 px-2 py-1 min-h-12" data-testid="paper-chart-header" id="chart-header">
      <div class="flex items-baseline gap-2 min-w-0 shrink-1 mr-2">
        <Show when={props.state.chartData?.symbol}>
          {(symbol) => (
            <Text fw={600} size="xs" className="min-w-0">
              {symbol()}
            </Text>
          )}
        </Show>
        <Show when={shortDate()}>
          {(d) => (
            <Text size="xs" c="dimmed" fw={400} className="whitespace-nowrap">
              · {d()}
            </Text>
          )}
        </Show>
      </div>

      <Select
        data-testid="chart-timeframe-select"
        size="xs"
        value={props.state.chartTimeframe}
        onChange={handleTimeframeChange}
        data={fromDate() ? TIMEFRAME_OPTIONS : TIMEFRAME_OPTIONS.filter((tf) => tf.value !== "12hour" && tf.value !== "1day")}
        style={{ width: "84px", "min-width": "84px", flex: "0 0 auto" }}
      />

      <DatePicker
        size="xs"
        clearable
        maxDate={new Date()}
        placeholder="From"
        valueFormat="MMM D"
        value={range()[0]}
        onChange={(d) => handleRangeChange([d, range()[1]])}
        data-testid="chart-date-range-from"
        style={{ width: "150px", flex: "0 0 auto" }}
      />

      <DatePicker
        size="xs"
        clearable
        maxDate={new Date()}
        valueFormat="MMM D"
        placeholder="To"
        value={range()[1]}
        onChange={(d) => handleRangeChange([range()[0], d])}
        data-testid="chart-date-range"
        style={{ width: "150px", flex: "0 0 auto" }}
      />

      <div class="flex-1" />

      <Popover
        width={260}
        position="bottom-end"
        shadow="md"
        withArrow
        opened={popoverOpened()}
        onChange={setPopoverOpened}
        onClose={() => setPopoverOpened(false)}
      >
        <PopoverTarget>
          <ActionIcon
            size="sm"
            variant={hasActiveOverlays() ? "filled" : "subtle"}
            color={hasActiveOverlays() ? "primary" : "secondary"}
            data-testid="chart-more-button"
          >
            <IconDots size={16} />
          </ActionIcon>
        </PopoverTarget>
        <PopoverDropdown p="xs">
          <Stack className="gap-2">
            <Group gap="xs">
              <div class="w-[3px] h-[14px] shrink-0" style={{ "border-radius": 2, "background-color": PRIMARY }} />
              <Text size="xs" fw={600}>Range</Text>
            </Group>
            <Group className="gap-2">
              <For each={QUICK_RANGES}>{(r) => (
                <Button
                  size="xs"
                  variant="light"
                  color="primary"
                  onClick={() => handleQuickRange(r.days)}
                >
                  {r.label}
                </Button>
              )}</For>
            </Group>

            <Divider className="my-2" />

            <Group gap="xs">
              <div class="w-[3px] h-[14px] shrink-0" style={{ "border-radius": 2, "background-color": PRIMARY }} />
              <Text size="xs" fw={600}>Overlays</Text>
            </Group>
            <Group className="gap-2">
              <For each={OVERLAY_ITEMS}>{({ label, key, setter, color }) => (
                <Box data-testid={`overlay-${label.toLowerCase()}`}>
                  <Chip
                    size="xs"
                    variant="outline"
                    radius="sm"
                    checked={props.state[key]}
                    data-testid={`chip-${label.toLowerCase()}`}
                    onChange={(checked) => setter(checked)}
                    style={
                      props.state[key]
                        ? { "background-color": alpha(color, 0.18), color, border: `1px solid ${color}` }
                        : { color: TEXT_MUTED, border: `1px solid ${BORDER}` }
                    }
                  >
                    {label}
                  </Chip>
                </Box>
              )}</For>
            </Group>
          </Stack>
        </PopoverDropdown>
      </Popover>
    </div>
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

export function PaperChart(props: { engine?: "echarts" | "tradingview" }) {
  // The `tradingview` engine (lightweight-charts via the React
  // TradingViewChart wrapper) has not been ported to Solid yet — it falls
  // back to the echarts renderer, which shows the same data.
  if (props.engine === "tradingview" && typeof window !== "undefined") {
    console.warn("[PaperChart] engine=\"tradingview\" is not ported to Solid yet; rendering echarts instead.");
  }
  const { colorScheme } = useColorScheme();
  const isDark = () => colorScheme() === "dark";
  const state = useStoreSnapshot(subscribe, getPaperTradingState);

  const chartInput = createMemo(() => {
    const s = state();
    if (!s.chartData) return null;
    return normalizePaper(
      s.chartData,
      isDark(),
      s.selectedTradeId,
      s.showAllTrades || !!s.selectedTradeId,
      s.showOrbLines,
      s.showPivotLines,
      s.show52wLines,
      s.showEmaLines,
    );
  });

  const emptyState = () => getEmptyState(state());

  return (
    <Show
      when={emptyState()}
      fallback={
        <Card className="paper-chart-container flex flex-col min-h-0 overflow-hidden h-full" data-testid="paper-chart-container" id="paper-chart">
          <ChartHeader state={state()} />
          <div class="paper-chart-body flex-1 min-h-0 relative flex flex-col" id="paper-chart-body">
            <LoadingOverlay visible={state().chartLoading} zIndex={10} overlayProps={{ radius: "sm", blur: 1 }} />
            <Show
              when={chartInput()}
              fallback={
                <ChartEmptyState className="paper-chart-loading" icon="⏳">
                  <Text className="paper-chart-loading-text" c="dimmed">
                    {state().chartLoading ? `Loading ${state().selectedSymbol} chart...` : "No data"}
                  </Text>
                </ChartEmptyState>
              }
            >
              <div class="paper-chart-canvas-wrap flex-1 min-h-0 flex" id="paper-chart-canvas-wrap">
                <SolidTradingChart input={chartInput()} />
              </div>
            </Show>
          </div>
          <Show when={state().chartData}>
            {(chartData) => (
              <ChartLegend
                orbLabel={chartData().orb_levels ? `ORB (${chartData().orb_levels.or_minutes}m)` : undefined}
                hasWeek52={!!chartData().week52_levels}
                hasTrades={!!chartData().trades?.length}
                position={chartData().current_position}
              />
            )}
          </Show>
        </Card>
      }
    >
      {(empty) => (
        <ChartEmptyState className={empty().className} icon={empty().icon}>
          <Text c="dimmed">{empty().text}</Text>
          <Show when={empty().subtext}>
            {(subtext) => <Text size="sm" c="dimmed" className="mt-2">{subtext()}</Text>}
          </Show>
          <Show when={empty().className === "paper-chart-error" && state().selectedSymbol}>
            <Button size="xs" variant="light" className="mt-2" onClick={() =>
              fetchPaperChart(state().selectedSymbol!, state().chartData?.date || dayjs().format("YYYY-MM-DD"), state().chartTimeframe, state().selectedStrategyId, undefined, true, state().selectedTradeId || undefined)
            }>
              Retry
            </Button>
          </Show>
        </ChartEmptyState>
      )}
    </Show>
  );
}
