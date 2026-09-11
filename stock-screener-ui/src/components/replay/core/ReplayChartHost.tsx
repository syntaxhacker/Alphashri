// ReplayChartHost — owns the lightweight-charts instance + incremental paint loop for
// the tick-replay POC. Chart mechanics extracted from pages/poc/TickReplay so future
// strategies can reuse the host; the page drives it through the imperative `paint(now)`.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { createChart, ColorType, CandlestickSeries, LineSeries, createSeriesMarkers, type IChartApi, type Time } from "lightweight-charts";
import Box from "@mui/material/Box";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import { TZ_IST } from "@/config/constants";
import type { ReplayTrade } from "@/components/replay/tick";

export type ReplayCandle = { time: number; open: number; high: number; low: number; close: number };
export type ReplayVwapPt = { time: number; value: number };
export interface OrLevels { or_high: number; or_low: number; or_end: number }

export interface ReplayChartHandle {
  /** paint all revealed bars/markers/RR geometry for the given replay clock */
  paint(now: number): void;
}

interface ReplayChartHostProps {
  bars: ReplayCandle[];
  subs: ReplayCandle[];
  vwap: ReplayVwapPt[];
  levels: OrLevels;
  trades: ReplayTrade[];
  height?: number;
  /** React clock (4fps) — used only to repaint on manual pan/zoom while paused */
  clock: number;
  /** controlled playing state — gates auto-follow + range-change repaints */
  playing: boolean;
}

const fmtT = (ts: number) =>
  new Date(ts * 1000).toLocaleString("en-IN", { timeZone: TZ_IST, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

const ReplayChartHost = forwardRef<ReplayChartHandle, ReplayChartHostProps>(function ReplayChartHost(
  { bars, subs, vwap, levels, trades, height = 420, clock, playing }, ref,
) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<any>(null);
  const vwapRef = useRef<any>(null);
  const orLinesRef = useRef<{ h: unknown; l: unknown } | null>(null);
  const markersRef = useRef<{ setMarkers: (m: unknown[]) => void } | null>(null);
  const rrBoxRef = useRef<HTMLCanvasElement | null>(null);
  const rrWRef = useRef(0); // last canvas css width (resize only on change)
  const paintRef = useRef<(now: number) => void>(() => {});
  const playingRef = useRef(false);
  const clockRef = useRef(0);
  const paintScheduledRef = useRef(false);
  // incremental paint cursors (reset per data set / on scrub-back)
  const progRef = useRef({ n: 0, v: 0, mkey: "", subPtr: 0, lastNow: 0 });

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { clockRef.current = clock; }, [clock]);

  useImperativeHandle(ref, () => ({
    paint: (now: number) => paintRef.current(now),
  }), []);

  // chart setup (once per data set)
  useEffect(() => {
    if (!boxRef.current || !bars.length) return;
    const tickState: { lastDay: string } = { lastDay: "" };
    const chart = createChart(boxRef.current, {
      layout: { background: { type: ColorType.Solid, color: palette.NT_BG }, textColor: "#E5E7EB" },
      grid: { vertLines: { color: palette.NT_GRID }, horzLines: { color: palette.NT_GRID } },
      width: boxRef.current.clientWidth,
      height,
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
      markersRef.current = null; // test env without full chart impl
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
    const onVis = () => {
      // Break the onVis -> paint -> scroll -> onVis feedback loop: while playing the
      // RAF loop already paints at 10fps, so a range-change repaint is only needed
      // when paused (keeps the R:R overlay aligned after a manual pan/zoom).
      if (playingRef.current) return;
      if (paintScheduledRef.current) return;
      paintScheduledRef.current = true;
      requestAnimationFrame(() => {
        paintScheduledRef.current = false;
        paintRef.current?.(clockRef.current);
      });
    };
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
    // rebuild whenever the fetched data identity changes (bars/subs/vwap arrive together)
  }, [bars, subs, vwap, height]);

  // paint: completed 1m bars + live-forming bar built from 5s subs
  const paint = useCallback((now: number) => {
    const cs = seriesRef.current, vs = vwapRef.current, chart = chartRef.current;
    if (!cs || now <= 0) return;
    // OR levels appear only once the opening-range window has completed (no future leak);
    // scrubbing back before or_end removes them again.
    const orLines = orLinesRef.current;
    if (!orLines && levels.or_end > 0 && now >= levels.or_end) {
      const h = (cs as any).createPriceLine({ price: levels.or_high, color: "#A78BFA", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "OR-H" });
      const l = (cs as any).createPriceLine({ price: levels.or_low, color: "#A78BFA", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "OR-L" });
      orLinesRef.current = { h, l };
    } else if (orLines && levels.or_end > 0 && now < levels.or_end) {
      try { (cs as any).removePriceLine?.(orLines.h); } catch { /* already gone */ }
      try { (cs as any).removePriceLine?.(orLines.l); } catch { /* already gone */ }
      orLinesRef.current = null;
    }
    const pg = progRef.current;
    const C = bars;
    const V = vwap;
    if (now < pg.lastNow) {
      pg.n = 0; pg.v = 0; pg.mkey = ""; pg.subPtr = 0; // scrubbed back: rebuild
    }
    pg.lastNow = now;
    const nBefore = pg.n;
    while (pg.n < C.length && C[pg.n].time + 60 <= now) pg.n++;
    const vBefore = pg.v;
    // VWAP uses the same completion rule as candles: a minute's value is known only after it ends
    while (pg.v < V.length && V[pg.v].time + 60 <= now) pg.v++;
    // forming bar: aggregate subs of the current minute up to now (≤12 subs, pointer-skipped)
    const mStart = Math.floor(now / 60) * 60;
    while (pg.subPtr < subs.length && subs[pg.subPtr].time < mStart) pg.subPtr++;
    const live: ReplayCandle[] = [];
    for (let k = pg.subPtr; k < subs.length; k++) {
      const s = subs[k];
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
    const shown = trades.filter(t => t.time <= now);
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
      const H = height;
      const dpr = window.devicePixelRatio || 1;
      const wpx = Math.max(Math.round(rect.width), 1);
      if (rrWRef.current !== wpx) { // resize canvas only when the container changes
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
          const tp = t.tp;
          const yT = tp != null ? p2y(tp) : null;
          if (yT != null && tp != null) {
            const ttop = Math.min(yE, yT);
            const th = Math.abs(yT - yE);
            if (th >= 2) {
              ctx.fillStyle = withAlpha(palette.POSITIVE, 0.13);
              ctx.fillRect(left, ttop, w, th);
              ctx.strokeStyle = withAlpha(palette.POSITIVE, 0.55);
              ctx.strokeRect(left + 0.5, ttop + 0.5, w - 1, Math.max(th - 1, 1));
              ctx.fillStyle = palette.POSITIVE;
              ctx.fillText(`+${Math.abs(tp - t.entry).toFixed(1)} (${t.rr >= 0 ? "+" : ""}${t.rr.toFixed(1)}R)`, Math.min(left + w + 4, rect.width - 110), ttop + 12);
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
    // auto-follow only while playing AND the user is near the right edge (never yank a manual pan)
    const visRange = chart.timeScale().getVisibleLogicalRange?.();
    if (playingRef.current && (!visRange || visRange.to == null || visRange.to > pg.n - 12)) {
      chart.timeScale().scrollToPosition(6, false);
    }
  }, [bars, subs, vwap, levels, trades, height]);
  paintRef.current = paint;

  return (
    <Box ref={boxRef} data-testid="replay-chart-host" sx={{ width: "100%", height }} />
  );
});

export default ReplayChartHost;
