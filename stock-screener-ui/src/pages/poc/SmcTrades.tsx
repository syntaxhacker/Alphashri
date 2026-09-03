import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CandlestickSeries, createSeriesMarkers, type IChartApi, type Time } from "lightweight-charts";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import * as palette from "@/ui/palette";
import { TZ_IST, TZ_IST_LABEL } from "@/config/constants";
import type { Bar } from "@/utils/smc";

// Real trades from /api/poc/smc-ifvg — SMCIFVGEngine (trading/smc_ifvg.py) run bar-by-bar
// on Dukascopy ticks: history-only signals, tick-accurate fills (ask/bid), SL-first exits.
type SmcTrade = {
  time: number;
  exit_time: number;
  side: "LONG" | "SHORT";
  kind: "inv" | "retest";
  entry: number;
  sl: number;
  tp: number | null;
  exit: number;
  result: "TP" | "SL" | "TRAIL";
  pnl: number;
  rr: number;
};

const DUKA_DATES = ["2026-09-02", "2026-08-26", "2026-07-24", "2026-07-22", "2026-07-10", "2026-07-02"];
const WINDOW = { from: "14:10", to: "19:00" };

const formatTradeTime = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleString("en-IN", {
    timeZone: TZ_IST,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const resultColor = (result: string) => (result === "TP" ? "success" : result === "TRAIL" ? "warning" : "error");
const kindLabel = (kind: string) => (kind === "inv" ? "iFVG inversion" : "FVG retest");

export default function SmcTrades() {
  const [date, setDate] = useState(DUKA_DATES[0]);
  const [windowOnly, setWindowOnly] = useState(true);
  const [data, setData] = useState<{ bars: Bar[]; trades: SmcTrade[]; error?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = windowOnly ? `&from_ist=${WINDOW.from}&to_ist=${WINDOW.to}` : "";
    fetch(`/api/poc/smc-ifvg?date=${date}${q}`)
      .then(r => r.json())
      .then(j => setData({ bars: j.bars || [], trades: (j.trades || []) as SmcTrade[], error: j.error }))
      .catch(() => setData({ bars: [], trades: [], error: "fetch failed" }))
      .finally(() => setLoading(false));
  }, [date, windowOnly]);

  const net = (data?.trades || []).reduce((a, t) => a + t.pnl, 0);
  const wins = (data?.trades || []).filter(t => t.pnl > 0).length;

  return (
    <Box sx={{ p: 2, maxWidth: 1400, mx: "auto" }} data-testid="smc-trades">
      <Typography variant="h6" sx={{ color: "#E5E7EB", mb: 0.5 }}>SMC iFVG — validated engine on Dukascopy ticks</Typography>
      <Typography variant="caption" sx={{ color: "#9CA3AF", display: "block", mb: 1 }}>
        trading/smc_ifvg.py · history-only signals · tick fills (ask/bid, SL-first) · structure TP (RR≥3) or trail · {TZ_IST_LABEL}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", alignItems: "center" }}>
        {DUKA_DATES.map(d => (
          <Chip
            key={d}
            size="small"
            label={d}
            onClick={() => setDate(d)}
            sx={{
              bgcolor: d === date ? "#2563EB" : "#1F2937",
              color: "#E5E7EB",
              fontWeight: d === date ? 700 : 400,
              cursor: "pointer",
            }}
          />
        ))}
        <FormControlLabel
          size="small"
          control={<Switch size="small" checked={windowOnly} onChange={(_, v) => setWindowOnly(v)} />}
          label={`${WINDOW.from}–${WINDOW.to} window only`}
          sx={{ color: "#9CA3AF", '& .MuiFormControlLabel-label': { fontSize: 12 } }}
        />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }}>
        <Chip size="small" label={`${data?.trades.length ?? 0} trades`} sx={{ bgcolor: "#1F2937", color: "#00FF00" }} />
        <Chip size="small" label={`win ${wins}/${data?.trades.length ?? 0}`} sx={{ bgcolor: "#1F2937", color: "#9CA3AF" }} />
        <Chip size="small" label={`net ${net > 0 ? "+" : ""}${net.toFixed(1)} pts`} color={net > 0 ? "success" : "error"} />
        {loading && <Chip size="small" label="loading ticks…" sx={{ bgcolor: "#1F2937", color: "#58A6FF" }} />}
        {data?.error && <Chip size="small" label={data.error} color="error" />}
      </Stack>
      {!loading && data && data.trades.length === 0 && (
        <Box sx={{ p: 2, color: "#9CA3AF", fontSize: 12 }}>No trades in this view.</Box>
      )}
      {data?.trades.map((tr, i) => (
        <Card key={i} elevation={0} sx={{ bgcolor: palette.NT_BG, border: `1px solid ${palette.NT_GRID}`, mb: 2, overflow: "hidden" }}>
          <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, alignItems: "stretch" }}>
            <Stack sx={{ flex: "0 0 300px", p: 1.5, bgcolor: palette.SURFACE, borderRight: { md: `1px solid ${palette.BORDER}` }, borderBottom: { xs: `1px solid ${palette.BORDER}`, md: 0 }, gap: 1 }}>
              <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="space-between">
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Chip size="small" label={tr.side} color={tr.side === "LONG" ? "success" : "error"} sx={{ height: 18, fontSize: 10, fontWeight: 700 }} />
                  <Typography variant="caption" sx={{ color: palette.TEXT, fontWeight: 600, fontSize: 10 }}>#{i + 1} {kindLabel(tr.kind)}</Typography>
                </Stack>
                <Chip size="small" label={tr.result} color={resultColor(tr.result)} sx={{ height: 18, fontSize: 9 }} />
              </Stack>
              <Stack spacing={0.25}>
                <Typography variant="caption" sx={{ color: palette.TEXT, fontSize: 10, fontWeight: 600 }}>
                  {formatTradeTime(tr.time)} → {formatTradeTime(tr.exit_time)} {TZ_IST_LABEL}
                </Typography>
                <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, fontSize: 9 }}>
                  Entry {tr.entry.toFixed(2)} · SL {tr.sl.toFixed(2)}{tr.tp != null ? ` · TP ${tr.tp.toFixed(2)}` : " · trail"}
                </Typography>
                <Typography variant="caption" sx={{ color: tr.pnl > 0 ? palette.POSITIVE : palette.NEGATIVE, fontSize: 9, fontWeight: 600 }}>
                  RR {tr.rr >= 0 ? "+" : ""}{tr.rr.toFixed(2)}R · {tr.pnl > 0 ? "+" : ""}{tr.pnl.toFixed(2)} pts ({Math.max(1, Math.round((tr.exit_time - tr.time) / 60))}m)
                </Typography>
              </Stack>
              <Box sx={{ p: 1, bgcolor: palette.SURFACE_ALT, borderRadius: 1, border: `1px solid ${palette.BORDER}` }}>
                <Typography variant="caption" sx={{ color: palette.TEXT, fontWeight: 600, display: "block", fontSize: 9, mb: 0.5 }}>
                  {kindLabel(tr.kind)}
                </Typography>
                <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, display: "block", fontSize: 9, lineHeight: 1.6 }}>
                  {tr.kind === "inv"
                    ? "1m close through FVG opposite edge, BOS-aligned. Entry next tick, SL beyond nearest opposing structure."
                    : "Pullback into active FVG zone (touch within 2pts). SL beyond zone edge."}
                </Typography>
              </Box>
            </Stack>
            <Box sx={{ flex: 1, minHeight: 260, display: "flex", alignItems: "stretch" }}>
              <SingleChart bars={data.bars} trade={tr} />
            </Box>
          </Box>
        </Card>
      ))}
    </Box>
  );
}

