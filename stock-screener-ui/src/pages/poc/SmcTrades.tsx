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
import { withAlpha } from "@/utils/color";
import { TZ_IST, TZ_IST_LABEL } from "@/config/constants";
import type { Bar } from "@/utils/smc";

// Real trades from /api/poc/smc-ifvg — SMCIFVGEngine (trading/smc_ifvg.py) run bar-by-bar
// on Dukascopy ticks: history-only signals, tick-accurate fills (ask/bid), SL-first exits.
type Stack = "inv" | "retest";

type SmcTrade = {
  stack: Stack;
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

const formatTradeTime = (timestamp: number) => {
  const d = new Date(timestamp * 1000);
  const t = d.toLocaleString("en-IN", { timeZone: TZ_IST, hour: "2-digit", minute: "2-digit", hour12: false });
  const day = d.toLocaleString("en-IN", { timeZone: TZ_IST, day: "2-digit", month: "short" });
  return `${t} ${day}`;
};

const resultColor = (result: string) => (result === "TP" ? "success" : result === "TRAIL" ? "warning" : "error");
const kindLabel = (kind: string) => (kind === "inv" ? "iFVG inversion" : "FVG retest");
const stackLabel = (stack: Stack): string => (stack === "inv" ? "MOMENTUM" : "REVERSION");
const stackColor = (stack: Stack) => (stack === "inv" ? "#2563EB" : "#A855F7");

export default function SmcTrades() {
  const [date, setDate] = useState(DUKA_DATES[0]);
  const [windowOnly, setWindowOnly] = useState(true);
  const [earlyInv, setEarlyInv] = useState(false);
  const [data, setData] = useState<{ bars: Bar[]; trades: SmcTrade[]; error?: string; basis?: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = windowOnly ? `&from_ist=${WINDOW.from}&to_ist=${WINDOW.to}` : "";
    const f = earlyInv ? `&flip=3` : "";
    Promise.all([
      fetch(`/api/poc/smc-ifvg?date=${date}${q}&entries=inv${f}`).then(r => r.json()),
      fetch(`/api/poc/smc-ifvg?date=${date}${q}&entries=retest${f}`).then(r => r.json()),
    ])
      .then(([mi, mr]) => {
        const bars = (mi.bars || mr.bars || []) as Bar[];
        const ti = ((mi.trades || []) as Omit<SmcTrade, "stack">[]).map(t => ({ ...t, stack: "inv" as Stack }));
        const tr = ((mr.trades || []) as Omit<SmcTrade, "stack">[]).map(t => ({ ...t, stack: "retest" as Stack }));
        const trades = [...ti, ...tr].sort((a, b) => a.time - b.time);
        setData({ bars, trades, basis: mi.basis ?? mr.basis, error: mi.error && mr.error ? mi.error : undefined });
      })
      .catch(() => setData({ bars: [], trades: [], error: "fetch failed" }))
      .finally(() => setLoading(false));
  }, [date, windowOnly, earlyInv]);

  const net = (data?.trades || []).reduce((a, t) => a + t.pnl, 0);
  const wins = (data?.trades || []).filter(t => t.pnl > 0).length;
  const netStack = (st: Stack) => (data?.trades || []).filter(t => t.stack === st).reduce((a, t) => a + t.pnl, 0);

  return (
    <Box sx={{ p: 2, width: "100%" }} data-testid="smc-trades">
      <Typography variant="h6" sx={{ color: "#E5E7EB", mb: 0.5 }}>SMC iFVG — validated engine on real NQ ticks</Typography>
      <Typography variant="caption" sx={{ color: "#9CA3AF", display: "block", mb: 1 }}>
        trading/smc_ifvg.py · history-only signals · tick fills (ask/bid, SL-first) · structure TP (RR≥3) or trail · NQ=F {data?.basis != null ? `(basis +${data.basis.toFixed(1)})` : ""} · {TZ_IST_LABEL}
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
          control={<Switch size="small" checked={earlyInv} onChange={(_, v) => setEarlyInv(v)} />}
          label="early-inversion catch (experimental)"
          sx={{ color: "#9CA3AF", '& .MuiFormControlLabel-label': { fontSize: 12 } }}
        />
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
        <Chip size="small" label={`MOMENTUM ${netStack("inv") > 0 ? "+" : ""}${netStack("inv").toFixed(1)}`} sx={{ bgcolor: "#1F2937", color: "#58A6FF", border: `1px solid ${stackColor("inv")}` }} />
        <Chip size="small" label={`REVERSION ${netStack("retest") > 0 ? "+" : ""}${netStack("retest").toFixed(1)}`} sx={{ bgcolor: "#1F2937", color: "#CE9BFC", border: `1px solid ${stackColor("retest")}` }} />
        {loading && <Chip size="small" label="loading ticks…" sx={{ bgcolor: "#1F2937", color: "#58A6FF" }} />}
        {data?.error && <Chip size="small" label={data.error} color="error" />}
      </Stack>
      {!loading && data && data.trades.length === 0 && (
        <Box sx={{ p: 2, color: "#9CA3AF", fontSize: 12 }}>No trades in this view.</Box>
      )}
      {data?.trades.map((tr, i) => (
        <Card key={i} elevation={0} sx={{ bgcolor: palette.NT_BG, border: `1px solid ${palette.NT_GRID}`, mb: 2, overflow: "hidden" }}>
          <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, alignItems: "stretch" }}>
            <Stack sx={{ flex: "0 0 280px", p: 1.5, bgcolor: palette.SURFACE, borderRight: { md: `1px solid ${palette.BORDER}` }, borderBottom: { xs: `1px solid ${palette.BORDER}`, md: 0 }, gap: 1 }}>
              <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="space-between">
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Chip size="small" label={tr.side} color={tr.side === "LONG" ? "success" : "error"} sx={{ height: 18, fontSize: 10, fontWeight: 700 }} />
                  <Chip size="small" label={stackLabel(tr.stack)} sx={{ height: 18, fontSize: 9, bgcolor: "#1F2937", color: stackColor(tr.stack), border: `1px solid ${stackColor(tr.stack)}` }} />
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
            <Box sx={{ flex: 1, minHeight: 300, display: "flex", alignItems: "stretch" }}>
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
    const tickState: { lastDay: string } = { lastDay: "" };
    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: palette.NT_BG }, textColor: "#E5E7EB" },
      grid: { vertLines: { color: palette.NT_GRID }, horzLines: { color: palette.NT_GRID } },
      width: ref.current.clientWidth,
      height: 300,
      timeScale: {
        borderColor: palette.NT_GRID, timeVisible: true, secondsVisible: false, rightOffset: 4,
        tickMarkFormatter: (time: Time) => {
          if (typeof time !== "number") return "";
          const d = new Date(time * 1000);
          const day = d.toLocaleString("en-IN", { timeZone: TZ_IST, day: "2-digit", month: "short" });
          const t = d.toLocaleString("en-IN", { timeZone: TZ_IST, hour: "2-digit", minute: "2-digit", hour12: false });
          tickState.lastDay ||= "";
          if (day !== tickState.lastDay) { tickState.lastDay = day; return `${day} ${t}`; }
          return t;
        },
      },
      rightPriceScale: { borderColor: palette.NT_GRID },
      localization: { timeFormatter: (time: Time) => typeof time === "number" ? formatTradeTime(time) : "" },
    });
    chartRef.current = chart;
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: palette.NT_CANDLE_BULL, downColor: palette.NT_CANDLE_BEAR, borderVisible: false, wickVisible: true,
    });
    cs.setData(bars.map(b => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
    const isLong = trade.side === "LONG";
    const exitEmoji = trade.result === "TP" ? "🎯" : trade.result === "SL" ? "🛑" : "🏁";
    createSeriesMarkers(cs as any, [
      { time: trade.time as Time, position: isLong ? "belowBar" : "aboveBar" as any, color: isLong ? palette.MARKER_ENTRY : palette.MARKER_SL, shape: isLong ? "arrowUp" as any : "arrowDown" as any, text: `${isLong ? "🟢" : "🔴"} ${trade.entry.toFixed(2)}` },
      { time: trade.exit_time as Time, position: isLong ? "aboveBar" : "belowBar" as any, color: trade.result === "TP" ? palette.MARKER_TP : palette.MARKER_SL, shape: "circle" as any, text: `${exitEmoji} ${trade.result} ${trade.exit.toFixed(2)}` },
    ]);
    cs.createPriceLine({ price: trade.sl, color: palette.MARKER_SL, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "SL" });
    if (trade.tp != null) {
      cs.createPriceLine({ price: trade.tp, color: palette.MARKER_TP, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "TP" });
    }
    // zoom to trade context: 2h before entry -> 1h after exit (falls back to fitContent if out of range)
    const from = trade.time - 120 * 60;
    const to = trade.exit_time + 60 * 60;
    const first = bars[0].time, last = bars[bars.length - 1].time;
    if (from >= first && to <= last) {
      chart.timeScale().setVisibleRange({ from: from as Time, to: to as Time });
    } else {
      chart.timeScale().fitContent();
    }
    const ro = new ResizeObserver(() => { chart.applyOptions({ width: ref.current!.clientWidth }); requestAnimationFrame(drawRR); });
    ro.observe(ref.current);
    // TV-style R:R box: red risk zone (entry->SL), green reward zone (entry->TP), entry line
    const box = document.createElement("canvas");
    box.style.position = "absolute";
    box.style.inset = "0";
    box.style.pointerEvents = "none";
    box.style.zIndex = "10";
    ref.current.style.position = "relative";
    ref.current.appendChild(box);
    const drawRR = () => {
      const container = ref.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return;
      const H = 300;
      const dpr = window.devicePixelRatio || 1;
      box.width = rect.width * dpr;
      box.height = H * dpr;
      box.style.width = `${rect.width}px`;
      box.style.height = `${H}px`;
      const ctx = box.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, H);
      const t2x = (t: number) => chart.timeScale().timeToCoordinate(t as Time);
      const p2y = (p: number) => (cs as unknown as { priceToCoordinate: (v: number) => number | null }).priceToCoordinate(p);
      const x1 = t2x(trade.time);
      const x2 = t2x(trade.exit_time);
      const yE = p2y(trade.entry);
      const yS = p2y(trade.sl);
      if (x1 == null || x2 == null || yE == null || yS == null) return;
      const yT = trade.tp != null ? p2y(trade.tp) : null;
      const left = Math.min(x1, x2);
      const w = Math.max(Math.abs(x2 - x1), 3);
      const zone = (yA: number, yB: number, fill: string, edge: string) => {
        const top = Math.min(yA, yB);
        const h = Math.abs(yB - yA);
        if (h < 2) return 0;
        ctx.fillStyle = fill;
        ctx.fillRect(left, top, w, h);
        ctx.strokeStyle = edge;
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, top + 0.5, w - 1, Math.max(h - 1, 1));
        return h;
      };
      zone(yE, yS, withAlpha(palette.NEGATIVE, 0.13), withAlpha(palette.NEGATIVE, 0.55));
      if (yT != null) zone(yE, yT, withAlpha(palette.POSITIVE, 0.13), withAlpha(palette.POSITIVE, 0.55));
      // entry line
      ctx.strokeStyle = palette.MARKER_ENTRY;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(left, yE);
      ctx.lineTo(left + w, yE);
      ctx.stroke();
      ctx.setLineDash([]);
      // labels: risk in red zone, reward + R in green zone
      ctx.font = "600 10px monospace";
      const risk = Math.abs(trade.entry - trade.sl).toFixed(1);
      const lx = Math.min(left + w + 4, rect.width - 76);
      ctx.fillStyle = palette.NEGATIVE;
      ctx.fillText(`-${risk}`, lx, Math.min(yE, yS) + 12);
      if (yT != null && trade.tp != null) {
        const rwd = Math.abs(trade.tp - trade.entry).toFixed(1);
        ctx.fillStyle = palette.POSITIVE;
        ctx.fillText(`+${rwd} (${trade.rr >= 0 ? "+" : ""}${trade.rr.toFixed(1)}R)`, lx, Math.min(yE, yT) + 12);
      }
    };
    drawRR();
    requestAnimationFrame(drawRR);
    const onVis = () => requestAnimationFrame(drawRR);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVis);
    return () => { ro.disconnect(); chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVis); box.remove(); chart.remove(); };
  }, [bars, trade]);
  return <Box ref={ref} sx={{ width: "100%", height: 300 }} />;
}
