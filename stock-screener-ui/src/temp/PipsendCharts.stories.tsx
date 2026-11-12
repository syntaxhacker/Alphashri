import type { Meta, StoryObj } from "@storybook/react-vite";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { Box, Paper, Button, Text, Chip, Tooltip, Divider, Stack } from "@/ui";
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

function toolBtnClass(active: boolean, _accent: string) {
  return `text-[11px] h-5 min-w-[56px] px-2 border rounded-none transition-colors duration-200 ${
    active
      ? `bg-[#21262D] text-[#F0F6FC] border-[#F0F6FC] hover:bg-[#21262D] hover:border-[#F0F6FC]`
      : `bg-transparent text-[#8B949E] border-[#30363D] hover:bg-[#21262D] hover:border-[#F0F6FC]`
  }`;
}

function PipsendChartInner() {
  let containerRef: HTMLDivElement | undefined;
  let chartRef: any;
  let seriesRef: any;
  let toolsRef: any[] = [];
  const [status, setStatus] = createSignal<"loading" | "ready" | "missing" | "error">("loading");
  const [errMsg, setErrMsg] = createSignal<string>("");
  const [activeTool, setActiveTool] = createSignal<"none" | "long" | "short" | "trend">("none");
  const [lastAction, setLastAction] = createSignal<string>("No tool active — click Long / Short / Trend Line");
  const [installed, setInstalled] = createSignal(false);

  // cleanup chart on unmount / before re-init
  const dispose = () => {
    try {
      toolsRef.forEach((t) => {
        try {
          t?.remove?.();
          t?.dispose?.();
        } catch {}
      });
      toolsRef = [];
      if (chartRef?.remove) chartRef.remove();
    } catch {}
    chartRef = undefined;
    seriesRef = undefined;
  };

  createEffect(() => {
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
      if (!containerRef) return;

      const { createChart, CandlestickSeries } = mod;

      // prefer new modular API
      const chart = createChart(containerRef, {
        width: containerRef.clientWidth,
        height: containerRef.clientHeight,
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

      chartRef = chart;
      // CandlestickSeries is either mod.CandlestickSeries or string "Candlestick"
      const seriesKind = CandlestickSeries ?? "Candlestick";
      let series: any = null;
      try {
        series = chart.addSeries(seriesKind, {
          upColor: POS,
          downColor: NEG,
          borderUpColor: POS,
          borderDownColor: NEG,
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
      seriesRef = series;
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
          if (typeof cleanup === "function") toolsRef.push({ remove: cleanup });
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
        if (h) toolsRef.push(h);
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
        if (tl) toolsRef.push(tl);
      }

      // resize observer — pipsend/lightweight needs explicit resize
      const ro = new ResizeObserver(() => {
        if (!containerRef || !chartRef) return;
        chartRef.applyOptions({
          width: containerRef.clientWidth,
          height: containerRef.clientHeight,
        });
      });
      ro.observe(containerRef);

      setInstalled(true);
      setStatus("ready");
      setLastAction("Demo Long + Trend Line added — drag handles on chart. Use toolbar to add more.");

      onCleanup(() => ro.disconnect());
    }

    init();
    onCleanup(() => {
      cancelled = true;
      dispose();
    });
  });

  const handleLong = async () => {
    setActiveTool("long");
    if (!chartRef || !seriesRef) {
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
      h = createPosition({ chart: chartRef, series: seriesRef }, opts);
    } catch {
      try {
        h = createPosition(seriesRef, chartRef, opts);
      } catch (e: any) {
        setLastAction(`Long failed: ${e?.message ?? String(e)}`);
        return;
      }
    }
    if (h) toolsRef.push(h);
    setLastAction(`Long added @ ${base.toFixed(2)} — drag entry/SL/TP`);
  };

  const handleShort = async () => {
    setActiveTool("short");
    if (!chartRef || !seriesRef) {
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
      h = createPosition({ chart: chartRef, series: seriesRef }, opts);
    } catch {
      try {
        h = createPosition(seriesRef, chartRef, opts);
      } catch (e: any) {
        setLastAction(`Short failed: ${e?.message ?? String(e)}`);
        return;
      }
    }
    if (h) toolsRef.push(h);
    setLastAction(`Short added @ ${base.toFixed(2)} — drag entry/SL/TP`);
  };

  const handleTrendLine = async () => {
    setActiveTool("trend");
    if (!chartRef || !seriesRef) {
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
      h = fn({ chart: chartRef, series: seriesRef }, { interactive: true, extendRight: true, lineColor: TEXT_MUTED });
    } catch {
      try {
        h = fn(seriesRef, chartRef, { interactive: true });
      } catch (e: any) {
        setLastAction(`Trend Line failed: ${e?.message ?? String(e)}`);
        return;
      }
    }
    if (h) toolsRef.push(h);
    setLastAction("Trend Line active — click-drag two points on chart");
  };

  const handleClear = () => {
    toolsRef.forEach((t) => {
      try {
        t?.remove?.();
        t?.dispose?.();
      } catch {}
    });
    toolsRef = [];
    setActiveTool("none");
    setLastAction("Cleared — demo tools removed. Add Long/Short/Trend again.");
    // keep candlestick + volume
  };

  const placeholder = status() === "missing" || status() === "error";

  return (
    <Box className="h-[100vh] flex flex-col overflow-hidden" style={{ backgroundColor: BG }}>
      {/* Top toolbar — 48px TradingView-like, dense 20px controls, no blue */}
      <Paper
        className="flex items-center gap-1.5 px-2.5 h-12 min-h-[48px] border-b border-[#30363D] shrink-0 rounded-none"
        style={{ backgroundColor: SURFACE }}
      >
        <Text className="text-[11px] font-bold tracking-[0.6px]" style={{ color: TEXT_MUTED }}>
          PIPSEND
        </Text>
        <Chip
          size="xs"
          label="RELIANCE · 1m · 375"
          className="text-[10px] h-5 ml-1 border border-[#30363D]"
          style={{ backgroundColor: SURFACE_ALT, color: TEXT }}
        />
        <div className="w-[1px] h-[18px] bg-[#30363D] mx-1.5" />

        {/* Pipsend tool buttons — dense 20px, no blue accent */}
        <Tooltip label="Add draggable Long Position (entry/SL/TP)">
          <Button
            size="xs"
            variant={activeTool() === "long" ? "filled" : "outline"}
            onClick={handleLong}
            className={toolBtnClass(activeTool() === "long", TEXT)}
            style={{
              borderColor: activeTool() === "long" ? TEXT : BORDER,
              backgroundColor: activeTool() === "long" ? SURFACE_ALT : "transparent",
              color: activeTool() === "long" ? TEXT : TEXT_MUTED,
            }}
          >
            Long
          </Button>
        </Tooltip>
        <Tooltip label="Add draggable Short Position">
          <Button
            size="xs"
            variant={activeTool() === "short" ? "filled" : "outline"}
            onClick={handleShort}
            className={toolBtnClass(activeTool() === "short", POS)}
            style={{
              borderColor: activeTool() === "short" ? TEXT : BORDER,
              backgroundColor: activeTool() === "short" ? SURFACE_ALT : "transparent",
              color: activeTool() === "short" ? TEXT : TEXT_MUTED,
            }}
          >
            Short
          </Button>
        </Tooltip>
        <Tooltip label="Add Trend Line (click two points, drag to adjust)">
          <Button
            size="xs"
            variant={activeTool() === "trend" ? "filled" : "outline"}
            onClick={handleTrendLine}
            className={toolBtnClass(activeTool() === "trend", TEXT)}
            style={{
              borderColor: activeTool() === "trend" ? TEXT : BORDER,
              backgroundColor: activeTool() === "trend" ? SURFACE_ALT : "transparent",
              color: activeTool() === "trend" ? TEXT : TEXT_MUTED,
            }}
          >
            Trend Line
          </Button>
        </Tooltip>
        <Button
          size="xs"
          variant="outline"
          onClick={handleClear}
          className="text-[10px] h-5 min-w-[48px] px-2 border border-[#30363D] text-[#8B949E] hover:bg-[#21262D] hover:border-[#F0F6FC] hover:text-[#F0F6FC]"
        >
          Clear
        </Button>

        <Box className="flex-1" />
        <Chip
          size="xs"
          label={installed() ? "Pipsend ready" : status() === "loading" ? "Loading…" : "Install required"}
          className="text-[10px] h-5 border border-[#30363D]"
          style={{
            backgroundColor: installed() ? "rgba(63,185,80,0.12)" : SURFACE_ALT,
            color: installed() ? POS : TEXT_MUTED,
            borderColor: installed() ? "rgba(63,185,80,0.35)" : BORDER,
          }}
        />
      </Paper>

      {/* Info bar — 20px dense */}
      <Box
        className="flex items-center gap-2 px-2.5 h-5 min-h-[20px] border-b border-[#30363D] shrink-0"
        style={{ backgroundColor: SURFACE }}
      >
        <Text className="text-[10px] text-[#8B949E]" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {lastAction()}
        </Text>
        <Box className="flex-1" />
        <Text className="text-[10px] text-[#8B949E]">
          Drag handles to adjust — SL/TP update via onDragEnd
        </Text>
      </Box>

      {/* Chart — flex 1, TradingView-like */}
      <Box className="flex-1 min-h-0 flex flex-col gap-1.5 p-1 overflow-hidden">
        <Paper
          className="flex-1 min-h-0 flex flex-col overflow-hidden border border-[#30363D] rounded-sm bg-[#0D1117] relative"
        >
          {/* Canvas mount */}
          <Box ref={(el) => (containerRef = el)} className="flex-1 min-h-[320px] w-full" />

          {/* Missing-install placeholder overlay — keeps story usable before `bun add` */}
          <Show when={placeholder}>
            <Box
              className="absolute inset-0 flex items-center justify-center p-2"
              style={{ backgroundColor: "rgba(13,17,23,0.92)" }}
            >
              <Stack spacing={1} className="max-w-[560px] text-center items-center">
                <Text className="text-[11px] font-bold tracking-[0.6px]" style={{ color: TEXT }}>
                  @pipsend/charts not installed
                </Text>
                <Text className="text-[11px] text-[#8B949E] leading-relaxed">
                  This story is ready — install the package and reload Storybook. No code changes needed.
                </Text>
                <pre
                  className="text-[11px] font-mono bg-[#161B22] border border-[#30363D] rounded-sm p-[12px] pt-[6px] text-[#F0F6FC] m-0 overflow-auto max-w-full"
                >
                  bun add @pipsend/charts
                </pre>
                <Text className="text-[10px] text-[#8B949E]">
                  After install: candlestick (375×1m) + volume + draggable Long/Short + Trend Line via
                  <span className="text-[#F0F6FC] font-mono"> createPositionTool / createTrendLineTool</span>.
                  Toolbar buttons create fresh tools; drag handles fire onDragEnd.
                </Text>
                {errMsg() && (
                  <Text className="text-[10px] text-[#F85149] font-mono" style={{ color: NEG }}>
                    {errMsg()}
                  </Text>
                )}
                <Divider className="w-full border-[#30363D]" />
                <Text className="text-[10px] text-[#8B949E]">
                  Preview uses real 2026-03-20 RELIANCE 1m data (open/high/low/close/volume). Chart theme: BG {BG} · SURFACE {SURFACE} · BORDER {BORDER}.
                </Text>
              </Stack>
            </Box>
          </Show>
        </Paper>

        {/* Bottom meta — dense 20px rows */}
        <Paper className="flex items-center gap-2 px-2.5 h-5 min-h-[20px] border border-[#30363D] rounded-sm shrink-0" style={{ backgroundColor: SURFACE }}>
          <Text className="text-[10px] text-[#8B949E]">
            {rawCandles.length} candles · {rawCandles[0].time} → {rawCandles[rawCandles.length - 1].time} · 1m · volume histogram
          </Text>
          <Box className="flex-1" />
          <Text className="text-[10px] text-[#8B949E]">
            Dense 20px · BG {BG} · no blue
          </Text>
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
