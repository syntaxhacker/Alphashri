import type { Meta, StoryObj } from "@storybook/react-vite";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Box, Paper, Button, ActionIcon, Text, Chip, Tooltip } from "@/ui";
import { IconPlayerPlay, IconPlayerPause } from "@tabler/icons-react";
import * as palette from "@/ui/palette";
import { ReplayChart, type ReplayChartHandle } from "@/components/replay/ReplayChart";
import { TradingViewChart } from "@/components/chart/TradingViewChart";
import oneDayReal from "./oneDayCandles.json";
import type { ReplayCandle, ReplayTrade } from "@/types/replay";

// palette — dense, no blue, 8pt grid
const BG = "#0D1117";
const SURFACE = "#161B22";
const SURFACE_ALT = "#21262D";
const BORDER = "#30363D";
const TEXT = "#F0F6FC";
const TEXT_MUTED = "#8B949E";
const POS = palette.POSITIVE; // #3FB950
const NEG = palette.NEGATIVE; // #F85149

const meta: Meta = {
  title: "Temp/Chart Compare",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    backgrounds: { default: "dark" },
    docs: {
      description: {
        component:
          "Side-by-side ECharts (ReplayChart) vs TradingView Lightweight Charts (TradingViewChart) — same 375×1m RELIANCE candles (2026-03-20). Dense 8pt, BG #0D1117 / SURFACE #161B22 / BORDER #30363D, no blue. Top controls: Long/Short add trade markers, Trend toggles annotation, Play/Pause scrubs candles in sync.",
      },
    },
  },
};
export default meta;

// ---- dataset: 375 candles ----
const baseCandles: ReplayCandle[] = (oneDayReal as any[]).map((c: any) => ({
  time: c.time,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
  volume: c.volume,
})) as ReplayCandle[];

