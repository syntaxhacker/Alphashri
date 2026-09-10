import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState, useCallback } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import * as palette from "@/ui/palette";
import oneDayReal from "./oneDayCandles.json";

// palette anchors — dense, no blue
const BG = "#0D1117";
const SURFACE = "#161B22";
const SURFACE_ALT = "#21262D";
const BORDER = "#30363D";
const TEXT = "#F0F6FC";
const TEXT_MUTED = "#8B949E";
const POS = palette.POSITIVE; // #3FB950
const NEG = palette.NEGATIVE; // #F85149

const meta: Meta = {
  title: "Temp/Pipsend Charts",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    backgrounds: { default: "dark" },
    docs: {
      description: {
        component:
          "Pipsend Charts — full-screen TradingView-like demo. 375×1m RELIANCE candles (2026-03-20), candlestick + volume, draggable Long/Short Position and Trend Line tools. Toolbar mirrors TradingView. Requires `bun add @pipsend/charts` — renders placeholder until installed.",
      },
    },
  },
};
export default meta;

// ---- dataset: 375 candles ----
type Raw = { time: string; open: number; high: number; low: number; close: number; volume: number };
const rawCandles: Raw[] = oneDayReal as Raw[];

// Pipsend / lightweight-charts time: unix seconds preferred for intraday
function toPipsendTime(s: string): number {
  // "2026-03-20 09:15" -> unix seconds in IST (+05:30)
  const iso = s.replace(" ", "T") + ":00+05:30";
  return Math.floor(new Date(iso).getTime() / 1000);
}
const pipsendCandles = rawCandles.map((c) => ({
  time: toPipsendTime(c.time) as unknown as string,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
}));
const volumeData = rawCandles.map((c) => ({
  time: toPipsendTime(c.time) as unknown as string,
  value: c.volume,
  // color hint optional — pipsend applyVolume colors by close vs open
  color: c.close >= c.open ? "rgba(63,185,80,0.45)" : "rgba(248,81,73,0.45)",
}));

