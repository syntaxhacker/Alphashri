import { useMemo, useState, forwardRef, useImperativeHandle, useRef } from "react";
import { Box, Group, Text, Badge, Button, Switch, useColorScheme } from "@/ui";
import type {
  ReplayCandle,
  ReplayTrade,
  ReplayORLevels,
  ReplayPivotLevels,
  Replay52WLevel,
  ReplayEMAData,
  ReplayChartOptions,
} from "../../types/replay";
import { TradingChart } from "../chart/TradingChart";
import type { TradingChartHandle } from "../chart/TradingChart";
import { normalizeReplay } from "../../utils/chart/normalizeReplay";

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
}

export const ReplayChart = forwardRef<ReplayChartHandle, ReplayChartProps>(function ReplayChart(
  {
    candlesBySymbol,
    trades,
    orLevels,
    pivotLevels,
    high52wLevels,
    emaData,
    selectedSymbol,
    setSelectedSymbol,
    chartOptions,
    setChartOptions,
    highlightedTradeId,
    onTradeClick,
  },
  ref,
) {
  const tradingChartRef = useRef<TradingChartHandle>(null);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const [activeTF, setActiveTF] = useState(1);

  const symbols = useMemo(() => Object.keys(candlesBySymbol), [candlesBySymbol]);

  const rawCandles = candlesBySymbol[selectedSymbol] ?? [];

  const displayCandles = useMemo(
    () => aggregateCandles(rawCandles, activeTF),
    [rawCandles, activeTF],
  );

  const chartInput = useMemo(
    () =>
      normalizeReplay(
        displayCandles,
        trades,
        orLevels,
        pivotLevels,
        high52wLevels,
        emaData,
        selectedSymbol,
        isDark,
        highlightedTradeId,
        chartOptions.show_all_trades,
        rawCandles,
        activeTF,
        {
          show_orb_zones: chartOptions.show_orb_zones,
          show_pivot_levels: chartOptions.show_pivot_levels,
          show_52w_high: chartOptions.show_52w_high,
          show_ema: chartOptions.show_ema,
        },
      ),
    [
      displayCandles,
      trades,
      orLevels,
      pivotLevels,
      high52wLevels,
      emaData,
      selectedSymbol,
      isDark,
      highlightedTradeId,
      chartOptions,
      rawCandles,
      activeTF,
    ],
  );

  useImperativeHandle(ref, () => ({
    zoomToTrade(entryTime: string, exitTime: string) {
      tradingChartRef.current?.zoomToTradeByTime(entryTime, exitTime);
    },
    setTimeframe(minutes: number) {
      setActiveTF(minutes);
    },
  }));

  if (symbols.length === 0) {
    return (
      <Box
        data-testid="replay-chart-empty"
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--mantine-color-body)",
          borderRadius: "var(--mantine-radius-md)",
        }}
      >
        <Text c="dimmed">Run a replay to see chart</Text>
      </Box>
    );
  }

  return (
    <Box data-testid="replay-chart" h="100%" style={{ display: "flex", flexDirection: "column" }}>
      <Group gap="xs" pb={4} px="sm" style={{ flex: "0 0 auto" }}>
        {symbols.map((sym) => (
          <Badge
            key={sym}
            variant={sym === selectedSymbol ? "filled" : "light"}
            color={sym === selectedSymbol ? "teal" : "gray"}
            size="sm"
            style={{ cursor: "pointer" }}
            onClick={() => setSelectedSymbol(sym)}
            data-testid={`symbol-badge-${sym}`}
          >
            {sym}
          </Badge>
        ))}
        <Box ml="auto">
          <Group gap="sm">
            {TF_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                size="compact-xs"
                variant={activeTF === preset.minutes ? "filled" : "subtle"}
                color={activeTF === preset.minutes ? "teal" : "gray"}
                onClick={() => setActiveTF(preset.minutes)}
                data-testid={`tf-btn-${preset.label}`}
              >
                {preset.label}
              </Button>
            ))}
          </Group>
        </Box>
      </Group>
      <Group gap="sm" px="sm" pb={4} style={{ flex: "0 0 auto" }}>
        <Switch
          size="xs"
          label="All trades"
          checked={chartOptions.show_all_trades}
          onChange={(e) => setChartOptions({ show_all_trades: e.currentTarget.checked })}
          data-testid="replay-show-all-trades"
        />
        <Switch
          size="xs"
          label="Markers"
          defaultChecked
          disabled
          styles={{ label: { color: "#00BFFF" } }}
          data-testid="replay-show-markers"
        />
        <Switch
          size="xs"
          label="ORB"
          checked={chartOptions.show_orb_zones}
          onChange={(e) => setChartOptions({ show_orb_zones: e.currentTarget.checked })}
          styles={{ label: { color: "#2196F3" } }}
          data-testid="replay-show-orb"
        />
        <Switch
          size="xs"
          label="Pivot"
          checked={chartOptions.show_pivot_levels}
          onChange={(e) => setChartOptions({ show_pivot_levels: e.currentTarget.checked })}
          styles={{ label: { color: "#AB47BC" } }}
          data-testid="replay-show-pivot"
        />
        <Switch
          size="xs"
          label="52W"
          checked={chartOptions.show_52w_high}
          onChange={(e) => setChartOptions({ show_52w_high: e.currentTarget.checked })}
          styles={{ label: { color: "#E91E63" } }}
          data-testid="replay-show-52w"
        />
        <Switch
          size="xs"
          label="EMA"
          checked={chartOptions.show_ema}
          onChange={(e) => setChartOptions({ show_ema: e.currentTarget.checked })}
          styles={{ label: { color: "#10ac84" } }}
          data-testid="replay-show-ema"
        />
      </Group>
      <TradingChart ref={tradingChartRef} input={chartInput} onTradeClick={onTradeClick} />
    </Box>
  );
});
