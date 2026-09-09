import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Slider from "@mui/material/Slider";
import Tooltip from "@mui/material/Tooltip";
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
  const chartRef = useRef<ReplayChartHandle>(null);
  const [currentIdx, setCurrentIdx] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(400);
  const [trades, setTrades] = useState<ReplayTrade[]>([
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
  const [activeTool, setActiveTool] = useState<"none" | "long" | "short" | "trend">("none");
  const [trendOn, setTrendOn] = useState(false);

  const visibleCandles = useMemo(() => baseCandles.slice(0, Math.max(10, Math.min(currentIdx, baseCandles.length))), [currentIdx]);
  const visibleBySymbol = useMemo(() => ({ RELIANCE: visibleCandles }), [visibleCandles]);
  const currentCandle = visibleCandles[visibleCandles.length - 1];

  // sync play
  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      setCurrentIdx((v) => {
        if (v >= baseCandles.length) {
          setIsPlaying(false);
          return v;
        }
        return v + 1;
      });
    }, speed);
    return () => window.clearInterval(id);
  }, [isPlaying, speed]);

  const handlePlayPause = () => {
    if (currentIdx >= baseCandles.length) setCurrentIdx(60);
    setIsPlaying((v) => !v);
  };

  const addTrade = (side: "BUY" | "SELL") => {
    const price = currentCandle?.close ?? baseCandles[0].close;
    const time = currentCandle?.time ?? baseCandles[0].time;
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

  const btnSx = (on: boolean) => ({
    fontSize: 11,
    height: 20,
    minWidth: 0,
    p: "0 8px",
    borderColor: on ? TEXT : BORDER,
    bgcolor: on ? SURFACE_ALT : "transparent",
    color: on ? TEXT : TEXT_MUTED,
    "&:hover": { bgcolor: SURFACE_ALT, borderColor: TEXT },
  });

  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", bgcolor: BG, overflow: "hidden" }}>
      {/* Toolbar — 48px, dense, 8pt */}
      <Paper
        elevation={0}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px: 1.5,
          height: 48,
          minHeight: 48,
          borderBottom: 1,
          borderColor: BORDER,
          bgcolor: SURFACE,
          borderRadius: 0,
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: TEXT_MUTED }}>
          CHART COMPARE
        </Typography>
        <Chip
          size="small"
          label="RELIANCE · 1m · 375"
          sx={{ fontSize: 10, height: 20, bgcolor: SURFACE_ALT, color: TEXT, border: 1, borderColor: BORDER, ml: 0.5 }}
        />
        <Box sx={{ width: 1, height: 18, bgcolor: BORDER, mx: 0.75 }} />

        <Tooltip title="Add Long marker at current candle">
          <span>
            <Button
              size="small"
              variant={activeTool === "long" ? "contained" : "outlined"}
              color="inherit"
              onClick={() => addTrade("BUY")}
              sx={{ ...btnSx(activeTool === "long"), minWidth: 52, borderColor: activeTool === "long" ? POS : BORDER, color: activeTool === "long" ? POS : TEXT_MUTED }}
            >
              Long
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="Add Short marker at current candle">
          <span>
            <Button
              size="small"
              variant={activeTool === "short" ? "contained" : "outlined"}
              color="inherit"
              onClick={() => addTrade("SELL")}
              sx={{ ...btnSx(activeTool === "short"), minWidth: 56, borderColor: activeTool === "short" ? NEG : BORDER, color: activeTool === "short" ? NEG : TEXT_MUTED }}
            >
              Short
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="Toggle Trend line (visual on both panes)">
          <span>
            <Button
              size="small"
              variant={trendOn ? "contained" : "outlined"}
              color="inherit"
              onClick={handleTrend}
              sx={{ ...btnSx(trendOn), minWidth: 56 }}
            >
              Trend
            </Button>
          </span>
        </Tooltip>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          onClick={handleClear}
          sx={{ fontSize: 10, height: 20, minWidth: 48, p: "0 8px", borderColor: BORDER, color: TEXT_MUTED }}
        >
          Clear
        </Button>

        <Box sx={{ width: 1, height: 18, bgcolor: BORDER, mx: 0.75 }} />

        <Tooltip title={isPlaying ? "Pause" : "Play"}>
          <IconButton
            size="small"
            onClick={handlePlayPause}
            sx={{ border: 1, borderColor: BORDER, bgcolor: SURFACE_ALT, color: TEXT, width: 24, height: 24 }}
          >
            {isPlaying ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />}
          </IconButton>
        </Tooltip>
        <Typography variant="caption" sx={{ fontSize: 10, color: TEXT_MUTED, minWidth: 72 }}>
          {visibleCandles.length} / {baseCandles.length}
        </Typography>
        <Slider
          size="small"
          min={10}
          max={baseCandles.length}
          value={currentIdx}
          onChange={(_, v) => setCurrentIdx(v as number)}
          sx={{ width: 160, color: TEXT_MUTED, "& .MuiSlider-thumb": { width: 10, height: 10 } }}
        />
        <Box sx={{ display: "flex", gap: 0.5, ml: 0.5 }}>
          {[800, 400, 200].map((s) => (
            <Button
              key={s}
              size="small"
              variant={speed === s ? "contained" : "outlined"}
              color="inherit"
              onClick={() => setSpeed(s)}
              sx={{ fontSize: 10, height: 20, minWidth: 32, p: 0, borderColor: speed === s ? TEXT : BORDER, bgcolor: speed === s ? SURFACE_ALT : "transparent", color: speed === s ? TEXT : TEXT_MUTED }}
            >
              {s === 800 ? "1x" : s === 400 ? "2x" : "4x"}
            </Button>
          ))}
        </Box>

        <Box sx={{ flex: 1 }} />
        <Chip size="small" label={`${trades.length} markers`} sx={{ fontSize: 10, height: 20, bgcolor: SURFACE_ALT, color: TEXT_MUTED, border: 1, borderColor: BORDER }} />
      </Paper>

      {/* Info bar — 20px dense */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          height: 20,
          minHeight: 20,
          borderBottom: 1,
          borderColor: BORDER,
          bgcolor: SURFACE,
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" sx={{ fontSize: 10, color: TEXT_MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {currentCandle ? `O ${currentCandle.open} H ${currentCandle.high} L ${currentCandle.low} C ${currentCandle.close} V ${currentCandle.volume}` : "—"} · {trendOn ? "Trend on" : "Trend off"} · Long/Short adds BUY/SELL markers to both panes
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ fontSize: 10, color: TEXT_MUTED }}>
          ECharts left · TradingView right · same data
        </Typography>
      </Box>

      {/* Side-by-side panes — 8pt gap */}
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 1, p: 1, overflow: "hidden" }}>
        {/* Left: ECharts via ReplayChart */}
        <Paper
          elevation={0}
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            border: 1,
            borderColor: BORDER,
            borderRadius: 1,
            bgcolor: SURFACE,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              px: 1,
              height: 24,
              minHeight: 24,
              borderBottom: 1,
              borderColor: BORDER,
              bgcolor: SURFACE_ALT,
              flexShrink: 0,
            }}
          >
            <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: TEXT_MUTED }}>
              ECHARTS
            </Typography>
            <Chip size="small" label="ReplayChart" sx={{ fontSize: 10, height: 16, bgcolor: BG, color: TEXT_MUTED, border: 1, borderColor: BORDER }} />
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" sx={{ fontSize: 10, color: TEXT_MUTED }}>
              {visibleCandles.length} candles
            </Typography>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <ReplayChart
              ref={chartRef}
              candlesBySymbol={visibleBySymbol as any}
              trades={trades as any}
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
            {trendOn && (
              <Box sx={{ px: 1, py: 0.5, borderTop: 1, borderColor: BORDER, bgcolor: SURFACE_ALT, flexShrink: 0 }}>
                <Typography variant="caption" sx={{ fontSize: 10, color: TEXT_MUTED }}>
                  Trend: {visibleCandles[20]?.close?.toFixed(2) ?? "—"} → {currentCandle?.close?.toFixed(2) ?? "—"} (draw on TV pane with Trend button inside chart)
                </Typography>
              </Box>
            )}
          </Box>
        </Paper>

        {/* Right: TradingView Lightweight Charts */}
        <Paper
          elevation={0}
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            border: 1,
            borderColor: BORDER,
            borderRadius: 1,
            bgcolor: SURFACE,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              px: 1,
              height: 24,
              minHeight: 24,
              borderBottom: 1,
              borderColor: BORDER,
              bgcolor: SURFACE_ALT,
              flexShrink: 0,
            }}
          >
            <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: TEXT_MUTED }}>
              TRADINGVIEW
            </Typography>
            <Chip size="small" label="Lightweight Charts" sx={{ fontSize: 10, height: 16, bgcolor: BG, color: TEXT_MUTED, border: 1, borderColor: BORDER }} />
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" sx={{ fontSize: 10, color: TEXT_MUTED }}>
              markers + tools
            </Typography>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <TradingViewChart candles={visibleCandles} trades={trades as any} highlightedTradeId={null} height={420} />
          </Box>
        </Paper>
      </Box>

      {/* Bottom meta — 20px dense */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          height: 20,
          minHeight: 20,
          borderTop: 1,
          borderColor: BORDER,
          bgcolor: SURFACE,
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" sx={{ fontSize: 10, color: TEXT_MUTED }}>
          {baseCandles.length} candles · {baseCandles[0].time} → {baseCandles[baseCandles.length - 1].time} · 1m · same data both panes
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ fontSize: 10, color: TEXT_MUTED }}>
          Dense 8pt · BG {BG} · SURFACE {SURFACE} · BORDER {BORDER} · no blue
        </Typography>
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
