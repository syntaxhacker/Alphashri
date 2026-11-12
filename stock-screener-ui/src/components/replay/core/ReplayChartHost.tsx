// ReplayChartHost — owns the lightweight-charts instance + incremental paint loop for
// the tick-replay POC. Chart mechanics extracted from pages/poc/TickReplay so future
// strategies can reuse the host; the page drives it through the imperative `paint(now)`.
import { createEffect, onCleanup } from "solid-js";
import { createChart, ColorType, CandlestickSeries, LineSeries, createSeriesMarkers, type IChartApi, type Time } from "lightweight-charts";
import * as palette from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import { TZ_IST } from "@/config/constants";
import { fmtClock } from "../format";
import type { ReplayTrade } from "@/components/replay/tick";

export type ReplayCandle = { time: number; open: number; high: number; low: number; close: number };
export type ReplayVwapPt = { time: number; value: number };
export interface OrLevels { or_high: number; or_low: number; or_end: number }

export interface ReplayChartHandle {
  /** paint all revealed bars/markers/RR geometry for the given replay clock */
  paint(now: number): void;
  /** fit the whole loaded session into the viewport (used for the initial idle view) */
  fitContent(): void;
}

interface ReplayChartHostProps {
  bars: ReplayCandle[];
  subs: ReplayCandle[];
  vwap: ReplayVwapPt[];
  levels: OrLevels;
  trades: ReplayTrade[];
  height?: number;
  /** bar duration in seconds (60 intraday, 86400 daily). Defaults to 60. */
  barSeconds?: number;
  /** clock (4fps) — used only to repaint on manual pan/zoom while paused */
  clock: number;
  /** controlled playing state — gates auto-follow + range-change repaints */
  playing: boolean;
  /** imperative handle for the parent (paint / fitContent) */
  ref?: ReplayChartHandle | ((h: ReplayChartHandle) => void);
}

