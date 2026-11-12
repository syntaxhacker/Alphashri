import { createMemo, createSignal, For, Show } from "solid-js";
import { Text, Badge, Button, Switch, useColorScheme } from "@/ui";
import * as palette from "@/ui/palette";
import type {
  ReplayCandle,
  ReplayTrade,
  ReplayORLevels,
  ReplayPivotLevels,
  Replay52WLevel,
  ReplayEMAData,
  ReplayChartOptions,
} from "../../types/replay";
import { TradingChart, type TradingChartHandle } from "../chart/TradingChart";
import { normalizeReplay } from "../../utils/chart/normalizeReplay";
import { Box, Group } from "../paper-trading/primitives";

const TF_PRESETS = [
  { label: "1m", minutes: 1 },
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "1D", minutes: 1440 },
];

export function aggregateCandles(candles: ReplayCandle[], intervalMin: number): ReplayCandle[] {
  if (intervalMin <= 1 || candles.length === 0) return candles;

  const groups = new Map<
    string,
    { open: number; high: number; low: number; close: number; volume: number; time: string }
  >();

  for (const c of candles) {
    const timeStr = c.time.includes(" ") ? c.time.split(" ")[1] : c.time;
    const parts = timeStr.split(":");
    const totalMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    const groupMin = Math.floor(totalMin / intervalMin) * intervalMin;
    const gh = Math.floor(groupMin / 60);
    const gm = groupMin % 60;
    const dateStr = c.time.includes(" ") ? c.time.split(" ")[0] : "";
    const key = `${dateStr} ${String(gh).padStart(2, "0")}:${String(gm).padStart(2, "0")}`;
    const existing = groups.get(key);
    if (existing) {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += c.volume;
    } else {
      groups.set(key, {
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        time: key,
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.time.localeCompare(b.time));
}

export interface ReplayChartHandle {
  zoomToTrade: (entryTime: string, exitTime: string) => void;
  setTimeframe: (minutes: number) => void;
}

interface ReplayChartProps {
  candlesBySymbol: Record<string, ReplayCandle[]>;
  trades: ReplayTrade[];
  orLevels: ReplayORLevels[];
  pivotLevels: ReplayPivotLevels[];
  high52wLevels: Replay52WLevel[];
  emaData: Record<string, ReplayEMAData>;
  selectedSymbol: string;
  setSelectedSymbol: (symbol: string) => void;
  chartOptions: ReplayChartOptions;
  setChartOptions: (opts: Partial<ReplayChartOptions>) => void;
  highlightedTradeId: number | null;
  onTradeClick?: (tradeId: number) => void;
  /** imperative handle: { current } object owned by the parent, or callback */
  ref?: { current: ReplayChartHandle | null } | ((h: ReplayChartHandle) => void);
}

export function ReplayChart(props: ReplayChartProps) {
  let tradingChartRef: TradingChartHandle | undefined;
  const scheme = useColorScheme();
  const isDark = () => scheme.colorScheme() === "dark";
  const [activeTF, setActiveTF] = createSignal(1);

  const symbols = createMemo(() => Object.keys(props.candlesBySymbol));

  const rawCandles = () => props.candlesBySymbol[props.selectedSymbol] ?? [];

  const displayCandles = createMemo(() => aggregateCandles(rawCandles(), activeTF()));

  const chartInput = createMemo(() =>
    normalizeReplay(
      displayCandles(),
      props.trades,
      props.orLevels,
      props.pivotLevels,
      props.high52wLevels,
      props.emaData,
      props.selectedSymbol,
      isDark(),
      props.highlightedTradeId,
      props.chartOptions.show_all_trades,
      rawCandles(),
      activeTF(),
      {
        show_orb_zones: props.chartOptions.show_orb_zones,
        show_pivot_levels: props.chartOptions.show_pivot_levels,
        show_52w_high: props.chartOptions.show_52w_high,
        show_ema: props.chartOptions.show_ema,
      },
    ),
  );

  const handle: ReplayChartHandle = {
    zoomToTrade(entryTime: string, exitTime: string) {
      tradingChartRef?.zoomToTradeByTime(entryTime, exitTime);
    },
    setTimeframe(minutes: number) {
      setActiveTF(minutes);
    },
  };
  if (typeof props.ref === "function") props.ref(handle);
  else if (props.ref) props.ref.current = handle;

  return (
    <Show
      when={symbols().length > 0}
      fallback={
        <Box
          data-testid="replay-chart-empty"
          h="100%"
          alignItems="center"
          justifyContent="center"
          bg={palette.SURFACE}
          style={{ display: "flex", borderRadius: "2px" }}
        >
          <Text c="dimmed">Run a replay to see chart</Text>
        </Box>
      }
    >
      <Box data-testid="replay-chart" h="100%" style={{ display: "flex", flexDirection: "column" }}>
        <Group gap="xs" align="center" pb={4} px="sm" style={{ flex: "0 0 auto" }}>
          <For each={symbols()}>{(sym) => (
            <Badge
              variant={sym === props.selectedSymbol ? "filled" : "light"}
              color={sym === props.selectedSymbol ? "info" : "secondary"}
              size="sm"
              style={{ cursor: "pointer" }}
              onClick={() => props.setSelectedSymbol(sym)}
              data-testid={`symbol-badge-${sym}`}
            >
              {sym}
            </Badge>
          )}</For>
          <Box ml="auto">
            <Group gap="sm" align="center">
              <For each={TF_PRESETS}>{(preset) => (
                <Button
                  size="xs"
                  variant={activeTF() === preset.minutes ? "filled" : "subtle"}
                  color={activeTF() === preset.minutes ? "info" : "secondary"}
                  onClick={() => setActiveTF(preset.minutes)}
                  data-testid={`tf-btn-${preset.label}`}
                >
                  {preset.label}
                </Button>
              )}</For>
            </Group>
          </Box>
        </Group>
        <Group gap="sm" align="center" px="sm" pb={4} style={{ flex: "0 0 auto" }}>
          <Switch
            size="xs"
            label="All trades"
            checked={props.chartOptions.show_all_trades}
            onChange={(e) => props.setChartOptions({ show_all_trades: e.currentTarget.checked })}
            data-testid="replay-show-all-trades"
          />
          <Switch
            size="xs"
            label="Markers"
            defaultChecked
            disabled
            data-testid="replay-show-markers"
          />
          <Switch
            size="xs"
            label="ORB"
            checked={props.chartOptions.show_orb_zones}
            onChange={(e) => props.setChartOptions({ show_orb_zones: e.currentTarget.checked })}
            data-testid="replay-show-orb"
          />
          <Switch
            size="xs"
            label="Pivot"
            checked={props.chartOptions.show_pivot_levels}
            onChange={(e) => props.setChartOptions({ show_pivot_levels: e.currentTarget.checked })}
            data-testid="replay-show-pivot"
          />
          <Switch
            size="xs"
            label="52W"
            checked={props.chartOptions.show_52w_high}
            onChange={(e) => props.setChartOptions({ show_52w_high: e.currentTarget.checked })}
            data-testid="replay-show-52w"
          />
          <Switch
            size="xs"
            label="EMA"
            checked={props.chartOptions.show_ema}
            onChange={(e) => props.setChartOptions({ show_ema: e.currentTarget.checked })}
            data-testid="replay-show-ema"
          />
        </Group>
        <TradingChart ref={(h) => (tradingChartRef = h)} input={chartInput()} onTradeClick={props.onTradeClick} />
      </Box>
    </Show>
  );
}
