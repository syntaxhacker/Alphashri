import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, useMemo, useRef, useEffect } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Slider from "@mui/material/Slider";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Tooltip from "@mui/material/Tooltip";
import { IconPlayerPlay, IconPlayerPause, IconShoppingCart, IconTrendingUp, IconVolume } from "@tabler/icons-react";
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
  const [selectedSymbol, setSelectedSymbol] = useState("RELIANCE");
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(800);
  const [currentIdx, setCurrentIdx] = useState(60);
  const [tf, setTf] = useState(1);
  const [showVolume, setShowVolume] = useState(true);
  const [useTV, setUseTV] = useState(true);
  const [orderQty, setOrderQty] = useState(10);
  const [orderSide, setOrderSide] = useState<"BUY" | "SELL">("BUY");
  const chartRef = useRef<ReplayChartHandle>(null);

  const filteredTrades = useMemo(() => (showAll ? mockTrades : mockTrades.filter((t: any) => t.symbol === selectedSymbol)), [showAll, selectedSymbol]);
  const visibleCandles = useMemo(() => {
    const all = candlesBySymbol[selectedSymbol] ?? baseCandles;
    return all.slice(0, Math.max(10, Math.min(currentIdx, all.length)));
  }, [selectedSymbol, currentIdx]);
  const visibleBySymbol = useMemo(() => ({ [selectedSymbol]: visibleCandles }), [selectedSymbol, visibleCandles]);
  const currentCandle = visibleCandles[visibleCandles.length - 1];
  const visibleTrades = useMemo(() => {
    if (!currentCandle) return filteredTrades;
    return filteredTrades.filter((t: any) => t.entry_time <= currentCandle.time);
  }, [filteredTrades, currentCandle]);

  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      setCurrentIdx((v) => {
        const len = candlesBySymbol[selectedSymbol]?.length ?? baseCandles.length;
        if (v >= len) {
          setIsPlaying(false);
          return v;
        }
        return v + 1;
      });
    }, speed);
    return () => window.clearInterval(id);
  }, [isPlaying, speed, selectedSymbol]);

  const handlePlayPause = () => {
    if (currentIdx >= (candlesBySymbol[selectedSymbol]?.length ?? baseCandles.length)) {
      setCurrentIdx(60);
    }
    setIsPlaying((v) => !v);
  };

  const handleTf = (min: number) => {
    setTf(min);
    chartRef.current?.setTimeframe(min);
  };

  const handleTradeClick = (tradeId: number) => {
    setHighlighted(tradeId);
    const tr = mockTrades.find((t: any) => t.id === tradeId);
    if (tr) chartRef.current?.zoomToTrade(tr.entry_time, tr.exit_time);
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

  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", bgcolor: palette.BG, overflow: "hidden" }}>
      {/* Toolbar — 48px like TradingView top */}
      <Paper elevation={0} sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, height: 48, minHeight: 48, borderBottom: 1, borderColor: palette.BORDER, bgcolor: palette.SURFACE, borderRadius: 0, flexShrink: 0 }}>
        <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: palette.TEXT_MUTED }}>REPLAY</Typography>
        <Box sx={{ display: "flex", gap: 0.5, ml: 1 }}>
          {mockSymbols.map((s) => (
            <Button
              key={s}
              size="small"
              variant={selectedSymbol === s ? "contained" : "outlined"}
              color="inherit"
              onClick={() => { setSelectedSymbol(s); setCurrentIdx(candlesBySymbol[s].length); }}
              sx={{ fontSize: 11, height: 24, minWidth: 64, borderColor: palette.BORDER, bgcolor: selectedSymbol === s ? palette.SURFACE_ALT : "transparent", color: selectedSymbol === s ? palette.TEXT : palette.TEXT_MUTED }}
            >
              {s}
            </Button>
          ))}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, ml: 1, borderLeft: 1, borderColor: palette.BORDER, pl: 1 }}>
          <Chip size="small" label={currentCandle ? `O ${currentCandle.open} H ${currentCandle.high} L ${currentCandle.low} C ${currentCandle.close} V ${currentCandle.volume}` : "—"} sx={{ fontSize: 10, height: 20, bgcolor: palette.SURFACE_ALT, color: palette.TEXT, border: 1, borderColor: palette.BORDER }} />
        </Box>
        <Box sx={{ flex: 1 }} />
        <Chip size="small" label={`${filteredTrades.length} trades`} sx={{ fontSize: 11, height: 20, bgcolor: palette.SURFACE_ALT, color: palette.TEXT_MUTED, border: 1, borderColor: palette.BORDER }} />
        <Button size="small" variant={highlighted ? "contained" : "outlined"} color="inherit" onClick={() => setHighlighted(null)} sx={{ fontSize: 11, height: 24, borderColor: palette.BORDER }}>Clear highlight</Button>
      </Paper>

      {/* Playback bar — candles scrub + play/pause + speed + volume + buy/sell */}
      <Paper elevation={0} sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, borderBottom: 1, borderColor: palette.BORDER, bgcolor: palette.SURFACE, flexShrink: 0 }}>
        <Tooltip title={isPlaying ? "Pause" : "Play"}>
          <IconButton size="small" onClick={handlePlayPause} sx={{ border: 1, borderColor: palette.BORDER, bgcolor: palette.SURFACE_ALT, color: palette.TEXT }}>
            {isPlaying ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />}
          </IconButton>
        </Tooltip>
        <Typography variant="caption" sx={{ fontSize: 10, color: palette.TEXT_MUTED, minWidth: 56 }}>{visibleCandles.length} / {candlesBySymbol[selectedSymbol].length} candles</Typography>
        <Slider size="small" min={10} max={candlesBySymbol[selectedSymbol].length} value={currentIdx} onChange={(_, v) => setCurrentIdx(v as number)} sx={{ flex: 1, maxWidth: 420, color: palette.TEXT_MUTED, "& .MuiSlider-thumb": { width: 10, height: 10 } }} />
        <Box sx={{ display: "flex", gap: 0.5, border: 1, borderColor: palette.BORDER, borderRadius: 1, overflow: "hidden", height: 28 }}>
          {[1, 5, 15, 60, 1440].map((m) => (
            <Button
              key={m}
              size="small"
              onClick={() => handleTf(m)}
              variant={tf === m ? "contained" : "text"}
              color="inherit"
              sx={{ fontSize: 10, minWidth: 32, p: 0, borderRadius: 0, bgcolor: tf === m ? palette.SURFACE_ALT : "transparent", color: tf === m ? palette.TEXT : palette.TEXT_MUTED }}
            >
              {m === 60 ? "1h" : m === 1440 ? "1D" : `${m}m`}
            </Button>
          ))}
        </Box>
        <FormControl size="small" sx={{ minWidth: 80 }}><InputLabel sx={{ fontSize: 10 }}>Speed</InputLabel><Select size="small" value={String(speed)} label="Speed" onChange={(e) => setSpeed(Number(e.target.value))} sx={{ fontSize: 11, height: 28, color: palette.TEXT }}><MenuItem value={1500} sx={{ fontSize: 11 }}>0.5x</MenuItem><MenuItem value={800} sx={{ fontSize: 11 }}>1x</MenuItem><MenuItem value={400} sx={{ fontSize: 11 }}>2x</MenuItem><MenuItem value={200} sx={{ fontSize: 11 }}>5x</MenuItem></Select></FormControl>
        <Tooltip title="Toggle volume pane"><IconButton size="small" onClick={() => setShowVolume((v) => !v)} sx={{ border: 1, borderColor: showVolume ? palette.TEXT : palette.BORDER, color: showVolume ? palette.TEXT : palette.TEXT_MUTED }}><IconVolume size={14} /></IconButton></Tooltip>
        <Button size="small" variant={useTV ? "contained" : "outlined"} color="inherit" onClick={() => setUseTV((v) => !v)} sx={{ fontSize: 10, height: 24, borderColor: palette.BORDER, bgcolor: useTV ? palette.SURFACE_ALT : "transparent" }}>{useTV ? "TV" : "ECharts"}</Button>
        <Box sx={{ width: 1, height: 20, bgcolor: palette.BORDER, mx: 0.5 }} />
        <FormControl size="small" sx={{ minWidth: 70 }}><Select size="small" value={orderSide} onChange={(e) => setOrderSide(e.target.value as any)} sx={{ fontSize: 11, height: 28, color: orderSide === "BUY" ? palette.POSITIVE : palette.NEGATIVE, fontWeight: 700 }}><MenuItem value="BUY" sx={{ fontSize: 11, color: palette.POSITIVE }}>BUY</MenuItem><MenuItem value="SELL" sx={{ fontSize: 11, color: palette.NEGATIVE }}>SELL</MenuItem></Select></FormControl>
        <TextField size="small" type="number" value={orderQty} onChange={(e) => setOrderQty(Math.max(1, Number(e.target.value) || 1))} sx={{ width: 64, "& input": { fontSize: 11, p: "6px 8px", color: palette.TEXT } }} />
        <TextField size="small" value={currentCandle ? currentCandle.close : ""} placeholder="Price" sx={{ width: 80, "& input": { fontSize: 11, p: "6px 8px", color: palette.TEXT } }} />
        <Button size="small" variant="contained" startIcon={orderSide === "BUY" ? <IconTrendingUp size={12} /> : <IconShoppingCart size={12} />} sx={{ fontSize: 11, height: 28, minWidth: 72, bgcolor: orderSide === "BUY" ? palette.POSITIVE : palette.NEGATIVE, color: "#fff", "&:hover": { bgcolor: orderSide === "BUY" ? palette.POSITIVE : palette.NEGATIVE, opacity: 0.9 } }} onClick={() => {
          const price = currentCandle?.close ?? 0;
          const tr: any = { id: Date.now(), symbol: selectedSymbol, entry_time: currentCandle?.time ?? "", exit_time: "", entry_price: price, exit_price: null, quantity: orderQty, side: orderSide, pnl: 0, pnl_pct: 0, exit_reason: "OPEN", strategy: "Manual" };
          mockTrades.push(tr);
        }}>{orderSide}</Button>
      </Paper>

      {/* Chart — flex 1, TradingView-like */}
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", p: 1, gap: 0.5, overflow: "hidden" }}>
        <Paper elevation={0} sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", border: 1, borderColor: palette.BORDER, borderRadius: 1, bgcolor: palette.SURFACE }}>
          {useTV ? (
            <TradingViewChart candles={visibleCandles} trades={visibleTrades as any} highlightedTradeId={highlighted} height={420} />
          ) : (
            <ReplayChart
              ref={chartRef}
              candlesBySymbol={visibleBySymbol as any}
              trades={visibleTrades as any}
              orLevels={[]}
              pivotLevels={[]}
              high52wLevels={[]}
              emaData={{}}
              selectedSymbol={selectedSymbol}
              setSelectedSymbol={setSelectedSymbol}
              chartOptions={{ show_all_trades: true, show_orb_zones: false, show_pivot_levels: false, show_52w_high: false, show_ema: showVolume } as any}
              setChartOptions={() => {}}
              highlightedTradeId={highlighted}
              onTradeClick={handleTradeClick}
            />
          )}
        </Paper>
      </Box>

      {/* Trade table — 200px dense */}
      <Box sx={{ height: 220, flexShrink: 0, p: 1, pt: 0, display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Paper elevation={0} sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", border: 1, borderColor: palette.BORDER, borderRadius: 1, bgcolor: palette.SURFACE }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, borderBottom: 1, borderColor: palette.BORDER, bgcolor: palette.SURFACE_ALT, height: 28, flexShrink: 0 }}>
            <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: palette.TEXT_MUTED }}>TRADES — click row to zoom chart</Typography>
            <Box sx={{ flex: 1 }} />
            <Button size="small" variant={showAll ? "contained" : "outlined"} color="inherit" onClick={() => setShowAll((v) => !v)} sx={{ fontSize: 10, height: 20, borderColor: palette.BORDER }}>{showAll ? "All" : "Symbol only"}</Button>
          </Box>
          <Box sx={{ flex: 1, overflow: "auto" }}>
            <TanStackTable
              data={filteredTrades as any}
              columns={columns as any}
              enableSorting
              stickyHeader
              getRowTestId={(r: any) => `trade-row-${r.id}`}
              getRowStyle={(r: any) => (highlighted === r.id ? { background: palette.SURFACE_ALT } : undefined)}
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
