import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { ActionIcon, Box, Button, Skeleton, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { IconArrowLeft, IconRefresh } from "@/components/common/Icons";
import { formatNumber, formatNumberIN } from "@/utils/ui-helpers";
import { formatChartTick, formatChartTimestamp } from "@/utils/istChartTime";
import {
  fetchContractCandles,
  type ContractCandle,
  type ContractCandles,
  type ContractInterval,
} from "@/api/optionsContractChart";
import { AnalyticsChartCore } from "../analytics/AnalyticsChartCore";
import { useChartInk } from "../analytics/chartInk";

export interface ContractChartSelection {
  instrumentKey: string;
  symbol: string;
  expiry: string;
  strike: number;
  side: "CE" | "PE";
  ltp: number | null;
  spot: number;
}

/** The chips and the API enum must stay one list. */
const INTERVALS: readonly ContractInterval[] = ["1m", "5m", "15m"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const AXIS_FONT = 10;
const EMPTY_TEXT = "No trades for this contract yet";

function expiryLabel(expiry: string): string {
  const [year, month, day] = expiry.split("-").map(Number);
  if (!year || !month || !day) return expiry;
  return `${day} ${MONTHS[month - 1] ?? month}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** ECharts time axes hand the formatter epoch milliseconds, not the ISO string. */
function tickLabel(value: unknown): string {
  const ms = Number(value);
  return Number.isFinite(ms) ? formatChartTick(new Date(ms).toISOString()) : "";
}

function points(candles: readonly ContractCandle[], pick: (candle: ContractCandle) => number): [number, number][] {
  return candles.map((candle) => [Date.parse(candle.timestamp), pick(candle)]);
}

export interface ContractChartOptionInput {
  candles: readonly ContractCandle[];
  ink: string;
  showOi: boolean;
}

/**
 * Premium line + volume bars on two grids, sharing one time axis. The time axis
 * (not a category axis) is deliberate: an illiquid contract has missing minutes,
 * and a category axis would compress those gaps into an unbroken line.
 */
export function buildContractChartOption(input: ContractChartOptionInput): Record<string, unknown> {
  const { candles, ink, showOi } = input;
  const byTime = new Map<number, ContractCandle>();
  for (const candle of candles) byTime.set(Date.parse(candle.timestamp), candle);

  // A contract with no OI feed would otherwise draw a flat zero line, which
  // reads as "open interest collapsed" rather than "not published".
  const withOi = showOi && candles.some((candle) => candle.oi > 0);
  const right = withOi ? 46 : 10;
  const volume = candles.map((candle) => ({
    value: [Date.parse(candle.timestamp), candle.volume] as [number, number],
    itemStyle: {
      color: palette.alpha(candle.close >= candle.open ? palette.POSITIVE : palette.NEGATIVE, 0.5),
    },
  }));

  const series: Record<string, unknown>[] = [
    {
      name: "Premium",
      type: "line",
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: points(candles, (candle) => candle.close),
      showSymbol: false,
      smooth: false,
      connectNulls: false,
      lineStyle: { width: 1.5, color: palette.PRIMARY },
      itemStyle: { color: palette.PRIMARY },
      areaStyle: { color: palette.alpha(palette.PRIMARY, 0.08), origin: "start" },
      z: 3,
    },
    {
      name: "Volume",
      type: "bar",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: volume,
      barMaxWidth: 5,
      z: 2,
    },
  ];

  const yAxis: Record<string, unknown>[] = [
    {
      type: "value",
      gridIndex: 0,
      scale: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: AXIS_FONT, color: ink },
      splitLine: { lineStyle: { color: palette.AXIS_SPLIT } },
    },
    {
      type: "value",
      gridIndex: 1,
      scale: false,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
    },
  ];

  if (withOi) {
    series.push({
      name: "OI",
      type: "line",
      xAxisIndex: 0,
      yAxisIndex: 2,
      data: points(candles, (candle) => candle.oi),
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 1, color: palette.INFO },
      itemStyle: { color: palette.INFO },
      z: 2,
    });
    yAxis.push({
      type: "value",
      gridIndex: 0,
      position: "right",
      scale: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: AXIS_FONT, color: palette.INFO, formatter: (value: number) => formatNumber(value) },
      splitLine: { show: false },
    });
  }

  return {
    animation: false,
    backgroundColor: "transparent",
    grid: [
      { left: 4, right, top: 8, height: "60%", containLabel: true },
      { left: 4, right, top: "78%", height: "14%", containLabel: true },
    ],
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: palette.TOOLTIP_BG,
      borderColor: palette.TOOLTIP_BORDER,
      textStyle: { color: palette.TEXT, fontSize: AXIS_FONT },
      formatter: (params: unknown) => {
        const list = (Array.isArray(params) ? params : [params]) as Array<{ axisValue?: unknown }>;
        const candle = byTime.get(Number(list[0]?.axisValue));
        if (!candle) return "";
        const lines = [
          formatChartTimestamp(candle.timestamp),
          `O ${candle.open}  H ${candle.high}  L ${candle.low}  C ${candle.close}`,
          `Vol ${formatNumber(candle.volume)}`,
        ];
        if (withOi) lines.push(`OI ${formatNumber(candle.oi)}`);
        return lines.join("<br/>");
      },
    },
    xAxis: [
      {
        type: "time",
        gridIndex: 0,
        axisLine: { lineStyle: { color: palette.AXIS_LINE } },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
        axisPointer: { label: { formatter: (params: { value?: unknown }) => tickLabel(params?.value) } },
      },
      {
        type: "time",
        gridIndex: 1,
        axisLine: { lineStyle: { color: palette.AXIS_LINE } },
        axisTick: { show: false },
        axisLabel: { fontSize: AXIS_FONT, color: ink, hideOverlap: true, formatter: tickLabel },
        splitLine: { show: false },
        axisPointer: { label: { formatter: (params: { value?: unknown }) => tickLabel(params?.value) } },
      },
    ],
    yAxis,
    series,
  };
}

function LoadingSkeleton() {
  return (
    <Box
      className="flex min-h-0 flex-1 flex-col items-stretch justify-center gap-2 px-2"
      data-testid="contract-chart-loading"
    >
      <Skeleton h={12} w="70%" animate />
      <Skeleton h={12} w="50%" animate />
      <Text size="xs" c="dimmed" className="font-mono uppercase" style={{ "font-size": "9px" }}>
        Loading contract chart
      </Text>
    </Box>
  );
}

export function ContractChartPanel(props: {
  selection: ContractChartSelection;
  onBack: () => void;
}) {
  const [interval, setInterval] = createSignal<ContractInterval>("1m");
  const [attempt, setAttempt] = createSignal(0);
  const [data, setData] = createSignal<ContractCandles | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [showOi, setShowOi] = createSignal(false);
  const ink = useChartInk();

  let sequence = 0;
  let loadedKey = "";

  createEffect(() => {
    const instrumentKey = props.selection.instrumentKey;
    const timeframe = interval();
    void attempt();
    const controller = new AbortController();
    const seq = ++sequence;

    // A new contract must not keep the previous contract's premium painted; an
    // interval change may, because it is the same instrument (dimmed while loading).
    if (instrumentKey !== loadedKey) {
      loadedKey = instrumentKey;
      setData(null);
    }

    setLoading(true);
    setError(null);
    onCleanup(() => controller.abort());

    void fetchContractCandles(
      { instrumentKey, interval: timeframe, days: 1 },
      { signal: controller.signal },
    )
      .then((next) => {
        if (seq !== sequence) return;
        setData(next);
        setLoading(false);
      })
      .catch((failure: unknown) => {
        if (seq !== sequence || isAbortError(failure)) return;
        setError(failure instanceof Error ? failure.message : "Could not load this contract's chart");
        setLoading(false);
      });
  });

  const title = createMemo(
    () =>
      `${props.selection.symbol} ${formatNumberIN(props.selection.strike)} ${props.selection.side} · ` +
      expiryLabel(props.selection.expiry),
  );

  const candles = createMemo(() => data()?.candles ?? []);
  const option = createMemo(() =>
    buildContractChartOption({ candles: candles(), ink: ink(), showOi: showOi() }),
  );
  const optionKey = createMemo(() => {
    const frame = data();
    if (!frame) return "empty";
    const first = frame.candles[0]?.timestamp ?? "";
    const last = frame.candles[frame.candles.length - 1]?.timestamp ?? "";
    return `${frame.interval}|${frame.candles.length}|${first}|${last}|${showOi() ? 1 : 0}`;
  });

  const retry = () => setAttempt((value) => value + 1);
  const ltpText = () => (props.selection.ltp == null ? "—" : `₹${props.selection.ltp.toFixed(2)}`);

  return (
    <Box
      className="flex h-full min-h-0 flex-col"
      data-testid="contract-chart-panel"
      role="region"
      aria-label={`${title()} contract chart`}
      aria-busy={loading() ? "true" : undefined}
    >
      <Box className="flex shrink-0 items-center gap-1.5 border-b border-fin-border px-2 py-1">
        <ActionIcon
          variant="subtle"
          size="xs"
          aria-label="Back to option chain"
          data-testid="contract-chart-back"
          onClick={() => props.onBack()}
        >
          <IconArrowLeft size={14} />
        </ActionIcon>
        <Text
          size="sm"
          fw={600}
          truncate
          className="min-w-0 flex-1 font-mono"
          data-testid="contract-chart-title"
        >
          {title()}
        </Text>
        <ActionIcon
          variant="subtle"
          size="xs"
          aria-label="Refresh contract chart"
          data-testid="contract-chart-refresh"
          disabled={loading()}
          onClick={retry}
        >
          <IconRefresh size={14} />
        </ActionIcon>
      </Box>

      <Box className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1">
        <Box className="flex shrink-0 items-center gap-1">
          <Text size="xs" c="dimmed" className="font-mono uppercase" style={{ "font-size": "9px" }}>
            LTP
          </Text>
          <Text size="xs" className="font-mono" style={{ "font-size": "11px" }} data-testid="contract-chart-ltp">
            {ltpText()}
          </Text>
        </Box>
        <Box className="flex shrink-0 items-center gap-1">
          <Text size="xs" c="dimmed" className="font-mono uppercase" style={{ "font-size": "9px" }}>
            Spot
          </Text>
          <Text size="xs" className="font-mono" style={{ "font-size": "11px" }} data-testid="contract-chart-spot">
            {props.selection.spot.toFixed(2)}
          </Text>
        </Box>
        <Box className="ml-auto flex shrink-0 items-center gap-1">
          <For each={INTERVALS}>
            {(value) => (
              <Button
                size="xs"
                variant={interval() === value ? "light" : "subtle"}
                color="primary"
                aria-pressed={interval() === value}
                data-testid={`contract-chart-interval-${value}`}
                onClick={() => setInterval(value)}
              >
                {value}
              </Button>
            )}
          </For>
          <Button
            size="xs"
            variant={showOi() ? "light" : "subtle"}
            color="info"
            aria-pressed={showOi()}
            data-testid="contract-chart-oi"
            onClick={() => setShowOi((value) => !value)}
          >
            OI
          </Button>
        </Box>
      </Box>

      <Show when={error() && data()}>
        <Box
          className="flex h-[26px] shrink-0 items-center gap-2 border-l-[3px] bg-fin-surface-alt px-2"
          style={{ "border-left-color": "var(--color-fin-negative)" }}
          data-testid="contract-chart-error-banner"
        >
          <Text
            size="xs"
            className="min-w-0 flex-1 truncate font-mono"
            style={{ "font-size": "10px", color: "var(--color-fin-negative)" }}
          >
            {error()}
          </Text>
          <Button size="xs" variant="transparent" color="negative" data-testid="contract-chart-retry" onClick={retry}>
            Retry
          </Button>
        </Box>
      </Show>

      <Switch>
        <Match when={!data() && loading()}>
          <LoadingSkeleton />
        </Match>
        <Match when={!data() && error()}>
          <Box
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-3"
            data-testid="contract-chart-error"
          >
            <Text size="xs" c="dimmed" className="text-center font-mono" style={{ "font-size": "10px" }}>
              {error()}
            </Text>
            <Button size="xs" variant="outline" color="negative" data-testid="contract-chart-retry" onClick={retry}>
              Retry
            </Button>
          </Box>
        </Match>
        <Match when={data()}>
          <Box
            className="relative flex min-h-0 flex-1 flex-col transition-opacity"
            style={{ opacity: loading() ? 0.55 : 1 }}
          >
            <AnalyticsChartCore
              option={option()}
              optionKey={optionKey()}
              empty={candles().length === 0}
              emptyText={EMPTY_TEXT}
              testId="contract-chart"
            />
            <Show when={loading()}>
              <Box className="pointer-events-none absolute right-2 top-1">
                <Text size="xs" c="dimmed" className="font-mono uppercase" style={{ "font-size": "9px" }}>
                  Loading {interval()}
                </Text>
              </Box>
            </Show>
          </Box>
        </Match>
      </Switch>
    </Box>
  );
}
