import { useCallback, useEffect, useRef, useState } from "react";
import { createChart, ColorType, CandlestickSeries, HistogramSeries, type IChartApi, type ISeriesApi, type CandlestickData, type HistogramData, type Time } from "lightweight-charts";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import Chip from "@mui/material/Chip";
import * as palette from "@/ui/palette";
import type { Bar } from "@/utils/smc";

function genCleanBars(count = 260): Bar[] {
  const out: Bar[] = [];
  let p = 100;
  const start = Math.floor(Date.now() / 1000) - count * 60;
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const time = start + i * 60;
    const open = p;
    const drift = (rnd() - 0.5) * 0.25;
    const close = open + drift;
    const high = Math.max(open, close) + 0.35 + rnd() * 0.15;
    const low = Math.min(open, close) - 0.35 - rnd() * 0.15;
    // enforce no gaps vs i-2 so chart is clean
    let h = high;
    let l = low;
    if (i >= 2) {
      const aHigh = out[i - 2].high;
      const aLow = out[i - 2].low;
      if (l > aHigh) l = aHigh - 0.05;
      if (h < aLow) h = aLow + 0.05;
      h = Math.max(h, open, close);
      l = Math.min(l, open, close);
    }
    out.push({ time, open: Number(open.toFixed(2)), high: Number(h.toFixed(2)), low: Number(l.toFixed(2)), close: Number(close.toFixed(2)), volume: 100000 + Math.floor(rnd() * 200000) });
    p = out[out.length - 1].close;
  }
  return out;
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  fill: string,
  stroke: string,
  dash: number[] | null,
) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  if (w < 2 || h < 2) return;
  ctx.save();
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.6;
  if (dash) ctx.setLineDash(dash);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
}