function PipsendChartInner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const toolsRef = useRef<any[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [errMsg, setErrMsg] = useState<string>("");
  const [activeTool, setActiveTool] = useState<"none" | "long" | "short" | "trend">("none");
  const [lastAction, setLastAction] = useState<string>("No tool active — click Long / Short / Trend Line");
  const [installed, setInstalled] = useState(false);

  // cleanup chart on unmount / before re-init
  const dispose = useCallback(() => {
    try {
      toolsRef.current.forEach((t) => {
        try {
          t?.remove?.();
          t?.dispose?.();
        } catch {}
      });
      toolsRef.current = [];
      if (chartRef.current?.remove) (chartRef.current as any).remove();
    } catch {}
    chartRef.current = null;
    seriesRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setStatus("loading");
      // dynamic import so story compiles even when @pipsend/charts not installed
      let mod: any = null;
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — optional dep, may not be installed
        mod = await import(/* @vite-ignore */ "@pipsend/charts");
      } catch (e: any) {
        if (!cancelled) {
          setStatus("missing");
          setErrMsg(e?.message ?? String(e));
        }
        return;
      }
      if (cancelled) return;
      if (!mod || !mod.createChart) {
        setStatus("missing");
        setErrMsg("createChart not exported — check @pipsend/charts version");
        return;
      }
      if (!containerRef.current) return;

      const { createChart, CandlestickSeries } = mod;

      // prefer new modular API
      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
        layout: {
          background: { color: BG },
          textColor: TEXT,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: SURFACE_ALT },
          horzLines: { color: SURFACE_ALT },
        },
        crosshair: { mode: 0 },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          borderColor: BORDER,
          rightOffset: 6,
          barSpacing: 4,
          minBarSpacing: 2,
        },
        rightPriceScale: { borderColor: BORDER, scaleMargins: { top: 0.06, bottom: 0.22 } },
        handleScroll: true,
        handleScale: true,
      });

      chartRef.current = chart;
      // CandlestickSeries is either mod.CandlestickSeries or string "Candlestick"
      const seriesKind = CandlestickSeries ?? "Candlestick";
      let series: any = null;
      try {
        series = chart.addSeries(seriesKind, {
          upColor: POS,
          downColor: NEG,
          borderUpColor: POS,
          borderDownColor: NEG,
          wickUpColor: POS,
          wickDownColor: NEG,
          borderVisible: false,
          wickVisible: true,
        });
      } catch {
        // fallback for older lightweight-charts shape
        series = (chart as any).addCandlestickSeries?.({
          upColor: POS,
          downColor: NEG,
          borderUpColor: POS,
          borderDownColor: NEG,
          wickUpColor: POS,
          wickDownColor: NEG,
        });
      }
      if (!series) {
        setStatus("error");
        setErrMsg("addSeries(Candlestick) failed");
        return;
      }
      seriesRef.current = series;
      series.setData(pipsendCandles);

      // volume pane — try Pipsend helper first, else native HistogramSeries
      let volumeApplied = false;
      try {
        if (mod.applyVolume && mod.setVolumeData) {
          mod.setVolumeData(series, volumeData as any);
          const cleanup = mod.applyVolume(series, chart, {
            colorUp: "rgba(63,185,80,0.45)",
            colorDown: "rgba(248,81,73,0.45)",
          });
          // keep cleanup handle if returned
          if (typeof cleanup === "function") toolsRef.current.push({ remove: cleanup });
          volumeApplied = true;
        }
      } catch {}
      if (!volumeApplied) {
        try {
          const HistogramSeries = mod.HistogramSeries ?? "Histogram";
          const volSeries: any = chart.addSeries(HistogramSeries, {
            priceScaleId: "",
            priceFormat: { type: "volume" },
            color: "rgba(63,185,80,0.45)",
            priceLineVisible: false,
          });
          volSeries.setData(volumeData);
          // position volume at bottom ~22%
          chart.priceScale("").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        } catch {}
      }

      chart.timeScale().fitContent();

      // ---- demo tools: one Long position + one Trend Line (dense, muted palette) ----
      const createPosition = (mod as any).createLongShortPositionTool ?? (mod as any).createPositionTool ?? null;
      const createTrend = (mod as any).createTrendLineTool ?? null;

      // helper: safe invoke supporting both {chart,series} and (series,chart) signatures
      function tryCreatePosition(opts: any) {
        if (!createPosition) return null;
        const attempts = [
          () => createPosition({ chart, series }, opts),
          () => createPosition(series, chart, opts),
          () => createPosition({ chart, series, pane: 0 } as any, opts),
        ];
        for (const fn of attempts) {
          try {
            const h = fn();
            if (h) return h;
          } catch {}
        }
        return null;
      }
      function tryCreateTrend(opts: any) {
        if (!createTrend) return null;
        const attempts = [
          () => createTrend({ chart, series }, opts),
          () => createTrend(series, chart, opts),
        ];
        for (const fn of attempts) {
          try {
            const h = fn();
            if (h) return h;
          } catch {}
        }
        return null;
      }

      // demo Long at ~11:00 (index 105) — drag handles should move entry/SL/TP
      const demoIdx = 105;
      const demoCandle = rawCandles[demoIdx];
      if (demoCandle && createPosition) {
        const entry = demoCandle.close;
        const h = tryCreatePosition({
          entryPrice: entry,
          stopLoss: +(entry * 0.993).toFixed(2),
          takeProfit: +(entry * 1.012).toFixed(2),
          symbol: "RELIANCE",
          // allow drag — pipsend tools are draggable by default
          onDragEnd: (p: number) => setLastAction(`Position drag → ${p?.toFixed?.(2) ?? p}`),
        } as any);
        if (h) toolsRef.current.push(h);
      }

      // demo Trend Line across a small swing (09:45 → 10:15)
      const t1 = toPipsendTime(rawCandles[30].time) as unknown as number;
      const t2 = toPipsendTime(rawCandles[60].time) as unknown as number;
      if (createTrend) {
        const tl = tryCreateTrend({
          interactive: true,
          extendRight: false,
          lineColor: TEXT_MUTED,
          lineWidth: 1,
          // some versions accept point1/point2, others default to interactive placement
          point1: { time: t1, price: rawCandles[30].low },
          point2: { time: t2, price: rawCandles[60].high },
        } as any);
        if (tl) toolsRef.current.push(tl);
      }

      // resize observer — pipsend/lightweight needs explicit resize
      const ro = new ResizeObserver(() => {
        if (!containerRef.current || !chartRef.current) return;
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      });
      ro.observe(containerRef.current);

      setInstalled(true);
      setStatus("ready");
      setLastAction("Demo Long + Trend Line added — drag handles on chart. Use toolbar to add more.");

      return () => ro.disconnect();
    }

    init();
    return () => {
      cancelled = true;
      dispose();
    };
  }, [dispose]);

  const handleLong = useCallback(async () => {
    setActiveTool("long");
    if (!chartRef.current || !seriesRef.current) {
      setLastAction("Chart not ready yet");
      return;
    }
    let mod: any = null;
    try {
      // @ts-ignore
      mod = await import(/* @vite-ignore */ "@pipsend/charts");
    } catch {
      setLastAction("Install @pipsend/charts first");
      return;
    }
    const createPosition = mod.createLongShortPositionTool ?? mod.createPositionTool;
    if (!createPosition) {
      setLastAction("createLongShortPositionTool not found in this version");
      return;
    }
    const last = pipsendCandles[pipsendCandles.length - 1] as any;
    const base = rawCandles[rawCandles.length - 1]?.close ?? last.close;
    const opts: any = {
      entryPrice: base,
      stopLoss: +(base * 0.992).toFixed(2),
      takeProfit: +(base * 1.015).toFixed(2),
      symbol: "RELIANCE",
      direction: "long",
      onDragEnd: (p: number) => setLastAction(`Long drag → ${p?.toFixed?.(2) ?? p}`),
    };
    let h: any = null;
    try {
      h = createPosition({ chart: chartRef.current, series: seriesRef.current }, opts);
    } catch {
      try {
        h = createPosition(seriesRef.current, chartRef.current, opts);
      } catch (e: any) {
        setLastAction(`Long failed: ${e?.message ?? String(e)}`);
        return;
      }
    }
    if (h) toolsRef.current.push(h);
    setLastAction(`Long added @ ${base.toFixed(2)} — drag entry/SL/TP`);
  }, []);

  const handleShort = useCallback(async () => {
    setActiveTool("short");
    if (!chartRef.current || !seriesRef.current) {
      setLastAction("Chart not ready yet");
      return;
    }
    let mod: any = null;
    try {
      // @ts-ignore
      mod = await import(/* @vite-ignore */ "@pipsend/charts");
    } catch {
      setLastAction("Install @pipsend/charts first");
      return;
    }
    const createPosition = mod.createLongShortPositionTool ?? mod.createPositionTool;
    if (!createPosition) {
      setLastAction("createLongShortPositionTool not found");
      return;
    }
    const base = rawCandles[rawCandles.length - 1]?.close ?? 1425;
    const opts: any = {
      entryPrice: base,
      stopLoss: +(base * 1.008).toFixed(2),
      takeProfit: +(base * 0.985).toFixed(2),
      symbol: "RELIANCE",
      direction: "short",
      onDragEnd: (p: number) => setLastAction(`Short drag → ${p?.toFixed?.(2) ?? p}`),
    };
    let h: any = null;
    try {
      h = createPosition({ chart: chartRef.current, series: seriesRef.current }, opts);
    } catch {
      try {
        h = createPosition(seriesRef.current, chartRef.current, opts);
      } catch (e: any) {
        setLastAction(`Short failed: ${e?.message ?? String(e)}`);
        return;
      }
    }
    if (h) toolsRef.current.push(h);
    setLastAction(`Short added @ ${base.toFixed(2)} — drag entry/SL/TP`);
  }, []);

  const handleTrendLine = useCallback(async () => {
    setActiveTool("trend");
    if (!chartRef.current || !seriesRef.current) {
      setLastAction("Chart not ready yet");
      return;
    }
    let mod: any = null;
    try {
      // @ts-ignore
      mod = await import(/* @vite-ignore */ "@pipsend/charts");
    } catch {
      setLastAction("Install @pipsend/charts first");
      return;
    }
    const fn = mod.createTrendLineTool;
    if (!fn) {
      setLastAction("createTrendLineTool not found");
      return;
    }
    let h: any = null;
    try {
      h = fn({ chart: chartRef.current, series: seriesRef.current }, { interactive: true, extendRight: true, lineColor: TEXT_MUTED });
    } catch {
      try {
        h = fn(seriesRef.current, chartRef.current, { interactive: true });
      } catch (e: any) {
        setLastAction(`Trend Line failed: ${e?.message ?? String(e)}`);
        return;
      }
    }
    if (h) toolsRef.current.push(h);
    setLastAction("Trend Line active — click-drag two points on chart");
  }, []);

  const handleClear = useCallback(() => {
    toolsRef.current.forEach((t) => {
      try {
        t?.remove?.();
        t?.dispose?.();
      } catch {}
    });
    toolsRef.current = [];
    setActiveTool("none");
    setLastAction("Cleared — demo tools removed. Add Long/Short/Trend again.");
    // keep candlestick + volume
  }, []);

  const placeholder = status === "missing" || status === "error";

  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", bgcolor: BG, overflow: "hidden" }}>
      {/* Top toolbar — 48px TradingView-like, dense 20px controls, no blue */}
      <Paper
        elevation={0}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px: 1.25,
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
          PIPSEND
        </Typography>
        <Chip
          size="small"
          label="RELIANCE · 1m · 375"
          sx={{
            fontSize: 10,
            height: 20,
            bgcolor: SURFACE_ALT,
            color: TEXT,
            border: 1,
            borderColor: BORDER,
            ml: 0.5,
          }}
        />
        <Box sx={{ width: 1, height: 18, bgcolor: BORDER, mx: 0.75 }} />

        {/* Pipsend tool buttons — dense 20px, no blue accent */}
        <Tooltip title="Add draggable Long Position (entry/SL/TP)">
          <span>
            <Button
              size="small"
              variant={activeTool === "long" ? "contained" : "outlined"}
              color="inherit"
              onClick={handleLong}
              sx={{
                fontSize: 11,
                height: 20,
                minWidth: 56,
                p: "0 8px",
                borderColor: activeTool === "long" ? TEXT : BORDER,
                bgcolor: activeTool === "long" ? SURFACE_ALT : "transparent",
                color: activeTool === "long" ? TEXT : TEXT_MUTED,
                "&:hover": { bgcolor: SURFACE_ALT, borderColor: TEXT },
              }}
            >
              Long
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="Add draggable Short Position">
          <span>
            <Button
              size="small"
              variant={activeTool === "short" ? "contained" : "outlined"}
              color="inherit"
              onClick={handleShort}
              sx={{
                fontSize: 11,
                height: 20,
                minWidth: 56,
                p: "0 8px",
                borderColor: activeTool === "short" ? TEXT : BORDER,
                bgcolor: activeTool === "short" ? SURFACE_ALT : "transparent",
                color: activeTool === "short" ? TEXT : TEXT_MUTED,
                "&:hover": { bgcolor: SURFACE_ALT, borderColor: TEXT },
              }}
            >
              Short
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="Add Trend Line (click two points, drag to adjust)">
          <span>
            <Button
              size="small"
              variant={activeTool === "trend" ? "contained" : "outlined"}
              color="inherit"
              onClick={handleTrendLine}
              sx={{
                fontSize: 11,
                height: 20,
                minWidth: 84,
                p: "0 8px",
                borderColor: activeTool === "trend" ? TEXT : BORDER,
                bgcolor: activeTool === "trend" ? SURFACE_ALT : "transparent",
                color: activeTool === "trend" ? TEXT : TEXT_MUTED,
                "&:hover": { bgcolor: SURFACE_ALT, borderColor: TEXT },
              }}
            >
              Trend Line
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

        <Box sx={{ flex: 1 }} />
        <Chip
          size="small"
          label={installed ? "Pipsend ready" : status === "loading" ? "Loading…" : "Install required"}
          sx={{
            fontSize: 10,
            height: 20,
            bgcolor: installed ? "rgba(63,185,80,0.12)" : SURFACE_ALT,
            color: installed ? POS : TEXT_MUTED,
            border: 1,
            borderColor: installed ? "rgba(63,185,80,0.35)" : BORDER,
          }}
        />
      </Paper>

      {/* Info bar — 20px dense */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.25,
          height: 20,
          minHeight: 20,
          borderBottom: 1,
          borderColor: BORDER,
          bgcolor: SURFACE,
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" sx={{ fontSize: 10, color: TEXT_MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {lastAction}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ fontSize: 10, color: TEXT_MUTED }}>
          Drag handles to adjust — SL/TP update via onDragEnd
        </Typography>
      </Box>

      {/* Chart — flex 1, TradingView-like */}
      <Box sx={{ flex: 1, minHeight: 0, p: 1, display: "flex", flexDirection: "column", gap: 0.75, overflow: "hidden" }}>
        <Paper
          elevation={0}
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            border: 1,
            borderColor: BORDER,
            borderRadius: 1,
            bgcolor: BG,
            position: "relative",
          }}
        >
          {/* Canvas mount */}
          <Box ref={containerRef} sx={{ flex: 1, minHeight: 320, width: "100%" }} />

          {/* Missing-install placeholder overlay — keeps story usable before `bun add` */}
          {placeholder && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "rgba(13,17,23,0.92)",
                p: 2,
              }}
            >
              <Stack spacing={1.25} sx={{ maxWidth: 560, textAlign: "center", alignItems: "center" }}>
                <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: TEXT }}>
                  @pipsend/charts not installed
                </Typography>
                <Typography variant="caption" sx={{ fontSize: 11, color: TEXT_MUTED, lineHeight: 1.5 }}>
                  This story is ready — install the package and reload Storybook. No code changes needed.
                </Typography>
                <Box
                  component="pre"
                  sx={{
                    fontSize: 11,
                    fontFamily: "monospace",
                    bgcolor: SURFACE,
                    border: 1,
                    borderColor: BORDER,
                    borderRadius: 1,
                    px: 1.5,
                    py: 0.75,
                    color: TEXT,
                    m: 0,
                    overflow: "auto",
                    maxWidth: "100%",
                  }}
                >
                  bun add @pipsend/charts
                </Box>
                <Typography variant="caption" sx={{ fontSize: 10, color: TEXT_MUTED }}>
                  After install: candlestick (375×1m) + volume + draggable Long/Short + Trend Line via
                  <Box component="span" sx={{ color: TEXT, fontFamily: "monospace" }}> createPositionTool / createTrendLineTool</Box>.
                  Toolbar buttons create fresh tools; drag handles fire onDragEnd.
                </Typography>
                {errMsg && (
                  <Typography variant="caption" sx={{ fontSize: 10, color: NEG, fontFamily: "monospace" }}>
                    {errMsg}
                  </Typography>
                )}
                <Divider flexItem sx={{ borderColor: BORDER, width: "100%" }} />
                <Typography variant="caption" sx={{ fontSize: 10, color: TEXT_MUTED }}>
                  Preview uses real 2026-03-20 RELIANCE 1m data (open/high/low/close/volume). Chart theme: BG {BG} · SURFACE {SURFACE} · BORDER {BORDER}.
                </Typography>
              </Stack>
            </Box>
          )}
        </Paper>

        {/* Bottom meta — dense 20px rows */}
        <Paper elevation={0} sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.25, py: 0, height: 20, minHeight: 20, border: 1, borderColor: BORDER, borderRadius: 1, bgcolor: SURFACE, flexShrink: 0 }}>
          <Typography variant="caption" sx={{ fontSize: 10, color: TEXT_MUTED }}>
            {rawCandles.length} candles · {rawCandles[0].time} → {rawCandles[rawCandles.length - 1].time} · 1m · volume histogram
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" sx={{ fontSize: 10, color: TEXT_MUTED }}>
            Dense 20px · BG {BG} · no blue
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
}

export const Default: StoryObj = {
  render: () => <PipsendChartInner />,
  parameters: { layout: "fullscreen" },
};

// Keep alias for discoverability
export const FullScreen: StoryObj = {
  render: () => <PipsendChartInner />,
  parameters: { layout: "fullscreen" },
};