export default function ReplayChartHost(props: ReplayChartHostProps) {
  let boxRef: HTMLDivElement | undefined;
  let chartRef: IChartApi | null = null;
  let seriesRef: any = null;
  let vwapRef: any = null;
  let orLinesRef: { h: unknown; l: unknown } | null = null;
  let markersRef: { setMarkers: (m: unknown[]) => void } | null = null;
  let rrBoxRef: HTMLCanvasElement | null = null;
  let rrWRef = 0; // last canvas css width (resize only on change)
  let paintRef: (now: number) => void = () => {};
  let playingRef = props.playing;
  let clockRefVal = props.clock;
  let paintScheduled = false;
  // incremental paint cursors (reset per data set / on scrub-back)
  const progRef = { n: 0, v: 0, mkey: "", subPtr: 0, lastNow: 0 };

  createEffect(() => { playingRef = props.playing; });
  createEffect(() => { clockRefVal = props.clock; });

  const handle: ReplayChartHandle = {
    paint: (now: number) => paintRef(now),
    fitContent: () => chartRef?.timeScale().fitContent(),
  };
  if (typeof props.ref === "function") props.ref(handle);
  else if (props.ref) props.ref = handle;

  // chart setup (once per data set)
  createEffect(() => {
    const bars = props.bars;
    const height = props.height ?? 420;
    if (!boxRef || !bars.length) return;
    const tickState: { lastDay: string } = { lastDay: "" };
    const chart = createChart(boxRef, {
      layout: { background: { type: ColorType.Solid, color: palette.NT_BG }, textColor: "#E5E7EB" },
      grid: { vertLines: { color: palette.NT_GRID }, horzLines: { color: palette.NT_GRID } },
      width: boxRef.clientWidth,
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
        timeFormatter: (t: Time) => typeof t === "number" ? fmtClock(t) : "",
        locale: "en-IN",
      },
    });
    chartRef = chart;
    const cs = chart.addSeries(CandlestickSeries, { upColor: palette.NT_CANDLE_BULL, downColor: palette.NT_CANDLE_BEAR, borderVisible: false });
    const vs = chart.addSeries(LineSeries, { color: "#F0B90B", lineWidth: 1, priceLineVisible: false, lastValueVisible: true });
    seriesRef = cs;
    vwapRef = vs;
    cs.setData([]);
    vs.setData([]);
    try {
      markersRef = createSeriesMarkers(cs as any, []);
    } catch {
      markersRef = null; // test env without full chart impl
    }
    orLinesRef = null;
    rrWRef = 0;
    progRef.n = 0; progRef.v = 0; progRef.mkey = ""; progRef.subPtr = 0; progRef.lastNow = 0;
    // TV-style R:R overlay (zIndex above LWC panes)
    const rr = document.createElement("canvas");
    rr.style.position = "absolute";
    rr.style.inset = "0";
    rr.style.pointerEvents = "none";
    rr.style.zIndex = "10";
    boxRef.style.position = "relative";
    boxRef.appendChild(rr);
    rrBoxRef = rr;
    const ro = new ResizeObserver(() => {
      if (!boxRef) return;
      chart.applyOptions({ width: boxRef.clientWidth });
      requestAnimationFrame(() => paintRef?.(clockRefVal));
    });
    ro.observe(boxRef);
    const onVis = () => {
      // Break the onVis -> paint -> scroll -> onVis feedback loop: while playing the
      // RAF loop already paints at 10fps, so a range-change repaint is only needed
      // when paused (keeps the R:R overlay aligned after a manual pan/zoom).
      if (playingRef) return;
      if (paintScheduled) return;
      paintScheduled = true;
      requestAnimationFrame(() => {
        paintScheduled = false;
        paintRef?.(clockRefVal);
      });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVis);
    onCleanup(() => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVis);
      try { (cs as any).detachPrimitive?.(markersRef); } catch { /* already gone */ }
      markersRef = null;
      rr.remove();
      rrBoxRef = null;
      chart.remove();
      chartRef = null;
    });
  });

  // paint: completed 1m bars + live-forming bar built from 5s subs
  const paint = (now: number) => {
    const cs = seriesRef, vs = vwapRef, chart = chartRef;
    if (!cs || now <= 0) return;
    const bars = props.bars;
    const subs = props.subs;
    const vwap = props.vwap;
    const levels = props.levels;
    const trades = props.trades;
    const barSeconds = props.barSeconds ?? 60;
    const height = props.height ?? 420;
    // OR levels appear only once the opening-range window has completed (no future leak);
    // scrubbing back before or_end removes them again.
    const orLines = orLinesRef;
    if (!orLines && levels.or_end > 0 && now >= levels.or_end) {
      const h = (cs as any).createPriceLine({ price: levels.or_high, color: palette.NT_TREND, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "OR-H" });
      const l = (cs as any).createPriceLine({ price: levels.or_low, color: palette.NT_TREND, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "OR-L" });
      orLinesRef = { h, l };
    } else if (orLines && levels.or_end > 0 && now < levels.or_end) {
      try { (cs as any).removePriceLine?.(orLines.h); } catch { /* already gone */ }
      try { (cs as any).removePriceLine?.(orLines.l); } catch { /* already gone */ }
      orLinesRef = null;
    }
    const pg = progRef;
    const C = bars;
    const V = vwap;
    if (now < pg.lastNow) {
      pg.n = 0; pg.v = 0; pg.mkey = ""; pg.subPtr = 0; // scrubbed back: rebuild
    }
    pg.lastNow = now;
    const nBefore = pg.n;
    while (pg.n < C.length && C[pg.n].time + barSeconds <= now) pg.n++;
    const vBefore = pg.v;
    // VWAP uses the same completion rule as candles: a bar's value is known only after it ends
    while (pg.v < V.length && V[pg.v].time + barSeconds <= now) pg.v++;
    // forming bar: aggregate subs of the current bar window up to now
    const mStart = Math.floor(now / barSeconds) * barSeconds;
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
      markersRef?.setMarkers(shown.flatMap(t => {
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
    const rrBox = rrBoxRef;
    const container = boxRef;
    if (rrBox && container) {
      const rect = container.getBoundingClientRect();
      const H = height;
      const dpr = window.devicePixelRatio || 1;
      const wpx = Math.max(Math.round(rect.width), 1);
      if (rrWRef !== wpx) { // resize canvas only when the container changes
        rrWRef = wpx;
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
          const endT = Math.floor(liveEnd / barSeconds) * barSeconds;
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
    if (playingRef && (!visRange || visRange.to == null || visRange.to > pg.n - 12)) {
      chart.timeScale().scrollToPosition(6, false);
    }
  };
  paintRef = paint;

  return (
    <div ref={(el) => { boxRef = el; }} class="w-full" style={{ height: `${props.height ?? 420}px` }} data-testid="replay-chart-host" />
  );
}
