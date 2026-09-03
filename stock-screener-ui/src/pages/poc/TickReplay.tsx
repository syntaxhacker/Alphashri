import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createChart, ColorType, CandlestickSeries, LineSeries, createSeriesMarkers, type IChartApi, type Time } from "lightweight-charts";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Slider from "@mui/material/Slider";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import * as palette from "@/ui/palette";
import { orRangeLabel } from "@/utils/replayTime";
import { TZ_IST, TZ_IST_LABEL } from "@/config/constants";

type Candle = { time: number; open: number; high: number; low: number; close: number };
type VwapPt = { time: number; value: number };
type RTrade = {
  time: number; exit_time: number; side: "LONG" | "SHORT"; kind: string;
  entry: number; sl: number; tp: number; exit: number;
  result: "TP" | "SL"; pnl: number; rr: number;
};

const DATES = ["2026-09-02", "2026-08-26", "2026-07-24", "2026-08-27", "2026-07-22", "2026-07-02"];
const SPEEDS = [1, 5, 15, 60, 300];

const fmtT = (ts: number) =>
  new Date(ts * 1000).toLocaleString("en-IN", { timeZone: TZ_IST, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export default function TickReplay() {
  const [date, setDate] = useState(DATES[0]);
  const [bundle, setBundle] = useState<{ candles: Candle[]; subs: Candle[]; vwap: VwapPt[]; or_high: number; or_low: number; or_minutes: number; or_end: number; trades: RTrade[]; basis?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [orTf, setOrTf] = useState(15);
  const [clock, setClock] = useState(0);   // replay clock, epoch seconds
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<any>(null);
  const vwapRef = useRef<any>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const orLinesRef = useRef(false);
  const rafRef = useRef(0);
  const clockRef = useRef(0);
  const lastPaintRef = useRef(0);
  clockRef.current = clock;

  const t0 = bundle && bundle.candles.length ? bundle.candles[0].time : 0;
  const tEnd = bundle && bundle.candles.length ? bundle.candles[bundle.candles.length - 1].time + 60 : 0;

  useEffect(() => {
    setLoading(true);
    setPlaying(false);
    setClock(0);
    clockRef.current = 0;
    fetch(`/api/poc/tick-replay?date=${date}&secs=2&orb=${orTf}`)
      .then(r => r.json())
      .then(j => setBundle({
        candles: j.candles || [], subs: j.subs || [], vwap: j.vwap || [],
        or_high: j.or_high, or_low: j.or_low, or_minutes: j.or_minutes || orTf, or_end: j.or_end || 0,
        trades: j.trades || [], basis: j.basis,
      }))
      .catch(() => setBundle({ candles: [], subs: [], vwap: [], or_high: 0, or_low: 0, or_minutes: orTf, or_end: 0, trades: [] }))
      .finally(() => setLoading(false));
  }, [date, orTf]);

  // chart setup (once per bundle)
  useEffect(() => {
    if (!boxRef.current || !bundle || !bundle.candles.length) return;
    const tickState: { lastDay: string } = { lastDay: "" };
    const chart = createChart(boxRef.current, {
      layout: { background: { type: ColorType.Solid, color: palette.NT_BG }, textColor: "#E5E7EB" },
      grid: { vertLines: { color: palette.NT_GRID }, horzLines: { color: palette.NT_GRID } },
      width: boxRef.current.clientWidth,
      height: 420,
      timeScale: {
        borderColor: palette.NT_GRID, timeVisible: true, secondsVisible: true, rightOffset: 4,
        tickMarkFormatter: (t: Time) => {
          if (typeof t !== "number") return "";
          const d = new Date(t * 1000);
          const day = d.toLocaleString("en-IN", { timeZone: TZ_IST, day: "2-digit", month: "short" });
          const hm = d.toLocaleString("en-IN", { timeZone: TZ_IST, hour: "2-digit", minute: "2-digit", hour12: false });
          if (day !== tickState.lastDay) { tickState.lastDay = day; return `${day} ${hm}`; }
          return hm;
        },
      },
      rightPriceScale: { borderColor: palette.NT_GRID },
      localization: {
        timeFormatter: (t: Time) => typeof t === "number" ? fmtT(t) : "",
        locale: "en-IN",
      },
    });
    chartRef.current = chart;
    const cs = chart.addSeries(CandlestickSeries, { upColor: palette.NT_CANDLE_BULL, downColor: palette.NT_CANDLE_BEAR, borderVisible: false });
    const vs = chart.addSeries(LineSeries, { color: "#F0B90B", lineWidth: 1, priceLineVisible: false, lastValueVisible: true });
    seriesRef.current = cs;
    vwapRef.current = vs;
    cs.setData([]);
    vs.setData([]);
    orLinesRef.current = false;
    const ro = new ResizeObserver(() => chart.applyOptions({ width: boxRef.current!.clientWidth }));
    ro.observe(boxRef.current);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [bundle]);

  // paint: completed 1m bars + live-forming bar built from 5s subs
  const paint = useCallback((now: number) => {
    const cs = seriesRef.current, vs = vwapRef.current, chart = chartRef.current;
    if (!cs || !bundle || now <= 0) return;
    // OR levels appear only once the opening-range window has completed (no future leak)
    if (!orLinesRef.current && bundle.or_end > 0 && now >= bundle.or_end) {
      (cs as any).createPriceLine({ price: bundle.or_high, color: "#A78BFA", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "OR-H" });
      (cs as any).createPriceLine({ price: bundle.or_low, color: "#A78BFA", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "OR-L" });
      orLinesRef.current = true;
    }
    const done = bundle.candles.filter(c => c.time + 60 <= now);
    const rows = done.map(c => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close }));
    const live = bundle.subs.filter(s => s.time >= Math.floor(now / 60) * 60 && s.time <= now);
    if (live.length) {
      rows.push({
        time: Math.floor(now / 60) * 60 as Time,
        open: live[0].open, high: Math.max(...live.map(s => s.high)),
        low: Math.min(...live.map(s => s.low)), close: live[live.length - 1].close,
      });
    }
    cs.setData(rows);
    vs.setData(bundle.vwap.filter(v => v.time <= now).map(v => ({ time: v.time as Time, value: v.value })));
    const shown = bundle.trades.filter(t => t.time <= now);
    createSeriesMarkers(cs as any, shown.flatMap(t => {
      const isLong = t.side === "LONG";
      const m: any[] = [{
        time: t.time as Time, position: isLong ? "belowBar" : "aboveBar",
        color: isLong ? palette.MARKER_ENTRY : palette.MARKER_SL,
        shape: isLong ? "arrowUp" : "arrowDown",
        text: `${isLong ? "🟢" : "🔴"} ${t.entry.toFixed(1)}`,
      }];
      if (t.exit_time <= now) {
        m.push({
          time: t.exit_time as Time, position: isLong ? "aboveBar" : "belowBar",
          color: t.result === "TP" ? palette.MARKER_TP : palette.MARKER_SL,
          shape: "circle", text: `${t.result === "TP" ? "🎯" : "🛑"} ${t.exit.toFixed(1)}`,
        });
      }
      return m;
    }));
    chart.timeScale().scrollToPosition(6, false);
  }, [bundle]);

  // playback loop: advance clock, paint at most 10fps
  useEffect(() => {
    if (!playing || !bundle || !tEnd) return;
    if (clockRef.current <= 0 && t0 > 0) {
      clockRef.current = t0;
      setClock(t0);
      paint(t0);
    }
    let last = performance.now();
    const step = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      const next = Math.min(tEnd, clockRef.current + dt * speed);
      if (t - lastPaintRef.current > 100 || next >= tEnd) {
        lastPaintRef.current = t;
        setClock(next);
        paint(next);
      } else {
        clockRef.current = next;
      }
      if (next >= tEnd) {
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speed, bundle, tEnd, paint]);

  const revealed = useMemo(
    () => (bundle ? bundle.trades.filter(t => t.time <= clock) : []),
    [bundle, clock],
  );
  const closed = useMemo(
    () => revealed.filter(t => t.exit_time <= clock),
    [revealed, clock],
  );
  const net = closed.reduce((a, t) => a + t.pnl, 0);

  const jump = useCallback((v: number) => {
    clockRef.current = v;
    lastPaintRef.current = 0;
    setClock(v);
    paint(v);
  }, [paint]);

  // initialize clock at first candle so the chart/time/slider are correct before play
  useEffect(() => {
    if (bundle && bundle.candles.length && clockRef.current <= 0) {
      jump(bundle.candles[0].time);
    }
  }, [bundle, jump]);

  return (
    <Box sx={{ p: 2, width: "100%" }} data-testid="tick-replay">
      <Typography variant="h6" sx={{ color: "#E5E7EB", mb: 0.5 }}>Tick Replay — VWAP + ORB on real NQ ticks</Typography>
      <Typography variant="caption" sx={{ color: "#9CA3AF", display: "block", mb: 1 }}>
        1m NQ=F candles, forming bar ticks live from 5s subs{bundle?.basis != null ? ` · basis +${bundle.basis.toFixed(1)}` : ""} · OR {bundle?.or_minutes ?? orTf}m{bundle && bundle.candles.length ? ` (${orRangeLabel(bundle.candles[0].time, bundle.or_minutes)})` : ""} · LONG above OR-H + VWAP / SHORT below OR-L + VWAP · SL opposite edge, TP 2R · {TZ_IST_LABEL}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", alignItems: "center" }}>
        {DATES.map(d => (
          <Chip key={d} size="small" label={d} onClick={() => setDate(d)}
            sx={{ bgcolor: d === date ? "#2563EB" : "#1F2937", color: "#E5E7EB", cursor: "pointer", fontWeight: d === date ? 700 : 400 }} />
        ))}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center", flexWrap: "wrap" }}>
        <Button size="small" variant="contained" onClick={() => { if (clockRef.current >= tEnd) jump(t0); setPlaying(p => !p); }} disabled={loading || !bundle?.candles.length}>
          {playing ? "⏸ Pause" : "▶ Play"}
        </Button>
        <TextField size="small" select value={speed} onChange={e => setSpeed(Number(e.target.value))} sx={{ width: 110 }} label="Speed">
          {SPEEDS.map(s => <MenuItem key={s} value={s}>{s}x</MenuItem>)}
        </TextField>
        <TextField size="small" select value={orTf} onChange={e => setOrTf(Number(e.target.value))} sx={{ width: 110 }} label="OR TF">
          {[5, 15, 30].map(m => <MenuItem key={m} value={m}>{m}m</MenuItem>)}
        </TextField>
        <Box sx={{ flex: 1, minWidth: 200, px: 1 }}>
          <Slider size="small" min={t0} max={tEnd} step={1} value={clock}
            onChange={(_, v) => jump(v as number)} aria-label="replay position" />
        </Box>
        <Typography variant="caption" sx={{ color: "#E5E7EB", fontFamily: "monospace" }}>
          {clock > 0 ? fmtT(clock) : "--:--:--"} · {closed.length}/{revealed.length} closed · net {net > 0 ? "+" : ""}{net.toFixed(1)}
        </Typography>
        {loading && <Chip size="small" label="loading ticks…" sx={{ bgcolor: "#1F2937", color: "#58A6FF" }} />}
      </Stack>
      <Card elevation={0} sx={{ bgcolor: palette.NT_BG, border: `1px solid ${palette.NT_GRID}`, overflow: "hidden", mb: 2 }}>
        <Box ref={boxRef} sx={{ width: "100%", height: 420 }} />
      </Card>
      <Card elevation={0} sx={{ bgcolor: palette.NT_BG, border: `1px solid ${palette.NT_GRID}`, overflow: "hidden" }}>
        <Box sx={{ p: 1.5, bgcolor: "#111", borderBottom: `1px solid ${palette.NT_GRID}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="subtitle2" sx={{ color: palette.PRIMARY }}>
            Trades — {closed.length} closed · net {net > 0 ? "+" : ""}{net.toFixed(1)} pts
          </Typography>
          <Chip size="small" label={`${revealed.length - closed.length} open`} sx={{ bgcolor: "#1F2937", color: "#9CA3AF" }} />
        </Box>
        {revealed.length === 0 ? (
          <Box sx={{ p: 2, color: "#9CA3AF", fontSize: 12 }}>Press Play — entries print as ticks cross their signals.</Box>
        ) : (
          revealed.map((t, i) => (
            <Box key={i} sx={{ px: 1.5, py: 1, borderTop: i ? `1px solid ${palette.NT_GRID}` : 0, display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
              <Chip size="small" label={t.side} color={t.side === "LONG" ? "success" : "error"} sx={{ height: 18, fontSize: 10, fontWeight: 700 }} />
              <Typography variant="caption" sx={{ color: palette.TEXT, fontFamily: "monospace", fontSize: 11 }}>
                {fmtT(t.time)}{t.exit_time <= clock ? ` → ${fmtT(t.exit_time)}` : " → …"}
              </Typography>
              <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, fontSize: 10 }}>
                {t.entry.toFixed(1)} → {t.exit_time <= clock ? t.exit.toFixed(1) : "…"}
              </Typography>
              {t.exit_time <= clock ? (
                <Chip size="small" label={`${t.result} ${t.pnl > 0 ? "+" : ""}${t.pnl.toFixed(1)}`}
                  color={t.pnl > 0 ? "success" : "error"} sx={{ height: 18, fontSize: 9 }} />
              ) : (
                <Chip size="small" label="OPEN" color="warning" sx={{ height: 18, fontSize: 9 }} />
              )}
            </Box>
          ))
        )}
      </Card>
    </Box>
  );
}
