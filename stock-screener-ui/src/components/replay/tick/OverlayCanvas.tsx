// OverlayCanvas — transparent canvas stacked over NtChart for zones, trends, RR boxes.
// Renders ONLY the <canvas>; the parent must be position:relative (see TickReplayChart).
// Owns DPR sizing + visible-range redraw. Drawing itself lives in ./overlays
// so it stays unit-testable without lightweight-charts.
import { useCallback, useEffect, useRef } from "react";
import type { Time } from "lightweight-charts";
import type { NtChartApi } from "./NtChart";

export interface OverlayCoord {
  timeToX: (t: number) => number | null;
  priceToY: (p: number) => number | null;
  width: number;
  height: number;
}

interface OverlayCanvasProps {
  chartApi: React.RefObject<NtChartApi | null>;
  height?: number;
  draw: (ctx: CanvasRenderingContext2D, coord: OverlayCoord) => void;
  testid?: string;
}

export default function OverlayCanvas({ chartApi, height = 300, draw, testid = "nt-overlay" }: OverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const redraw = useCallback(() => {
    const api = chartApi.current;
    const canvas = canvasRef.current;
    if (!api || !canvas) return;
    const chart = api.getChart();
    const series = api.getSeries();
    if (!chart || !series) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const parent = canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, height);
    const px = series as unknown as { priceToCoordinate: (v: number) => number | null };
    drawRef.current(ctx, {
      timeToX: (t: number) => chart.timeScale().timeToCoordinate(t as Time),
      priceToY: (p: number) => px.priceToCoordinate(p),
      width: rect.width,
      height,
    });
  }, [chartApi, height]);

  useEffect(() => {
    const api = chartApi.current;
    const chart = api?.getChart();
    if (!chart) return;
    const onVis = () => requestAnimationFrame(redraw);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVis);
    const parent = canvasRef.current?.parentElement;
    const ro = new ResizeObserver(onVis);
    if (parent) ro.observe(parent);
    requestAnimationFrame(redraw);
    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVis);
    };
  }, [chartApi, redraw]);

  useEffect(() => { redraw(); }, [redraw, draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10 }}
      data-testid={testid}
    />
  );
}