function ChartCompareInner() {
  let chartRef: ReplayChartHandle | undefined;
  const [currentIdx, setCurrentIdx] = createSignal(120);
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [speed, setSpeed] = createSignal(400);
  const [trades, setTrades] = createSignal<ReplayTrade[]>([
    {
      id: 1,
      symbol: "RELIANCE",
      entry_time: baseCandles[60]?.time ?? "2026-03-20 10:15",
      exit_time: baseCandles[90]?.time ?? "2026-03-20 10:45",
      entry_price: baseCandles[60]?.close ?? 1415,
      exit_price: baseCandles[90]?.close ?? 1425,
      quantity: 10,
      side: "BUY",
      pnl: 100,
      pnl_pct: 0.7,
      exit_reason: "TP",
      strategy: "ORB",
    } as any,
  ]);
  const [activeTool, setActiveTool] = createSignal<"none" | "long" | "short" | "trend">("none");
  const [trendOn, setTrendOn] = createSignal(false);

  const visibleCandles = createMemo(() => baseCandles.slice(0, Math.max(10, Math.min(currentIdx(), baseCandles.length))));
  const visibleBySymbol = createMemo(() => ({ RELIANCE: visibleCandles() }));
  const currentCandle = () => visibleCandles()[visibleCandles().length - 1];

  // sync play
  createEffect(() => {
    if (!isPlaying()) return;
    const id = window.setInterval(() => {
      setCurrentIdx((v) => {
        if (v >= baseCandles.length) {
          setIsPlaying(false);
          return v;
        }
        return v + 1;
      });
    }, speed());
    onCleanup(() => window.clearInterval(id));
  });

  const handlePlayPause = () => {
    if (currentIdx() >= baseCandles.length) setCurrentIdx(60);
    setIsPlaying((v) => !v);
  };

  const addTrade = (side: "BUY" | "SELL") => {
    const price = currentCandle()?.close ?? baseCandles[0].close;
    const time = currentCandle()?.time ?? baseCandles[0].time;
    const id = Date.now();
    const tr: any = {
      id,
      symbol: "RELIANCE",
      entry_time: time,
      exit_time: "",
      entry_price: price,
      exit_price: null,
      quantity: 10,
      side,
      pnl: 0,
      pnl_pct: 0,
      exit_reason: "OPEN",
      strategy: side === "BUY" ? "Long" : "Short",
    };
    setTrades((prev) => [...prev, tr as ReplayTrade]);
    setActiveTool(side === "BUY" ? "long" : "short");
  };

  const handleTrend = () => {
    setTrendOn((v) => !v);
    setActiveTool((prev) => (prev === "trend" ? "none" : "trend"));
  };

  const handleClear = () => {
    setTrades([]);
    setTrendOn(false);
    setActiveTool("none");
  };

  const btnClass = (on: boolean, accent: string) =>
    `text-[11px] h-5 min-w-0 px-2 border rounded-none transition-colors duration-200 ${
      on
        ? `bg-[#21262D] text-[#F0F6FC] border-${accent} hover:bg-[#21262D] hover:border-${accent}`
        : `bg-transparent text-[#8B949E] border-[#30363D] hover:bg-[#21262D] hover:border-[#F0F6FC]`
    }`;

  return (
    <Box className="h-[100vh] flex flex-col overflow-hidden" style={{ "background-color": BG }}>
      {/* Toolbar — 48px, dense, 8pt */}
      <Paper
        className="flex items-center gap-2 px-3 h-12 min-h-[48px] border-b border-[#30363D] shrink-0 rounded-none"
        style={{ "background-color": SURFACE }}
      >
        <Text className="text-[11px] font-bold tracking-[0.6px]" style={{ color: TEXT_MUTED }}>
          CHART COMPARE
        </Text>
        <Chip
          size="xs"
          label="RELIANCE · 1m · 375"
          className="text-[10px] h-5 ml-2 border border-[#30363D]"
          style={{ "background-color": SURFACE_ALT, color: TEXT }}
        />
        <div className="w-[1px] h-[18px] bg-[#30363D] mx-1.5" />

        <Tooltip label="Add Long marker at current candle">
          <Button
            size="xs"
            variant={activeTool() === "long" ? "filled" : "outline"}
            color="positive"
            onClick={() => addTrade("BUY")}
            className={btnClass(activeTool() === "long", "#3FB950")}
            style={{
              "border-color": activeTool() === "long" ? POS : BORDER,
              "background-color": activeTool() === "long" ? SURFACE_ALT : "transparent",
              color: activeTool() === "long" ? POS : TEXT_MUTED,
              "min-width": 52,
            }}
          >
            Long
          </Button>
        </Tooltip>
        <Tooltip label="Add Short marker at current candle">
          <Button
            size="xs"
            variant={activeTool() === "short" ? "filled" : "outline"}
            color="negative"
            onClick={() => addTrade("SELL")}
            className={btnClass(activeTool() === "short", "#F85149")}
            style={{
              "border-color": activeTool() === "short" ? NEG : BORDER,
              "background-color": activeTool() === "short" ? SURFACE_ALT : "transparent",
              color: activeTool() === "short" ? NEG : TEXT_MUTED,
              "min-width": 56,
            }}
          >
            Short
          </Button>
        </Tooltip>
        <Tooltip label="Toggle Trend line (visual on both panes)">
          <Button
            size="xs"
            variant={trendOn() ? "filled" : "outline"}
            color="primary"
            onClick={handleTrend}
            className={btnClass(trendOn(), "#58A6FF")}
            style={{ "min-width": 56 }}
          >
            Trend
          </Button>
        </Tooltip>
        <Button
          size="xs"
          variant="outline"
          color="secondary"
          onClick={handleClear}
          className="text-[10px] h-5 min-w-[48px] px-2 border border-[#30363D] text-[#8B949E]"
        >
          Clear
        </Button>

        <div className="w-[1px] h-[18px] bg-[#30363D] mx-1.5" />

        <Tooltip label={isPlaying() ? "Pause" : "Play"}>
          <ActionIcon
            size="sm"
            onClick={handlePlayPause}
            className="border border-[#30363D] bg-[#21262D] text-[#F0F6FC] w-6 h-6"
          >
            <Show when={isPlaying()} fallback={<IconPlayerPlay size={14} />}><IconPlayerPause size={14} /></Show>
          </ActionIcon>
        </Tooltip>
        <Text className="text-[10px] text-[#8B949E] min-w-[72px]">
          {visibleCandles().length} / {baseCandles.length}
        </Text>
        <input
          type="range"
          min={10}
          max={baseCandles.length}
          value={currentIdx()}
          onChange={(e) => setCurrentIdx(Number(e.target.value))}
          className="flex-1 max-w-[420px] accent-[#8B949E] h-1.5 bg-transparent cursor-pointer"
          style={{ color: TEXT_MUTED }}
        />
        <div className="flex gap-1 ml-1">
          <For each={[800, 400, 200]}>{(s) => (
            <Button
              key={s}
              size="xs"
              variant={speed() === s ? "filled" : "outline"}
              color="secondary"
              onClick={() => setSpeed(s)}
              className={`text-[10px] h-5 min-w-[32px] px-0 border rounded-none ${
                speed() === s
                  ? "bg-[#21262D] text-[#F0F6FC] border-[#F0F6FC]"
                  : "bg-transparent text-[#8B949E] border-[#30363D]"
              }`}
            >
              {s === 800 ? "1x" : s === 400 ? "2x" : "4x"}
            </Button>
          )}</For>
        </div>

        <Box className="flex-1" />
        <Chip size="xs" label={`${trades().length} markers`} className="text-[10px] h-5 text-[#8B949E] border border-[#30363D]" style={{ "background-color": SURFACE_ALT }} />
      </Paper>

      {/* Info bar — 20px dense */}
      <Box
        className="flex items-center gap-2 px-3 h-5 min-h-[20px] border-b border-[#30363D] shrink-0"
        style={{ "background-color": SURFACE }}
      >
        <Text className="text-[10px] text-[#8B949E]" style={{ "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
          {currentCandle() ? `O ${currentCandle()!.open} H ${currentCandle()!.high} L ${currentCandle()!.low} C ${currentCandle()!.close} V ${currentCandle()!.volume}` : "—"} · {trendOn() ? "Trend on" : "Trend off"} · Long/Short adds BUY/SELL markers to both panes
        </Text>
        <Box className="flex-1" />
        <Text className="text-[10px] text-[#8B949E]">
          ECharts left · TradingView right · same data
        </Text>
      </Box>

      {/* Side-by-side panes — 8pt gap */}
      <Box className="flex-1 min-h-0 flex gap-2 p-1 overflow-hidden">
        {/* Left: ECharts via ReplayChart */}
        <Paper
          className="flex-1 min-w-0 flex flex-col overflow-hidden border border-[#30363D] rounded-sm bg-[#161B22]"
        >
          <Box
            className="flex items-center gap-2 px-1 h-6 min-h-[24px] border-b border-[#30363D] shrink-0"
            style={{ "background-color": SURFACE_ALT }}
          >
            <Text className="text-[10px] font-medium tracking-[0.5px]" style={{ color: TEXT_MUTED }}>
              ECHARTS
            </Text>
            <Chip size="xs" label="ReplayChart" className="text-[10px] h-4 border border-[#30363D]" style={{ "background-color": BG, color: TEXT_MUTED }} />
            <Box className="flex-1" />
            <Text className="text-[10px] text-[#8B949E]">{visibleCandles().length} candles</Text>
          </Box>
          <Box className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <ReplayChart
              ref={(value) => (chartRef = value)}
              candlesBySymbol={visibleBySymbol() as any}
              trades={trades() as any}
              orLevels={[]}
              pivotLevels={[]}
              high52wLevels={[]}
              emaData={{}}
              selectedSymbol="RELIANCE"
              setSelectedSymbol={() => {}}
              chartOptions={{ show_all_trades: true, show_orb_zones: false, show_pivot_levels: false, show_52w_high: false, show_ema: false } as any}
              setChartOptions={() => {}}
              highlightedTradeId={null}
            />
            <Show when={trendOn()}>
              <Box className="px-1 py-[12px] border-t border-[#30363D] shrink-0" style={{ "background-color": SURFACE_ALT }}>
                <Text className="text-[10px] text-[#8B949E]">
                  Trend: {visibleCandles()[20]?.close?.toFixed(2) ?? "—"} → {currentCandle()?.close?.toFixed(2) ?? "—"} (draw on TV pane with Trend button inside chart)
                </Text>
              </Box>
            </Show>
          </Box>
        </Paper>

        {/* Right: TradingView Lightweight Charts */}
        <Paper
          className="flex-1 min-w-0 flex flex-col overflow-hidden border border-[#30363D] rounded-sm bg-[#161B22]"
        >
          <Box
            className="flex items-center gap-2 px-1 h-6 min-h-[24px] border-b border-[#30363D] shrink-0"
            style={{ "background-color": SURFACE_ALT }}
          >
            <Text className="text-[10px] font-medium tracking-[0.5px]" style={{ color: TEXT_MUTED }}>
              TRADINGVIEW
            </Text>
            <Chip size="xs" label="Lightweight Charts" className="text-[10px] h-4 border border-[#30363D]" style={{ "background-color": BG, color: TEXT_MUTED }} />
            <Box className="flex-1" />
            <Text className="text-[10px] text-[#8B949E]">markers + tools</Text>
          </Box>
          <Box className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <TradingViewChart candles={visibleCandles()} trades={trades() as any} highlightedTradeId={null} height={420} />
          </Box>
        </Paper>
      </Box>

      {/* Bottom meta — 20px dense */}
      <Box
        className="flex items-center gap-2 px-3 h-5 min-h-[20px] border-t border-[#30363D] shrink-0"
        style={{ "background-color": SURFACE }}
      >
        <Text className="text-[10px] text-[#8B949E]">
          {baseCandles.length} candles · {baseCandles[0].time} → {baseCandles[baseCandles.length - 1].time} · 1m · same data both panes
        </Text>
        <Box className="flex-1" />
        <Text className="text-[10px] text-[#8B949E]">
          Dense 8pt · BG {BG} · SURFACE {SURFACE} · BORDER {BORDER} · no blue
        </Text>
      </Box>
    </Box>
  );
}

export const Default: StoryObj = {
  render: () => <ChartCompareInner />,
  parameters: { layout: "fullscreen" },
};

export const FullScreen: StoryObj = {
  render: () => <ChartCompareInner />,
  parameters: { layout: "fullscreen" },
};
