import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const engineered = new Set([10, 12, 60, 62, 120, 122, 160]);
  for (let i = 0; i < count; i++) {
    const time = start + i * 60;
    let open = p;
    let high: number;
    let low: number;
    let close: number;
    if (i === 10) {
      open = 99; high = 100; low = 98; close = 99.2;
    } else if (i === 12) {
      open = 99.5; low = 102; high = 105; close = 104; // bull vs 10 : gap 100->102 =2
    } else if (i === 60) {
      open = 101; high = 102; low = 99; close = 100.5;
    } else if (i === 62) {
      open = 99; high = 98; low = 95; close = 95.5; // bear vs 60 : gap 99->98=1
    } else if (i === 120) {
      open = 99.5; high = 100.5; low = 98.5; close = 99.8;
    } else if (i === 122) {
      open = 100.2; low = 103; high = 106; close = 105; // bull vs 120 : gap 100.5->103=2.5
    } else if (i === 160) {
      open = 101; high = 101.2; low = 96; close = 97; // invert 122 bull
    } else {
      const drift = (rnd() - 0.5) * 0.25;
      close = open + drift;
      high = Math.max(open, close) + 0.35 + rnd() * 0.15;
      low = Math.min(open, close) - 0.35 - rnd() * 0.15;
      // clamp to guarantee no accidental gap vs i-2 (except engineered)
      if (i >= 2 && !engineered.has(i) && !engineered.has(i - 2)) {
        const aHigh = out[i - 2].high;
        const aLow = out[i - 2].low;
        if (low > aHigh) low = aHigh - 0.05;
        if (high < aLow) high = aLow + 0.05;
        // keep OHLC consistent after clamp
        high = Math.max(high, open, close);
        low = Math.min(low, open, close);
      }
    }
    out.push({ time, open: Number(open.toFixed(2)), high: Number(high.toFixed(2)), low: Number(low.toFixed(2)), close: Number(close.toFixed(2)), volume: 100000 + Math.floor(rnd() * 200000) });
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
  const [bars, setBars] = useState<Bar[]>(() => genMockBars(260));
  const [loading, setLoading] = useState(false);
  const [showFvg, setShowFvg] = useState(true);
  const [showIfvg, setShowIfvg] = useState(true);
  const [showHLine, setShowHLine] = useState(true);
  const [showTrend, setShowTrend] = useState(true);
  const [debug, setDebug] = useState("");

  useEffect(() => {
    if (source !== "nq") {
      setBars(genMockBars(260));
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
          setBars(genMockBars(260));
        }
      })
      .catch(() => setBars(genMockBars(260)))
      .finally(() => setLoading(false));
  }, [source]);

  const fvgs = useMemo(() => detectFVG(bars), [bars]);
  const ifvgs = useMemo(() => detectIFVG(bars, fvgs), [bars, fvgs]);

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
    const a = bars[10];
    const b = bars[60];
    if (!a || !b) return null;
    return { t1: a.time as Time, p1: a.low, t2: b.time as Time, p2: b.high };
  }, [bars]);

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
    if (showFvg) {
      for (const f of fvgs) {
        const x1 = timeToX(f.leftTime as Time);
        const x2 = timeToX(f.rightTime as Time);
        const y1 = priceToY(f.top);
        const y2 = priceToY(f.bottom);
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
        const xRight = timeToX(bars[bars.length - 1].time as Time) ?? x2;
        const isBull = f.type === "bull";
        const fill = isBull ? "rgba(0,255,136,0.32)" : "rgba(255,59,48,0.30)";
        const stroke = isBull ? palette.NT_FVG_BULL_STROKE : palette.NT_FVG_BEAR_STROKE;
        const fillFinal = f.mitigated ? (isBull ? "rgba(0,255,136,0.12)" : "rgba(255,59,48,0.12)") : fill;
        drawRect(ctx, x2, y1, xRight, y2, fillFinal, stroke, null);
        ctx.save();
        ctx.fillStyle = stroke;
        ctx.font = "bold 10px monospace";
        ctx.fillText(f.mitigated ? "FVG*" : "FVG", Math.min(x2, xRight) + 4, Math.min(y1, y2) + 13);
        ctx.restore();
        drawn++;
      }
    }
    if (showIfvg) {
      for (const iv of ifvgs) {
        const x1 = timeToX(iv.invertTime as Time);
        const xRight = timeToX(bars[bars.length - 1].time as Time) ?? x1;
        const y1 = priceToY(iv.top);
        const y2 = priceToY(iv.bottom);
        if (x1 == null || xRight == null || y1 == null || y2 == null) continue;
        drawRect(ctx, x1 as number, y1 as number, xRight as number, y2 as number, "rgba(255,215,0,0.30)", palette.NT_IFVG_STROKE, [7, 4]);
        ctx.save();
        ctx.fillStyle = palette.NT_IFVG_STROKE;
        ctx.font = "bold 11px monospace";
        ctx.fillText("iFVG", (x1 as number) + 4, Math.min(y1 as number, y2 as number) + 13);
        ctx.restore();
        drawn++;
      }
    }
    if (showHLine) {
      for (const hl of hLines) {
        const y = priceToY(hl.price);
        if (y == null) continue;
        ctx.save();
        ctx.strokeStyle = palette.NT_HLINE;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(rect.width, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = palette.NT_HLINE;
        ctx.font = "bold 11px monospace";
        const label = `${hl.label} ${hl.price.toFixed(2)}`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(14,14,14,0.85)";
        ctx.fillRect(rect.width - tw - 14, y - 16, tw + 10, 14);
        ctx.fillStyle = palette.NT_HLINE;
        ctx.fillText(label, rect.width - tw - 9, y - 6);
        ctx.restore();
        drawn++;
      }
    }
    if (showTrend && trend) {
      const x1 = timeToX(trend.t1);
      const x2 = timeToX(trend.t2);
      const y1 = priceToY(trend.p1);
      const y2 = priceToY(trend.p2);
      if (x1 != null && x2 != null && y1 != null && y2 != null) {
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
  }, [bars, fvgs, ifvgs, hLines, trend, showFvg, showIfvg, showHLine, showTrend]);

  // init chart once
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

  // push bar data to chart when bars change
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
    requestAnimationFrame(() => {
      const n = drawOverlay();
      setDebug(`drawn=${n} fvgs=${fvgs.length} ifvgs=${ifvgs.length}`);
    });
  }, [bars, fvgs, ifvgs, drawOverlay]);

  // redraw when toggles change
  useEffect(() => {
    const n = drawOverlay();
    setDebug(`drawn=${n} fvgs=${fvgs.length} ifvgs=${ifvgs.length} src=${source}${loading ? " loading" : ""}`);
  }, [drawOverlay, fvgs, ifvgs, source, loading]);

  return (
    <Box sx={{ p: 2, maxWidth: 1200, mx: "auto" }} data-testid="smc-poc">
      <Typography variant="h6" sx={{ color: "#E5E7EB", mb: 0.5 }}>SMC POC — Ninja High-Contrast · FVG / iFVG (programmatic)</Typography>
      <Typography variant="caption" sx={{ color: "#9CA3AF", display: "block", mb: 1 }}>
        {source === "nq" ? "NQ=F yfinance 15m (5d) · real gaps" : "260×1m mock (deterministic, no-noise)"} · <Box component="span" sx={{ color: palette.NT_FVG_BULL_STROKE }}>green bull FVG</Box> · <Box component="span" sx={{ color: palette.NT_FVG_BEAR_STROKE }}>red bear FVG</Box> · <Box component="span" sx={{ color: palette.NT_IFVG_STROKE }}>gold dashed iFVG</Box> · cyan H-line · purple trend
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }} alignItems="center">
        <Chip size="small" label={`FVG: ${fvgs.length}`} sx={{ bgcolor: "#1F2937", color: "#E5E7EB" }} data-testid="chip-fvg-count" />
        <Chip size="small" label={`iFVG: ${ifvgs.length}`} sx={{ bgcolor: "#1F2937", color: palette.NT_IFVG_STROKE }} data-testid="chip-ifvg-count" />
        <Chip size="small" label={`${bars.length} bars ${source}`} sx={{ bgcolor: "#1F2937", color: "#9CA3AF" }} />
        <Chip size="small" label={debug} sx={{ bgcolor: "#111827", color: "#6B7280" }} data-testid="chip-debug" />
        <Box sx={{ flex: 1 }} />
        <FormControlLabel control={<Switch size="small" checked={source === "nq"} onChange={(_, v) => setSource(v ? "nq" : "mock")} />} label={loading ? "Loading NQ…" : "Real NQ (yfinance)"} sx={{ color: "#E5E7EB" }} />
        <FormControlLabel control={<Switch size="small" checked={showFvg} onChange={(_, v) => setShowFvg(v)} />} label="FVG" sx={{ color: "#E5E7EB" }} />
        <FormControlLabel control={<Switch size="small" checked={showIfvg} onChange={(_, v) => setShowIfvg(v)} />} label="iFVG" sx={{ color: palette.NT_IFVG_STROKE }} />
        <FormControlLabel control={<Switch size="small" checked={showHLine} onChange={(_, v) => setShowHLine(v)} />} label="H-Line" sx={{ color: palette.NT_HLINE }} />
        <FormControlLabel control={<Switch size="small" checked={showTrend} onChange={(_, v) => setShowTrend(v)} />} label="Trend" sx={{ color: palette.NT_TREND }} />
      </Stack>
      <Card elevation={0} sx={{ bgcolor: palette.NT_BG, border: `1px solid ${palette.NT_GRID}`, overflow: "hidden" }}>
        <CardContent sx={{ p: 0, position: "relative", height: 420, "&:last-child": { pb: 0 } }}>
          <Box ref={containerRef} sx={{ position: "absolute", inset: 0, width: "100%", height: 420, zIndex: 1 }} data-testid="smc-chart" />
          <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: 420, pointerEvents: "none", zIndex: 2 }} data-testid="smc-overlay" />
        </CardContent>
      </Card>
      {/* plain text list so you can verify even if canvas fails */}
      <Box sx={{ mt: 1, p: 1, bgcolor: "#111827", borderRadius: 1, border: `1px solid ${palette.NT_GRID}` }} data-testid="smc-debug-list">
        <Typography variant="caption" sx={{ color: "#9CA3AF", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          {fvgs.map((f) => `${f.type} ${f.bottom.toFixed(2)}→${f.top.toFixed(2)} idx${f.leftIdx}->${f.rightIdx}${f.mitigated ? " *" : ""}`).join("  |  ") || "no FVG"}
          {"\n"}
          {ifvgs.map((iv) => `i${iv.type} ${iv.bottom.toFixed(2)}→${iv.top.toFixed(2)} inv@${iv.invertIdx}`).join("  |  ") || "no iFVG"}
        </Typography>
      </Box>
      <Typography variant="caption" sx={{ color: "#6B7280", mt: 1, display: "block" }}>
        Rect (FVG/iFVG) via overlay canvas · H-line dashed · Trendline segment. Next: replay cursor <Box component="code" sx={{ bgcolor: "#1F2937", px: 0.5 }}>bars.slice(0, idx)</Box>
      </Typography>
    </Box>
  );
}
