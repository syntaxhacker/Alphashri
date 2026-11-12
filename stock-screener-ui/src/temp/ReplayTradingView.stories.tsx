import type { Meta, StoryObj } from "@storybook/react-vite";
import { For, Show, createMemo, createSignal, createEffect, onCleanup } from "solid-js";
import { Box, Paper, Button, ActionIcon, Text, Chip, TextInput, Select, Tooltip } from "@/ui";
import { IconPlayerPlay, IconPlayerPause, IconVolume } from "@tabler/icons-react";
import * as palette from "@/ui/palette";
import { ReplayChart, type ReplayChartHandle } from "@/components/replay/ReplayChart";
import { TradingViewChart } from "@/components/chart/TradingViewChart";
import { TanStackTable } from "@/components/common/TanStackTable";
import oneDayReal from "./oneDayCandles.json";
import type { ReplayTrade, ReplayCandle } from "@/types/replay";

const meta: Meta = {
  title: "Temp/Replay TradingView",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    backgrounds: { default: "dark" },
    docs: { description: { component: "Full-screen ECharts Replay — TradingView-like. Top toolbar (symbol/TF), center candlestick+volume+markers, bottom trade table. Click trade row → chart zooms. Use to test trades visually." } },
  },
};
export default meta;

// ---- real one-day data via Upstox historical (1m, 2026-03-20 RELIANCE 375 candles) ----
const baseCandles: ReplayCandle[] = (oneDayReal as any[]).map((c: any) => ({
  time: c.time,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
  volume: c.volume,
})) as ReplayCandle[];

const mockSymbols = ["RELIANCE", "TCS", "INFY"];
const candlesBySymbol: Record<string, ReplayCandle[]> = {
  RELIANCE: baseCandles,
  TCS: baseCandles.map((c) => ({ ...c, open: c.open - 200, high: c.high - 200, low: c.low - 200, close: c.close - 200 })),
  INFY: baseCandles.map((c) => ({ ...c, open: c.open - 50, high: c.high - 50, low: c.low - 50, close: c.close - 50 })),
};

const mockTrades: ReplayTrade[] = [
  { id: 1, symbol: "RELIANCE", entry_time: "2026-03-20 09:30", exit_time: "2026-03-20 10:15", entry_price: 1412, exit_price: 1425, quantity: 10, side: "BUY", pnl: 130, pnl_pct: 0.92, exit_reason: "TP", strategy: "ORB" } as any,
  { id: 2, symbol: "RELIANCE", entry_time: "2026-03-20 11:00", exit_time: "2026-03-20 13:30", entry_price: 1428, exit_price: 1415, quantity: 10, side: "BUY", pnl: -130, pnl_pct: -0.91, exit_reason: "SL", strategy: "ORB" } as any,
  { id: 3, symbol: "TCS", entry_time: "2026-03-20 10:00", exit_time: "2026-03-20 11:30", entry_price: 3210, exit_price: 3245, quantity: 5, side: "BUY", pnl: 175, pnl_pct: 1.09, exit_reason: "TP", strategy: "EMA" } as any,
  { id: 4, symbol: "INFY", entry_time: "2026-03-20 09:45", exit_time: "2026-03-20 12:00", entry_price: 1365, exit_price: 1352, quantity: 8, side: "SELL", pnl: 104, pnl_pct: 0.95, exit_reason: "TP", strategy: "SR" } as any,
];

