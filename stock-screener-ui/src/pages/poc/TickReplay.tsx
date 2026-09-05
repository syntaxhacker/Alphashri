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
import { withAlpha } from "@/utils/color";
import { orRangeLabel } from "@/utils/replayTime";
import { TZ_IST, TZ_IST_LABEL } from "@/config/constants";
import { ReplayTradeTable, type RTrade } from "./ReplayTradeTable";

type Candle = { time: number; open: number; high: number; low: number; close: number };
type VwapPt = { time: number; value: number };
type Bundle = {
  candles: Candle[]; subs: Candle[]; vwap: VwapPt[];
  or_high: number; or_low: number; or_minutes: number; or_end: number;
  trades: RTrade[]; basis?: number; sub_secs?: number; hist_bars?: number; error?: string;
};

const DATES = ["2026-09-02", "2026-08-26", "2026-07-24", "2026-08-27", "2026-07-22", "2026-07-02"];
const SPEEDS = [1, 5, 15, 60, 300];

const fmtT = (ts: number) =>
  new Date(ts * 1000).toLocaleString("en-IN", { timeZone: TZ_IST, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export default function TickReplay() {
  const [date, setDate] = useState(DATES[0]);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [orTf, setOrTf] = useState(15);
  const [clock, setClock] = useState(0);   // replay clock, epoch seconds
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<any>(null);
  const vwapRef = useRef<any>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const orLinesRef = useRef<{ h: unknown; l: unknown } | null>(null);
  const markersRef = useRef<{ setMarkers: (m: unknown[]) => void } | null>(null);
  const rrBoxRef = useRef<HTMLCanvasElement | null>(null);
  const rrWRef = useRef(0);   // last canvas css width (resize only on change)
  const paintRef = useRef<(now: number) => void>(() => {});
  const speedRef = useRef(speed);
  // incremental paint cursors (reset per bundle / on scrub-back)
  const progRef = useRef({ n: 0, v: 0, mkey: "", subPtr: 0, lastNow: 0 });
  const rafRef = useRef(0);
  const clockRef = useRef(0);
  const lastPaintRef = useRef(0);

  useEffect(() => { clockRef.current = clock; }, [clock]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const t0 = bundle && bundle.candles.length ? bundle.candles[0].time : 0;
  const tEnd = bundle && bundle.candles.length ? bundle.candles[bundle.candles.length - 1].time + 60 : 0;

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setPlaying(false);
    setClock(0);
    clockRef.current = 0;
    fetch(`/api/poc/tick-replay?date=${date}&secs=2&orb=${orTf}&hist=8`, { signal: ac.signal })
      .then(r => {
        if (r.ok === false) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(j => {
        if (ac.signal.aborted) return;
        setBundle({
          candles: j.candles || [], subs: j.subs || [], vwap: j.vwap || [],
          or_high: j.or_high, or_low: j.or_low, or_minutes: j.or_minutes || orTf, or_end: j.or_end || 0,
          trades: j.trades || [], basis: j.basis, sub_secs: j.sub_secs, hist_bars: j.hist_bars,
          ...(j.error ? { error: j.error } : {}),
        });
      })
      .catch((e) => {
        if (ac.signal.aborted || (e && e.name === "AbortError")) return;
        setBundle({
          candles: [], subs: [], vwap: [], or_high: 0, or_low: 0,
          or_minutes: orTf, or_end: 0, trades: [],
          error: `load failed: ${e && e.message ? e.message : e}`,
        });
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
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
    try {
      markersRef.current = createSeriesMarkers(cs as any, []);
    } catch {
      markersRef.current = null;   // test env without full chart impl
    }
    orLinesRef.current = null;
    rrWRef.current = 0;
    progRef.current = { n: 0, v: 0, mkey: "", subPtr: 0, lastNow: 0 };
    // TV-style R:R overlay (zIndex above LWC panes)
    const rr = document.createElement("canvas");
    rr.style.position = "absolute";
    rr.style.inset = "0";
    rr.style.pointerEvents = "none";
    rr.style.zIndex = "10";
    boxRef.current.style.position = "relative";
    boxRef.current.appendChild(rr);
    rrBoxRef.current = rr;
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: boxRef.current!.clientWidth });
      requestAnimationFrame(() => paintRef.current?.(clockRef.current));
    });
    ro.observe(boxRef.current);
    const onVis = () => requestAnimationFrame(() => paintRef.current?.(clockRef.current));
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVis);
    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVis);
      try { (cs as any).detachPrimitive?.(markersRef.current); } catch { /* already gone */ }
      markersRef.current = null;
      rr.remove();
      rrBoxRef.current = null;
      chart.remove();
      chartRef.current = null;
    };
  }, [bundle]);

  // paint: completed 1m bars + live-forming bar built from 5s subs
  const paint = useCallback((now: number) => {
    const cs = seriesRef.current, vs = vwapRef.current, chart = chartRef.current;
    if (!cs || !bundle || now <= 0) return;
    // OR levels appear only once the opening-range window has completed (no future leak);
    // scrubbing back before or_end removes them again.
    const orLines = orLinesRef.current;
    if (!orLines && bundle.or_end > 0 && now >= bundle.or_end) {
      const h = (cs as any).createPriceLine({ price: bundle.or_high, color: "#A78BFA", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "OR-H" });
      const l = (cs as any).createPriceLine({ price: bundle.or_low, color: "#A78BFA", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "OR-L" });
      orLinesRef.current = { h, l };
    } else if (orLines && bundle.or_end > 0 && now < bundle.or_end) {
      try { (cs as any).removePriceLine?.(orLines.h); } catch { /* already gone */ }
      try { (cs as any).removePriceLine?.(orLines.l); } catch { /* already gone */ }
      orLinesRef.current = null;
    }
    const pg = progRef.current;
    const C = bundle.candles;
    const V = bundle.vwap;
    if (now < pg.lastNow) {
      pg.n = 0; pg.v = 0; pg.mkey = ""; pg.subPtr = 0;   // scrubbed back: rebuild
    }
    pg.lastNow = now;
    const nBefore = pg.n;
    while (pg.n < C.length && C[pg.n].time + 60 <= now) pg.n++;
    const vBefore = pg.v;
    // VWAP uses the same completion rule as candles: a minute's value is known only after it ends
    while (pg.v < V.length && V[pg.v].time + 60 <= now) pg.v++;
    // forming bar: aggregate subs of the current minute up to now (≤12 subs, pointer-skipped)
    const mStart = Math.floor(now / 60) * 60;
    while (pg.subPtr < bundle.subs.length && bundle.subs[pg.subPtr].time < mStart) pg.subPtr++;
    const live: Candle[] = [];
    for (let k = pg.subPtr; k < bundle.subs.length; k++) {
      const s = bundle.subs[k];
      if (s.time < mStart) continue;
      if (s.time > now) break;
      live.push(s);
    }
    let forming: { time: Time; open: number; high: number; low: number; close: number } | null = null;
    if (live.length) {
      forming = {
        time: mStart as Time,
        open: live[0].open, high: Math.max(...live.map(s => s.high)),
        low: Math.min(...live.map(s => s.low)), close: live[live.length - 1].close,
      };
    }
    if (pg.n !== nBefore || nBefore === 0) {
      // completed-bar set changed (or first paint): full slice once, then update() only
      cs.setData(C.slice(0, pg.n).map(c => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })));
    }
    if (forming) {
      try { cs.update(forming); } catch (e) { console.debug("replay forming-bar update skipped", e); }
    }
    if (pg.v !== vBefore || vBefore === 0) {
      vs.setData(V.slice(0, pg.v).map(v => ({ time: v.time as Time, value: v.value })));
    }
    const shown = bundle.trades.filter(t => t.time <= now);
    const mkey = shown.map(t => `${t.time}:${t.exit_time <= now ? t.exit_time : ""}`).join("|");
    if (mkey !== pg.mkey) {
      pg.mkey = mkey;
      const exitColor = (r: string) => r === "TP" ? palette.MARKER_TP : r === "EOD" ? "#9CA3AF" : palette.MARKER_SL;
      markersRef.current?.setMarkers(shown.flatMap(t => {
      const isLong = t.side === "LONG";
      const m: any[] = [{
        time: t.time as Time, position: isLong ? "belowBar" : "aboveBar",
        color: isLong ? palette.MARKER_ENTRY : palette.MARKER_SL,
        shape: isLong ? "arrowUp" : "arrowDown",
        text: `${isLong ? "L" : "S"} ${t.entry.toFixed(1)}`,
      }];
      if (t.exit_time <= now) {
        m.push({
          time: t.exit_time as Time, position: isLong ? "aboveBar" : "belowBar",
          color: exitColor(t.result),
          shape: "circle", text: `${t.result} ${t.exit.toFixed(1)}`,
        });
      }
      return m;
    }));
    }
    // R:R boxes for revealed trades (exit edge grows live until the trade closes)
    const rrBox = rrBoxRef.current;
    const container = boxRef.current;
    if (rrBox && container) {
      const rect = container.getBoundingClientRect();
      const H = 420;
      const dpr = window.devicePixelRatio || 1;
      const wpx = Math.max(Math.round(rect.width), 1);
      if (rrWRef.current !== wpx) {   // resize canvas only when the container changes
        rrWRef.current = wpx;
        rrBox.width = wpx * dpr;
        rrBox.height = H * dpr;
        rrBox.style.width = `${rect.width}px`;
        rrBox.style.height = `${H}px`;
      }
      const ctx = rrBox.getContext("2d");
      if (ctx && rect.width > 0) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, H);
        const t2x = (t: number) => chart.timeScale().timeToCoordinate(t as Time);
        const p2y = (p: number) => (cs as unknown as { priceToCoordinate: (v: number) => number | null }).priceToCoordinate(p);
        ctx.font = "600 10px monospace";
        for (const t of shown) {
          // endT must be an exact bar time (exchange-style: forming bar while open)
          const liveEnd = t.exit_time <= now ? t.exit_time : now;
          const endT = Math.floor(liveEnd / 60) * 60;
          const x1 = t2x(t.time);
          const x2 = t2x(endT);
          const yE = p2y(t.entry);
          const yS = p2y(t.sl);
          if (x1 == null || x2 == null || yE == null || yS == null) continue;
          const left = Math.min(x1, x2);
          const w = Math.max(Math.abs(x2 - x1), 3);
          const top = Math.min(yE, yS);
          const h = Math.abs(yS - yE);
          if (h >= 2) {
            ctx.fillStyle = withAlpha(palette.NEGATIVE, 0.13);
            ctx.fillRect(left, top, w, h);
            ctx.strokeStyle = withAlpha(palette.NEGATIVE, 0.55);
            ctx.lineWidth = 1;
            ctx.strokeRect(left + 0.5, top + 0.5, w - 1, Math.max(h - 1, 1));
            ctx.fillStyle = palette.NEGATIVE;
            ctx.fillText(`-${Math.abs(t.entry - t.sl).toFixed(1)}`, Math.min(left + w + 4, rect.width - 60), top + 12);
          }
          const yT = t.tp != null ? p2y(t.tp) : null;
          if (yT != null) {
            const ttop = Math.min(yE, yT);
            const th = Math.abs(yT - yE);
            if (th >= 2) {
              ctx.fillStyle = withAlpha(palette.POSITIVE, 0.13);
              ctx.fillRect(left, ttop, w, th);
              ctx.strokeStyle = withAlpha(palette.POSITIVE, 0.55);
              ctx.strokeRect(left + 0.5, ttop + 0.5, w - 1, Math.max(th - 1, 1));
              ctx.fillStyle = palette.POSITIVE;
              ctx.fillText(`+${Math.abs(t.tp - t.entry).toFixed(1)} (${t.rr >= 0 ? "+" : ""}${t.rr.toFixed(1)}R)`, Math.min(left + w + 4, rect.width - 110), ttop + 12);
            }
          }
          ctx.strokeStyle = palette.MARKER_ENTRY;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(left, yE);
          ctx.lineTo(left + w, yE);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
    // auto-follow only while the user is near the right edge (never yank a manual pan)
    const visRange = chart.timeScale().getVisibleLogicalRange?.();
    if (!visRange || visRange.to == null || visRange.to > pg.n - 12) {
      chart.timeScale().scrollToPosition(6, false);
    }
  }, [bundle]);
  paintRef.current = paint;

  // playback loop: canvas paints at 10fps, React text/table renders at 4fps
  useEffect(() => {
    if (!playing || !bundle || !tEnd) return;
    if (clockRef.current <= 0 && t0 > 0) {
      clockRef.current = t0;
      setClock(t0);
      paintRef.current?.(t0);
    }
    let last: number | null = null;   // lazy: first frame only arms, never jumps
    let lastUi = 0;
    const step = (t: number) => {
      if (last == null) {
        last = t;
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      const dt = (t - last) / 1000;
      last = t;
      const next = Math.min(tEnd, clockRef.current + dt * speedRef.current);
      if (t - lastPaintRef.current > 100 || next >= tEnd) {
        lastPaintRef.current = t;
        clockRef.current = next;
        paintRef.current?.(next);
        if (t - lastUi > 250 || next >= tEnd) {
          lastUi = t;
          setClock(next);
        }
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
  }, [playing, bundle, tEnd]);

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
        1m NQ=F candles, forming bar ticks live from {bundle?.sub_secs ?? 2}s subs{bundle?.basis != null ? ` · basis +${bundle.basis.toFixed(1)}` : ""}{bundle?.hist_bars ? ` · +${bundle.hist_bars} overnight bars` : ""} · OR {bundle?.or_minutes ?? orTf}m{bundle && bundle.candles.length ? ` (${orRangeLabel(bundle.candles[0].time, bundle.or_minutes)})` : ""} · LONG above OR-H + VWAP / SHORT below OR-L + VWAP · SL opposite edge, TP nearest structure · {TZ_IST_LABEL}
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
          <Slider size="small" min={t0} max={tEnd} step={1} value={Math.round(clock)}
            onChange={(_, v) => jump(v as number)} aria-label="replay position" />
        </Box>
        <Typography variant="caption" sx={{ color: "#E5E7EB", fontFamily: "monospace" }}>
          {clock > 0 ? fmtT(clock) : "--:--:--"} · {closed.length}/{revealed.length} closed · net {net > 0 ? "+" : ""}{net.toFixed(1)}
        </Typography>
        {loading && <Chip size="small" label="loading ticks…" sx={{ bgcolor: "#1F2937", color: "#58A6FF" }} />}
        {bundle?.error && <Chip size="small" label={bundle.error} sx={{ bgcolor: "#3B1D1D", color: "#F87171" }} />}
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
        <ReplayTradeTable trades={revealed} clock={clock} onSelectTime={(t) => jump(t)} />
      </Card>
    </Box>
  );
}
