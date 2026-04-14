import { useEffect, useRef, useMemo, useState, forwardRef, useImperativeHandle } from "react";
import { Box, Group, Text, Badge, Button, Switch, useMantineColorScheme } from "@mantine/core";
import type {
  ReplayCandle,
  ReplayTrade,
  ReplayORLevels,
  ReplayPivotLevels,
  Replay52WLevel,
  ReplayEMAData,
  ReplayChartOptions,
} from "../../types/replay";
import { buildReplayChartOption } from "./buildReplayChartOption";

const TF_PRESETS = [
  { label: "1m", minutes: 1 },
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "1D", minutes: 1440 },
];

function aggregateCandles(candles: ReplayCandle[], intervalMin: number): ReplayCandle[] {
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
  onTradeClick?: (tradeId: number, entryTime: string, exitTime: string) => void;
}

export const ReplayChart = forwardRef<ReplayChartHandle, ReplayChartProps>(function ReplayChart(
  {
    candlesBySymbol,
    trades,
    orLevels,
    pivotLevels,
    high52wLevels,
    emaData: _emaData,
    selectedSymbol,
    setSelectedSymbol,
    chartOptions,
    setChartOptions,
    highlightedTradeId,
  },
  ref,
) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const allTimesRef = useRef<string[]>([]);
  const [activeTF, setActiveTF] = useState(1);

  const symbols = useMemo(() => Object.keys(candlesBySymbol), [candlesBySymbol]);

  const filteredTrades = useMemo(
    () => trades.filter((t) => t.symbol === selectedSymbol),
    [trades, selectedSymbol],
  );

  const filteredORLevels = useMemo(
    () => orLevels.filter((o) => o.symbol === selectedSymbol),
    [orLevels, selectedSymbol],
  );

  const filteredPivots = useMemo(
    () => pivotLevels.filter((p) => p.symbol === selectedSymbol),
    [pivotLevels, selectedSymbol],
  );

  const filtered52w = useMemo(
    () => high52wLevels.filter((h) => h.symbol === selectedSymbol),
    [high52wLevels, selectedSymbol],
  );

  const rawCandles = candlesBySymbol[selectedSymbol] ?? [];

  const displayCandles = useMemo(
    () => aggregateCandles(rawCandles, activeTF),
    [rawCandles, activeTF],
  );

  const displayEMA = useMemo(() => {
    const backendEMA = _emaData[selectedSymbol];
    if (!backendEMA) return null;
    const tfData = backendEMA.timeframes[String(activeTF)];
    if (!tfData || tfData.ema_fast.length === 0 || tfData.ema_slow.length === 0) return null;
    return {
      ema_fast_period: backendEMA.ema_fast_period,
      ema_slow_period: backendEMA.ema_slow_period,
      ema_fast: tfData.ema_fast,
      ema_slow: tfData.ema_slow,
    };
  }, [selectedSymbol, _emaData, activeTF]);

  useImperativeHandle(ref, () => ({
    zoomToTrade(entryTime: string, exitTime: string) {
      setTimeout(() => {
        if (!chartInstance.current || !allTimesRef.current.length) return;
        const times = allTimesRef.current;
        const parse = (s: string) =>
          s.includes("T")
            ? s.split("T")[1].substring(0, 5)
            : s.includes(" ")
              ? s.split(" ")[1].substring(0, 5)
              : s.substring(0, 5);
        const entryKey = parse(entryTime);
        const exitKey = parse(exitTime);

        let entryIdx = times.findIndex((t) => t === entryKey);
        if (entryIdx === -1) {
          let best = -1;
          for (let i = 0; i < times.length; i++) {
            if (times[i] <= entryKey) best = i;
            else break;
          }
          entryIdx = best >= 0 ? best : 0;
        }
        let exitIdx = times.findIndex((t) => t === exitKey);
        if (exitIdx === -1) {
          let best = -1;
          for (let i = 0; i < times.length; i++) {
            if (times[i] <= exitKey) best = i;
            else break;
          }
          exitIdx = best >= 0 ? best : times.length - 1;
        }

        const total = times.length;
        const span = exitIdx - entryIdx + 1;
        const minWindow = Math.min(60, total);
        const pad = Math.max(5, Math.floor((minWindow - span) / 2));
        let start = Math.max(0, entryIdx - pad);
        let end = Math.min(total - 1, exitIdx + pad);

        if (end - start + 1 < minWindow) {
          if (start === 0) end = Math.min(total - 1, minWindow - 1);
          else start = Math.max(0, end - minWindow + 1);
        }

        const startPct = (start / total) * 100;
        const endPct = ((end + 1) / total) * 100;

        chartInstance.current.dispatchAction({
          type: "dataZoom",
          dataZoomIndex: 0,
          start: startPct,
          end: endPct,
        });
      }, 100);
    },
    setTimeframe(minutes: number) {
      setActiveTF(minutes);
    },
  }));

  useEffect(() => {
    if (!chartRef.current || displayCandles.length === 0) return;

    const echartsLib = (window as any).echarts;
    if (!echartsLib) {
      console.error("ReplayChart: ECharts not loaded");
      return;
    }

    if (chartInstance.current) {
      chartInstance.current.dispose();
    }

    chartInstance.current = echartsLib.init(chartRef.current, isDark ? "dark" : null);
    const option = buildReplayChartOption(
      displayCandles,
      filteredTrades,
      filteredORLevels,
      filteredPivots,
      filtered52w,
      displayEMA,
      isDark,
      chartOptions,
      highlightedTradeId,
      rawCandles,
      activeTF,
    );
    chartInstance.current.setOption(option);
    chartInstance.current.resize();

    allTimesRef.current = displayCandles.map((c) => {
      const parts = c.time.includes(" ") ? c.time.split(" ")[1] : c.time;
      return parts.substring(0, 5);
    });

    const handleResize = () => chartInstance.current?.resize();
    window.addEventListener("resize", handleResize);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => chartInstance.current?.resize())
        : null;
    resizeObserver?.observe(chartRef.current);

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, [
    displayCandles,
    filteredTrades,
    filteredORLevels,
    isDark,
    displayEMA,
    chartOptions,
    highlightedTradeId,
  ]);

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
      <Box
        ref={chartRef}
        data-testid="echarts-container"
        style={{ flex: 1, width: "100%", minHeight: 0 }}
      />
    </Box>
  );
});
