// NtChart — base dark lightweight-charts wrapper for tick replay.
// Owns create/dispose/resize/data. Overlays (markers, zones, RR box) compose on top
// via the imperative api or the <OverlayCanvas> + draw helpers in ./overlays.
import { createEffect, onCleanup } from "solid-js";
import {
  createChart, ColorType, CandlestickSeries, HistogramSeries,
  type IChartApi, type ISeriesApi, type Time,
} from "lightweight-charts";
import * as palette from "@/ui/palette";
import type { Bar } from "./types";

export interface NtChartApi {
  getChart: () => IChartApi | null;
  getSeries: () => ISeriesApi<"Candlestick"> | null;
}

interface NtChartProps {
  bars: Bar[];
  height?: number;
  showVolume?: boolean;
  rightOffset?: number;
  testid?: string;
  /** Imperative handle invoked with the live chart api once the chart exists. */
  ref?: NtChartApi | ((api: NtChartApi) => void);
}

export default function NtChart(props: NtChartProps) {
  let containerRef: HTMLDivElement | undefined;
  let chartRef: IChartApi | null = null;
  let seriesRef: ISeriesApi<"Candlestick"> | null = null;
  let volRef: ISeriesApi<"Histogram"> | null = null;

  const api: NtChartApi = {
    getChart: () => chartRef,
    getSeries: () => seriesRef,
  };
  if (typeof props.ref === "function") props.ref(api);
  else if (props.ref) props.ref = api;

  // chart setup — recreated when the height/volume/offset props change
  createEffect(() => {
    const height = props.height ?? 300;
    const showVolume = props.showVolume;
    const rightOffset = props.rightOffset ?? 4;
    const el = containerRef;
    if (!el) return;

    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: palette.NT_BG }, textColor: palette.REPLAY_CHART_TEXT },
      grid: { vertLines: { color: palette.NT_GRID }, horzLines: { color: palette.NT_GRID } },
      width: el.clientWidth,
      height,
      timeScale: { "border-color": palette.NT_GRID, timeVisible: true, secondsVisible: false, rightOffset },
      rightPriceScale: { "border-color": palette.NT_GRID },
    });
    chartRef = chart;
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: palette.NT_CANDLE_BULL, downColor: palette.NT_CANDLE_BEAR,
      borderVisible: false, wickVisible: true,
    });
    seriesRef = cs as unknown as ISeriesApi<"Candlestick">;
    if (showVolume) {
      const vs = chart.addSeries(HistogramSeries, {
        priceScaleId: "", priceFormat: { type: "volume" }, color: "rgba(120,120,120,0.3)",
      });
      volRef = vs as unknown as ISeriesApi<"Histogram">;
      (vs as unknown as { priceScale: () => { applyOptions: (o: unknown) => void } })
        .priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    } else {
      volRef = null;
    }
    const ro = new ResizeObserver(() => {
      if (!containerRef || !chartRef) return;
      const r = containerRef.getBoundingClientRect();
      chartRef.applyOptions({ width: r.width });
    });
    ro.observe(el);
    onCleanup(() => {
      ro.disconnect();
      chart.remove();
      chartRef = null;
      seriesRef = null;
      volRef = null;
    });
  });

  // data update — full setData on every bars identity change
  createEffect(() => {
    const bars = props.bars;
    const cs = seriesRef as unknown as { setData: (d: unknown[]) => void } | null;
    const vs = volRef as unknown as { setData: (d: unknown[]) => void } | null;
    const chart = chartRef;
    if (!cs || !chart) return;
    cs.setData(bars.map((b) => ({
      time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close,
    })));
    if (vs) {
      vs.setData(bars.map((b) => ({
        time: b.time as Time, value: b.volume ?? 0,
        color: b.close >= b.open ? "rgba(0,255,136,0.45)" : "rgba(255,59,48,0.45)",
      })));
    }
    chart.timeScale().fitContent();
  });

  return (
    <div
      ref={(el) => { containerRef = el; }}
      class="w-full"
      style={{ height: `${props.height ?? 300}px` }}
      data-testid={props.testid ?? "nt-chart"}
    />
  );
}
