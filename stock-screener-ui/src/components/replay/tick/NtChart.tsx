// NtChart — base dark lightweight-charts wrapper for tick replay.
// Owns create/dispose/resize/data. Overlays (markers, zones, RR box) compose on top
// via the imperative api or the <OverlayCanvas> + draw helpers in ./overlays.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  createChart, ColorType, CandlestickSeries, HistogramSeries,
  type IChartApi, type ISeriesApi, type Time,
} from "lightweight-charts";
import Box from "@mui/material/Box";
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
}

const NtChart = forwardRef<NtChartApi, NtChartProps>(function NtChart(
  { bars, height = 300, showVolume = false, rightOffset = 4, testid = "nt-chart" }, ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  useImperativeHandle(ref, () => ({
    getChart: () => chartRef.current,
    getSeries: () => seriesRef.current,
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: palette.NT_BG }, textColor: "#E5E7EB" },
      grid: { vertLines: { color: palette.NT_GRID }, horzLines: { color: palette.NT_GRID } },
      width: el.clientWidth,
      height,
      timeScale: { borderColor: palette.NT_GRID, timeVisible: true, secondsVisible: false, rightOffset },
      rightPriceScale: { borderColor: palette.NT_GRID },
    });
    chartRef.current = chart;
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: palette.NT_CANDLE_BULL, downColor: palette.NT_CANDLE_BEAR,
      borderVisible: false, wickVisible: true,
    });
    seriesRef.current = cs as unknown as ISeriesApi<"Candlestick">;
    if (showVolume) {
      const vs = chart.addSeries(HistogramSeries, {
        priceScaleId: "", priceFormat: { type: "volume" }, color: "rgba(120,120,120,0.3)",
      });
      volRef.current = vs as unknown as ISeriesApi<"Histogram">;
      (vs as unknown as { priceScale: () => { applyOptions: (o: unknown) => void } })
        .priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    }
    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      chartRef.current.applyOptions({ width: r.width });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volRef.current = null;
    };
  }, [height, showVolume, rightOffset]);

  useEffect(() => {
    const cs = seriesRef.current as unknown as { setData: (d: unknown[]) => void } | null;
    const vs = volRef.current as unknown as { setData: (d: unknown[]) => void } | null;
    const chart = chartRef.current;
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
  }, [bars]);

  return <Box ref={containerRef} sx={{ width: "100%", height }} data-testid={testid} />;
});

export default NtChart;