export default function SmcPoc() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const [source, setSource] = useState<"mock" | "nq">("nq");
  const [bars, setBars] = useState<Bar[]>(() => genCleanBars(260));
  const [loading, setLoading] = useState(false);
  const [showRect, setShowRect] = useState(true);
  const [showTrend, setShowTrend] = useState(true);

  useEffect(() => {
    if (source !== "nq") {
      setBars(genCleanBars(260));
      return;
    }
    setLoading(true);
    fetch("/api/poc/nq?period=5d&interval=15m")
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.bars) && j.bars.length > 10) {
          const cleaned: Bar[] = j.bars.map((b: Bar) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 }));
          setBars(cleaned);
        } else {
          setBars(genCleanBars(260));
        }
      })
      .catch(() => setBars(genCleanBars(260)))
      .finally(() => setLoading(false));
  }, [source]);

  // programmatic rectangles + trendlines (no FVG) — ultra simple, 2 rects + 1 trend
  const rects = (() => {
    if (bars.length < 80) return [];
    const a = bars[20];
    const b = bars[60];
    const c = bars[140];
    const d = bars[180];
    if (!a || !b || !c || !d) return [];
    // rect1: support zone near bars 20-60, rect2: resistance near 140-180
    return [
      { t1: a.time as Time, t2: b.time as Time, top: Math.max(...bars.slice(20, 61).map((x) => x.high)), bottom: Math.min(...bars.slice(20, 61).map((x) => x.low)), label: "SUPPLY" },
      { t1: c.time as Time, t2: d.time as Time, top: Math.max(...bars.slice(140, 181).map((x) => x.high)), bottom: Math.min(...bars.slice(140, 181).map((x) => x.low)), label: "DEMAND" },
    ];
  })();

  const trends = (() => {
    if (bars.length < 70) return [];
    const p1 = bars[10];
    const p2 = bars[65];
    if (!p1 || !p2) return [];
    return [{ t1: p1.time as Time, p1: p1.low, t2: p2.time as Time, p2: p2.high }];
  })();

  const drawOverlay = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!chart || !series || !canvas || !container) return 0;
    const ctx = canvas.getContext("2d");
    if (!ctx) return 0;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0) return 0;
    canvas.width = rect.width * dpr;
    canvas.height = 420 * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `420px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, 420);

    const timeToX = (t: Time) => chart.timeScale().timeToCoordinate(t);
    const priceToY = (p: number) => (series as unknown as { priceToCoordinate: (pr: number) => number | null }).priceToCoordinate(p);

    let drawn = 0;
    if (showRect) {
      for (const r of rects) {
        const x1 = timeToX(r.t1);
        const x2 = timeToX(r.t2);
        const y1 = priceToY(r.top);
        const y2 = priceToY(r.bottom);
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
        drawRect(ctx, x1, y1, x2, y2, "rgba(168,85,247,0.18)", "#A78BFA", null);
        ctx.save();
        ctx.fillStyle = "#A78BFA";
        ctx.font = "bold 10px monospace";
        ctx.fillText(r.label, Math.min(x1, x2) + 4, Math.min(y1, y2) + 13);
        ctx.restore();
        drawn++;
      }
    }
    if (showTrend) {
      for (const tr of trends) {
        const x1 = timeToX(tr.t1);
        const x2 = timeToX(tr.t2);
        const y1 = priceToY(tr.p1);
        const y2 = priceToY(tr.p2);
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
        ctx.save();
        ctx.strokeStyle = palette.NT_TREND;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.fillStyle = palette.NT_TREND;
        ctx.beginPath(); ctx.arc(x1, y1, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x2, y2, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        drawn++;
      }
    }
    return drawn;
  }, [bars, rects, trends, showRect, showTrend]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: palette.NT_BG }, textColor: "#E5E7EB" },
      grid: { vertLines: { color: palette.NT_GRID }, horzLines: { color: palette.NT_GRID } },
      width: containerRef.current.clientWidth,
      height: 420,
      timeScale: { borderColor: palette.NT_GRID, timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 5 },
      rightPriceScale: { borderColor: palette.NT_GRID },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: palette.NT_CANDLE_BULL,
      downColor: palette.NT_CANDLE_BEAR,
      borderUpColor: palette.NT_CANDLE_BULL,
      borderDownColor: palette.NT_CANDLE_BEAR,
      wickUpColor: palette.NT_CANDLE_BULL,
      wickDownColor: palette.NT_CANDLE_BEAR,
      borderVisible: false,
      wickVisible: true,
    });
    seriesRef.current = cs as unknown as ISeriesApi<"Candlestick">;
    const vs = chart.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, color: "rgba(120,120,120,0.3)" });
    volSeriesRef.current = vs as unknown as ISeriesApi<"Histogram">;
    (vs as unknown as { priceScale: () => { applyOptions: (o: unknown) => void } }).priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      requestAnimationFrame(() => drawOverlay());
    });
    ro.observe(containerRef.current);
    const onVis = () => requestAnimationFrame(() => drawOverlay());
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVis);
    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVis);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cs = seriesRef.current as unknown as { setData: (d: CandlestickData[]) => void } | null;
    const vs = volSeriesRef.current as unknown as { setData: (d: HistogramData[]) => void } | null;
    const chart = chartRef.current;
    if (!cs || !vs || !chart) return;
    const candleData: CandlestickData[] = bars.map((b) => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close }));
    cs.setData(candleData);
    const volData: HistogramData[] = bars.map((b) => ({ time: b.time as Time, value: b.volume ?? 0, color: b.close >= b.open ? "rgba(0,255,136,0.45)" : "rgba(255,59,48,0.45)" })) as unknown as HistogramData[];
    vs.setData(volData);
    chart.timeScale().fitContent();
    requestAnimationFrame(() => drawOverlay());
  }, [bars, drawOverlay]);

  useEffect(() => { drawOverlay(); }, [drawOverlay]);

  return (
    <Box sx={{ p: 2, maxWidth: 1200, mx: "auto" }} data-testid="smc-poc">
      <Typography variant="h6" sx={{ color: "#E5E7EB", mb: 0.5 }}>POC — Trendline + Rectangle (programmatic)</Typography>
      <Typography variant="caption" sx={{ color: "#9CA3AF", display: "block", mb: 1 }}>
        {source === "nq" ? "NQ=F yfinance 15m (5d)" : "Clean mock 1m (no gaps)"} · <Box component="span" sx={{ color: "#A78BFA" }}>purple = rectangle</Box> · <Box component="span" sx={{ color: palette.NT_TREND }}>purple trend</Box> · ultra-simple, no FVG
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }} alignItems="center">
        <Chip size="small" label={`${bars.length} bars ${source}${loading ? " loading…" : ""}`} sx={{ bgcolor: "#1F2937", color: "#9CA3AF" }} />
        <Box sx={{ flex: 1 }} />
        <FormControlLabel control={<Switch size="small" checked={source === "nq"} onChange={(_, v) => setSource(v ? "nq" : "mock")} />} label="Real NQ" sx={{ color: "#E5E7EB" }} />
        <FormControlLabel control={<Switch size="small" checked={showRect} onChange={(_, v) => setShowRect(v)} />} label="Rect" sx={{ color: "#A78BFA" }} />
        <FormControlLabel control={<Switch size="small" checked={showTrend} onChange={(_, v) => setShowTrend(v)} />} label="Trend" sx={{ color: palette.NT_TREND }} />
      </Stack>
      <Card elevation={0} sx={{ bgcolor: palette.NT_BG, border: `1px solid ${palette.NT_GRID}`, overflow: "hidden" }}>
        <CardContent sx={{ p: 0, position: "relative", height: 420, "&:last-child": { pb: 0 } }}>
          <Box ref={containerRef} sx={{ position: "absolute", inset: 0, width: "100%", height: 420, zIndex: 1 }} data-testid="smc-chart" />
          <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: 420, pointerEvents: "none", zIndex: 2 }} data-testid="smc-overlay" />
        </CardContent>
      </Card>
      <Typography variant="caption" sx={{ color: "#6B7280", mt: 1, display: "block" }}>
        Programmatic API demo: <Box component="code" sx={{ bgcolor: "#1F2937", px: 0.5 }}>drawRect(t1,pTop,t2,pBottom)</Box> + <Box component="code" sx={{ bgcolor: "#1F2937", px: 0.5 }}>drawTrendline(t1,p1,t2,p2)</Box> via overlay canvas. Extend to automate strategies.
      </Typography>
    </Box>
  );
}
