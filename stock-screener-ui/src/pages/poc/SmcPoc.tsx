import { useEffect, useMemo, useRef, useState } from "react";
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
import { detectFVG, detectIFVG, type Bar } from "@/utils/smc";

function genMockBars(count = 260): Bar[] {
  const out: Bar[] = [];
  let p = 100;
  const start = Math.floor(Date.now() / 1000) - count * 60;
  for (let i = 0; i < count; i++) {
    const time = start + i * 60;
    // engineered FVGs:
    // 10-12 bull gap, 60-62 bear gap, 120-122 bull gap that inverts at ~160
    let open = p;
    let close: number;
    let high: number;
    let low: number;
    if (i === 12) {
      // bull FVG vs i=10
      open = p + 0.8;
      low = 102;
      high = 105;
      close = 104;
    } else if (i === 62) {
      open = p - 0.6;
      high = 98;
      low = 95;
      close = 95.5;
      // ensure bear gap vs 60 (which has high ~100, low 99)
    } else if (i === 122) {
      open = p + 0.7;
      low = 103;
      high = 106;
      close = 105;
    } else if (i === 160) {
      // invert the 120-122 bull: close below its bottom (~100-102)
      open = 101;
      high = 101.2;
      low = 96;
      close = 97;
    } else {
      const drift = (Math.random() - 0.48) * 1.2;
      close = open + drift;
      high = Math.max(open, close) + Math.random() * 0.6;
      low = Math.min(open, close) - Math.random() * 0.6;
    }
    // fix engineered refs: keep bar 10 stable for bull gap 10-12
    if (i === 10) {
      open = 99;
      high = 100;
      low = 98;
      close = 99.2;
    }
    if (i === 60) {
      open = 101;
      high = 102;
      low = 99;
      close = 100.5;
    }
    if (i === 120) {
      open = 99.5;
      high = 100.5;
      low = 98.5;
      close = 99.8;
    }
    out.push({ time, open: Number(open.toFixed(2)), high: Number(high.toFixed(2)), low: Number(low.toFixed(2)), close: Number(close.toFixed(2)), volume: 100000 + Math.floor(Math.random() * 200000) });
    p = close;
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
  if (w < 2 || h < 1) return;
  ctx.save();
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  if (dash) ctx.setLineDash(dash);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
}

export default function SmcPoc() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const bars = useMemo(() => genMockBars(260), []);
  const [showFvg, setShowFvg] = useState(true);
  const [showIfvg, setShowIfvg] = useState(true);
  const [showHLine, setShowHLine] = useState(true);
  const [showTrend, setShowTrend] = useState(true);

  const fvgs = useMemo(() => detectFVG(bars), [bars]);
  const ifvgs = useMemo(() => detectIFVG(bars, fvgs), [bars, fvgs]);

  // swing H-line: highest high and lowest low of last 80 bars
  const hLines = useMemo(() => {
    const slice = bars.slice(-80);
    const maxH = Math.max(...slice.map((b) => b.high));
    const minL = Math.min(...slice.map((b) => b.low));
    return [
      { price: Number(maxH.toFixed(2)), label: "Swing H" },
      { price: Number(minL.toFixed(2)), label: "Swing L" },
    ];
  }, [bars]);

  const trend = useMemo(() => {
    // connect bar 10 low to bar 60 high for demo
    const a = bars[10];
    const b = bars[60];
    if (!a || !b) return null;
    return { t1: a.time as Time, p1: a.low, t2: b.time as Time, p2: b.high };
  }, [bars]);

  // init chart
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
    (vs as unknown as { priceScale: () => { applyOptions: (o: unknown) => void } }).priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    const candleData: CandlestickData[] = bars.map((b) => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close }));
    (cs as unknown as { setData: (d: CandlestickData[]) => void }).setData(candleData);
    const volData: HistogramData[] = bars.map((b) => ({ time: b.time as Time, value: b.volume ?? 0, color: b.close >= b.open ? "rgba(0,255,136,0.5)" : "rgba(255,59,48,0.5)" }));
    (vs as unknown as { setData: (d: HistogramData[]) => void }).setData(volData as unknown as HistogramData[]);

    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      drawOverlay();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drawOverlay = () => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const canvas = canvasRef.current;
    if (!chart || !series || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const container = containerRef.current;
    if (!container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 420 * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `420px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, 420);

    const timeToX = (t: Time) => chart.timeScale().timeToCoordinate(t);
    const priceToY = (p: number) => (series as unknown as { priceToCoordinate: (pr: number) => number | null }).priceToCoordinate(p);

    // FVG rects
    if (showFvg) {
      for (const f of fvgs) {
        const x1 = timeToX(f.leftTime as Time);
        const x2 = timeToX(f.rightTime as Time);
        const y1 = priceToY(f.top);
        const y2 = priceToY(f.bottom);
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
        // extend to current right edge for visibility
        const x2e = timeToX(bars[bars.length - 1].time as Time) ?? x2;
        const isBull = f.type === "bull";
        const fill = isBull ? palette.NT_FVG_BULL_FILL : palette.NT_FVG_BEAR_FILL;
        const stroke = isBull ? palette.NT_FVG_BULL_STROKE : palette.NT_FVG_BEAR_STROKE;
        // if mitigated dim
        const alphaFill = f.mitigated ? (isBull ? "rgba(0,255,136,0.08)" : "rgba(255,59,48,0.08)") : fill;
        drawRect(ctx, x2, y1, x2e, y2, alphaFill, stroke, null);
        // label
        ctx.save();
        ctx.fillStyle = stroke;
        ctx.font = "10px monospace";
        ctx.fillText(f.mitigated ? "FVG*" : "FVG", Math.min(x2, x2e) + 4, Math.min(y1, y2) + 12);
        ctx.restore();
      }
    }
    // iFVG gold dashed
    if (showIfvg) {
      for (const iv of ifvgs) {
        const x1 = timeToX(iv.invertTime as Time);
        const x2 = timeToX(bars[bars.length - 1].time as Time) ?? x1;
        const y1 = priceToY(iv.top);
        const y2 = priceToY(iv.bottom);
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
        drawRect(ctx, x1 as number, y1 as number, x2 as number, y2 as number, palette.NT_IFVG_FILL, palette.NT_IFVG_STROKE, [6, 4]);
        ctx.save();
        ctx.fillStyle = palette.NT_IFVG_STROKE;
        ctx.font = "bold 10px monospace";
        ctx.fillText("iFVG", (x1 as number) + 4, Math.min(y1 as number, y2 as number) + 12);
        ctx.restore();
      }
    }
    // H-lines
    if (showHLine) {
      for (const hl of hLines) {
        const y = priceToY(hl.price);
        if (y == null) continue;
        ctx.save();
        ctx.strokeStyle = palette.NT_HLINE;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(rect.width, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = palette.NT_HLINE;
        ctx.font = "10px monospace";
        ctx.fillText(`${hl.label} ${hl.price.toFixed(2)}`, rect.width - 120, y - 4);
        ctx.restore();
      }
    }
    // Trendline
    if (showTrend && trend) {
      const x1 = timeToX(trend.t1);
      const x2 = timeToX(trend.t2);
      const y1 = priceToY(trend.p1);
      const y2 = priceToY(trend.p2);
      if (x1 != null && x2 != null && y1 != null && y2 != null) {
        ctx.save();
        ctx.strokeStyle = palette.NT_TREND;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        // arrow heads
        ctx.fillStyle = palette.NT_TREND;
        ctx.beginPath();
        ctx.arc(x1, y1, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x2, y2, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  };

  // redraw on toggles or resize/timeScale change
  useEffect(() => {
    drawOverlay();
    const chart = chartRef.current;
    if (!chart) return;
    const handler = () => drawOverlay();
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    // lightweight-charts also needs price scale? priceToCoordinate updates on visible range change
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFvg, showIfvg, showHLine, showTrend, fvgs, ifvgs]);

  return (
    <Box sx={{ p: 2, maxWidth: 1200, mx: "auto" }} data-testid="smc-poc">
      <Typography variant="h6" sx={{ color: "#E5E7EB", mb: 0.5 }}>SMC POC — Ninja High-Contrast · FVG / iFVG (programmatic)</Typography>
      <Typography variant="caption" sx={{ color: "#9CA3AF", display: "block", mb: 1 }}>
        260×1m mock bars · green = bull FVG · red = bear FVG · gold dashed = iFVG (close beyond gap) · cyan dashed = H-line · purple = trendline
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }} alignItems="center">
        <Chip size="small" label={`FVG: ${fvgs.length}`} sx={{ bgcolor: "#1F2937", color: "#E5E7EB" }} data-testid="chip-fvg-count" />
        <Chip size="small" label={`iFVG: ${ifvgs.length}`} sx={{ bgcolor: "#1F2937", color: palette.NT_IFVG_STROKE }} data-testid="chip-ifvg-count" />
        <Chip size="small" label={`${bars.length} bars`} sx={{ bgcolor: "#1F2937", color: "#9CA3AF" }} />
        <Box sx={{ flex: 1 }} />
        <FormControlLabel control={<Switch size="small" checked={showFvg} onChange={(_, v) => setShowFvg(v)} />} label="FVG" sx={{ color: "#E5E7EB" }} />
        <FormControlLabel control={<Switch size="small" checked={showIfvg} onChange={(_, v) => setShowIfvg(v)} />} label="iFVG" sx={{ color: palette.NT_IFVG_STROKE }} />
        <FormControlLabel control={<Switch size="small" checked={showHLine} onChange={(_, v) => setShowHLine(v)} />} label="H-Line" sx={{ color: palette.NT_HLINE }} />
        <FormControlLabel control={<Switch size="small" checked={showTrend} onChange={(_, v) => setShowTrend(v)} />} label="Trend" sx={{ color: palette.NT_TREND }} />
      </Stack>
      <Card elevation={0} sx={{ bgcolor: palette.NT_BG, border: `1px solid ${palette.NT_GRID}`, overflow: "hidden" }}>
        <CardContent sx={{ p: 0, position: "relative", height: 420, "&:last-child": { pb: 0 } }}>
          <Box ref={containerRef} sx={{ position: "absolute", inset: 0, width: "100%", height: 420 }} data-testid="smc-chart" />
          {/* overlay canvas - pointerEvents none, programmatic only */}
          <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: 420, pointerEvents: "none" }} data-testid="smc-overlay" />
        </CardContent>
      </Card>
      <Typography variant="caption" sx={{ color: "#6B7280", mt: 1, display: "block" }}>
        Programmatic API: rect (FVG/iFVG) via canvas overlay · hline via dashed line · trendline via line segment. Extend to strategy: `detectFVG(bars)` → auto-draw via same primitives. Next: wire to replay cursor `bars.slice(0, idx)`.
      </Typography>
    </Box>
  );
}