function SingleChart({ bars, trade }: { bars: Bar[]; trade: SmcTrade }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  useEffect(() => {
    if (!ref.current || !bars.length) return;
    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: palette.NT_BG }, textColor: "#E5E7EB" },
      grid: { vertLines: { color: palette.NT_GRID }, horzLines: { color: palette.NT_GRID } },
      width: ref.current.clientWidth,
      height: 300,
      timeScale: { borderColor: palette.NT_GRID, timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 4, tickMarkFormatter: (time: Time) => typeof time === "number" ? formatTradeTime(time) : "" },
      rightPriceScale: { borderColor: palette.NT_GRID },
      localization: { timeFormatter: (time: Time) => typeof time === "number" ? formatTradeTime(time) : "" },
    });
    chartRef.current = chart;
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: palette.NT_CANDLE_BULL, downColor: palette.NT_CANDLE_BEAR, borderVisible: false, wickVisible: true,
    });
    cs.setData(bars.map(b => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
    const isLong = trade.side === "LONG";
    createSeriesMarkers(cs as any, [
      { time: trade.time as Time, position: isLong ? "belowBar" : "aboveBar" as any, color: isLong ? palette.MARKER_ENTRY : palette.MARKER_SL, shape: isLong ? "arrowUp" as any : "arrowDown" as any, text: isLong ? "▲ BUY" : "▼ SELL" },
      { time: trade.exit_time as Time, position: isLong ? "aboveBar" : "belowBar" as any, color: trade.result === "TP" ? palette.MARKER_TP : palette.MARKER_SL, shape: "circle" as any, text: trade.result },
    ]);
    cs.createPriceLine({ price: trade.entry, color: palette.MARKER_ENTRY, lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: "ENTRY" });
    cs.createPriceLine({ price: trade.sl, color: palette.MARKER_SL, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "SL" });
    if (trade.tp != null) {
      cs.createPriceLine({ price: trade.tp, color: palette.MARKER_TP, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "TP" });
    }
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.applyOptions({ width: ref.current!.clientWidth }));
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.remove(); };
  }, [bars, trade]);
  return <Box ref={ref} sx={{ width: "100%", height: 260 }} />;
}