function FullScreenReplay() {
  const [selectedSymbol, setSelectedSymbol] = createSignal("RELIANCE");
  const [highlighted, setHighlighted] = createSignal<number | null>(null);
  const [showAll, setShowAll] = createSignal(true);
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [speed, setSpeed] = createSignal(800);
  const [currentIdx, setCurrentIdx] = createSignal(60);
  const [tf, setTf] = createSignal(1);
  const [showVolume, setShowVolume] = createSignal(true);
  const [useTV, setUseTV] = createSignal(true);
  const [orderQty, setOrderQty] = createSignal(10);
  const [orderSide, setOrderSide] = createSignal<"BUY" | "SELL">("BUY");
  let chartRef: ReplayChartHandle | undefined;

  const filteredTrades = createMemo(() => (showAll() ? mockTrades : mockTrades.filter((t: any) => t.symbol === selectedSymbol())));
  const visibleCandles = createMemo(() => {
    const all = candlesBySymbol[selectedSymbol()] ?? baseCandles;
    return all.slice(0, Math.max(10, Math.min(currentIdx(), all.length)));
  });
  const visibleBySymbol = createMemo(() => ({ [selectedSymbol()]: visibleCandles() }));
  const currentCandle = () => visibleCandles()[visibleCandles().length - 1];
  const visibleTrades = createMemo(() => {
    const candle = currentCandle();
    if (!candle) return filteredTrades();
    return filteredTrades().filter((t: any) => t.entry_time <= candle.time);
  });

  createEffect(() => {
    if (!isPlaying()) return;
    const id = window.setInterval(() => {
      setCurrentIdx((v) => {
        const len = candlesBySymbol[selectedSymbol()]?.length ?? baseCandles.length;
        if (v >= len) {
          setIsPlaying(false);
          return v;
        }
        return v + 1;
      });
    }, speed());
    onCleanup(() => window.clearInterval(id));
  });

  const handlePlayPause = () => {
    if (currentIdx() >= (candlesBySymbol[selectedSymbol()]?.length ?? baseCandles.length)) {
      setCurrentIdx(60);
    }
    setIsPlaying((v) => !v);
  };

  const handleTf = (min: number) => {
    setTf(min);
    chartRef?.setTimeframe(min);
  };

  const handleTradeClick = (tradeId: number) => {
    setHighlighted(tradeId);
    const tr = mockTrades.find((t: any) => t.id === tradeId);
    if (tr) chartRef?.zoomToTrade(tr.entry_time, tr.exit_time);
  };

  const columns = [
    { id: "symbol", header: "Symbol", accessorKey: "symbol" as const },
    { id: "side", header: "Side", accessorKey: "side" as const },
    { id: "entry_price", header: "Entry", accessorKey: "entry_price" as const },
    { id: "exit_price", header: "Exit", accessorKey: "exit_price" as const },
    { id: "pnl", header: "P&L", accessorKey: "pnl" as const },
    { id: "pnl_pct", header: "P&L %", accessorKey: "pnl_pct" as const },
    { id: "exit_reason", header: "Exit", accessorKey: "exit_reason" as const },
    { id: "entry_time", header: "Entry Time", accessorKey: "entry_time" as const },
  ];

  const tfBtnClass = (active: boolean) =>
    `text-[10px] min-w-[32px] px-0 border-none rounded-none transition-colors ${
      active ? "bg-[#21262D] text-[#F0F6FC]" : "bg-transparent text-[#8B949E] hover:bg-[#21262D] hover:text-[#F0F6FC]"
    }`;

  const symbolBtnClass = (active: boolean) =>
    `text-[11px] h-6 min-w-[64px] border border-[#30363D] transition-colors ${
      active
        ? `bg-[#21262D] text-[#F0F6FC] border-[#30363D]`
        : "bg-transparent text-[#8B949E] border-[#30363D] hover:bg-[#21262D] hover:text-[#F0F6FC]"
    }`;

  return (
    <Box className="h-[100vh] flex flex-col overflow-hidden" style={{ "background-color": palette.BG }}>
      {/* Toolbar — 48px like TradingView top */}
      <Paper
        className="flex items-center gap-2 px-3 h-12 min-h-[48px] border-b border-[#30363D] shrink-0 rounded-none"
        style={{ "background-color": palette.SURFACE }}
      >
        <Text className="text-[11px] font-bold tracking-[0.5px]" style={{ color: palette.TEXT_MUTED }}>
          REPLAY
        </Text>
        <Box className="flex gap-1 ml-2">
          <For each={mockSymbols}>{(s) => (
            <Button
              key={s}
              size="xs"
              variant={selectedSymbol() === s ? "filled" : "outline"}
              color="secondary"
              onClick={() => { setSelectedSymbol(s); setCurrentIdx(candlesBySymbol[s].length); }}
              className={symbolBtnClass(selectedSymbol() === s)}
            >
              {s}
            </Button>
          )}</For>
        </Box>
        <div className="flex items-center gap-1 ml-2 border-l border-[#30363D] pl-2">
          <Chip
            size="xs"
            label={currentCandle() ? `O ${currentCandle()!.open} H ${currentCandle()!.high} L ${currentCandle()!.low} C ${currentCandle()!.close} V ${currentCandle()!.volume}` : "—"}
            className="text-[10px] h-5 text-[#F0F6FC] border border-[#30363D]"
            style={{ "background-color": palette.SURFACE_ALT }}
          />
        </div>
        <Box className="flex-1" />
        <Chip size="xs" label={`${filteredTrades().length} trades`} className="text-[11px] h-5 text-[#8B949E] border border-[#30363D]" style={{ "background-color": palette.SURFACE_ALT }} />
        <Button size="xs" variant={highlighted() ? "filled" : "outline"} color="secondary" onClick={() => setHighlighted(null)} className="text-[11px] h-6 border border-[#30363D]">
          Clear highlight
        </Button>
      </Paper>

      {/* Playback bar — candles scrub + play/pause + speed + volume + buy/sell */}
      <Paper
        className="flex items-center gap-2 px-3 py-1 border-b border-[#30363D] shrink-0"
        style={{ "background-color": palette.SURFACE }}
      >
        <Tooltip label={isPlaying() ? "Pause" : "Play"}>
          <ActionIcon size="sm" onClick={handlePlayPause} className="border border-[#30363D] bg-[#21262D] text-[#F0F6FC] w-8 h-8">
            <Show when={isPlaying()} fallback={<IconPlayerPlay size={14} />}><IconPlayerPause size={14} /></Show>
          </ActionIcon>
        </Tooltip>
        <Text className="text-[10px] text-[#8B949E] min-w-[56px]">{visibleCandles().length} / {candlesBySymbol[selectedSymbol()].length} candles</Text>
        <input
          type="range"
          min={10}
          max={candlesBySymbol[selectedSymbol()].length}
          value={currentIdx()}
          onChange={(e) => setCurrentIdx(Number(e.target.value))}
          className="flex-1 max-w-[420px] accent-[#8B949E] h-1.5 bg-transparent cursor-pointer"
        />
        <div className="flex gap-1 border border-[#30363D] rounded-sm overflow-hidden h-7">
          <For each={[1, 5, 15, 60, 1440]}>{(m) => (
            <Button
              key={m}
              size="xs"
              onClick={() => handleTf(m)}
              variant={tf() === m ? "filled" : "text"}
              color="secondary"
              className={tfBtnClass(tf() === m)}
            >
              {m === 60 ? "1h" : m === 1440 ? "1D" : `${m}m`}
            </Button>
          )}</For>
        </div>
        <div className="flex items-center gap-2 min-w-[80px]">
          <Text className="text-[10px] text-[#8B949E]">Speed</Text>
          <Select
            size="xs"
            value={String(speed())}
            onChange={(v) => setSpeed(Number(v ?? 800))}
            data={[
              { value: "1500", label: "0.5x" },
              { value: "800", label: "1x" },
              { value: "400", label: "2x" },
              { value: "200", label: "5x" },
            ]}
            className="text-[11px] h-7 w-full"
            style={{ color: palette.TEXT }}
          />
        </div>
        <Tooltip label="Toggle volume pane">
          <ActionIcon size="sm" onClick={() => setShowVolume((v) => !v)} className={`border border-[#30363D] ${showVolume() ? "text-[#F0F6FC]" : "text-[#8B949E]"} w-8 h-8`}>
            <IconVolume size={14} />
          </ActionIcon>
        </Tooltip>
        <Button
          size="xs"
          variant={useTV() ? "filled" : "outline"}
          color="secondary"
          onClick={() => setUseTV((v) => !v)}
          className="text-[10px] h-6 border border-[#30363D]"
          style={{ "background-color": useTV() ? palette.SURFACE_ALT : "transparent" }}
        >
          {useTV() ? "TV" : "ECharts"}
        </Button>
        <div className="w-[1px] h-5 bg-[#30363D] mx-1" />
        <div className="flex items-center gap-2 min-w-[70px]">
          <Select
            size="xs"
            value={orderSide()}
            onChange={(v) => setOrderSide(v as any)}
            data={[
              { value: "BUY", label: "BUY" },
              { value: "SELL", label: "SELL" },
            ]}
            className="text-[11px] h-7 w-full font-bold"
            style={{ color: orderSide() === "BUY" ? palette.POSITIVE : palette.NEGATIVE }}
          />
        </div>
        <TextInput
          size="xs"
          type="number"
          value={String(orderQty())}
          onChange={(v) => setOrderQty(Math.max(1, Number(v) || 1))}
          className="w-[64px] text-[11px] px-2 py-1.5 text-[#F0F6FC] border border-[#30363D] rounded-sm"
          style={{ "background-color": palette.SURFACE_ALT }}
        />
        <TextInput
          size="xs"
          value={currentCandle() ? String(currentCandle()!.close) : ""}
          placeholder="Price"
          className="w-[80px] text-[11px] px-2 py-1.5 text-[#F0F6FC] border border-[#30363D] rounded-sm"
          style={{ "background-color": palette.SURFACE_ALT }}
        />
        <Button
          size="xs"
          variant="filled"
          color={orderSide() === "BUY" ? "positive" : "negative"}
          onClick={() => {
            const price = currentCandle()?.close ?? 0;
            const tr: any = { id: Date.now(), symbol: selectedSymbol(), entry_time: currentCandle()?.time ?? "", exit_time: "", entry_price: price, exit_price: null, quantity: orderQty(), side: orderSide(), pnl: 0, pnl_pct: 0, exit_reason: "OPEN", strategy: "Manual" };
            mockTrades.push(tr);
          }}
          className="text-[11px] h-7 min-w-[72px] rounded-none"
          style={{
            "background-color": orderSide() === "BUY" ? palette.POSITIVE : palette.NEGATIVE,
            color: "#fff",
            opacity: 1,
          }}
        >
          {orderSide()}
        </Button>
      </Paper>

      {/* Chart — flex 1, TradingView-like */}
      <Box className="flex-1 min-h-0 flex flex-col p-1 gap-1 overflow-hidden">
        <Paper
          className="flex-1 min-h-0 flex flex-col overflow-hidden border border-[#30363D] rounded-sm"
          style={{ "background-color": palette.SURFACE }}
        >
          <Show when={useTV()} fallback={
            <ReplayChart
              ref={(value) => (chartRef = value)}
              candlesBySymbol={visibleBySymbol() as any}
              trades={visibleTrades() as any}
              orLevels={[]}
              pivotLevels={[]}
              high52wLevels={[]}
              emaData={{}}
              selectedSymbol={selectedSymbol()}
              setSelectedSymbol={setSelectedSymbol}
              chartOptions={{ show_all_trades: true, show_orb_zones: false, show_pivot_levels: false, show_52w_high: false, show_ema: showVolume() } as any}
              setChartOptions={() => {}}
              highlightedTradeId={highlighted()}
              onTradeClick={handleTradeClick}
            />
          }>
            <TradingViewChart candles={visibleCandles()} trades={visibleTrades() as any} highlightedTradeId={highlighted()} height={420} />
          </Show>
        </Paper>
      </Box>

      {/* Trade table — 200px dense */}
      <Box className="h-[220px] shrink-0 p-1 pt-0 flex flex-col gap-1">
        <Paper
          className="flex-1 flex flex-col overflow-hidden border border-[#30363D] rounded-sm"
          style={{ "background-color": palette.SURFACE }}
        >
          <Box className="flex items-center gap-2 px-3 py-[12px] border-b border-[#30363D] shrink-0" style={{ "background-color": SURFACE_ALT, height: 28 }}>
            <Text className="text-[11px] font-bold tracking-[0.5px]" style={{ color: palette.TEXT_MUTED }}>
              TRADES — click row to zoom chart
            </Text>
            <Box className="flex-1" />
            <Button
              size="xs"
              variant={showAll() ? "filled" : "outline"}
              color="secondary"
              onClick={() => setShowAll((v) => !v)}
              className="text-[10px] h-5 border border-[#30363D]"
            >
              {showAll() ? "All" : "Symbol only"}
            </Button>
          </Box>
          <Box className="flex-1 overflow-auto">
            <TanStackTable
              data={filteredTrades() as any}
              columns={columns as any}
              enableSorting
              stickyHeader
              getRowTestId={(r: any) => `trade-row-${r.id}`}
              getRowStyle={(r: any) => (highlighted() === r.id ? { background: palette.SURFACE_ALT } : undefined)}
              onRowClick={(r: any) => handleTradeClick(r.id)}
            />
          </Box>
        </Paper>
      </Box>
    </Box>
  );
}

export const TradingView: StoryObj = {
  render: () => <FullScreenReplay />,
  parameters: { layout: "fullscreen" },
};

export const WithFilters: StoryObj = {
  render: () => <FullScreenReplay />,
  parameters: { layout: "fullscreen" },
};
