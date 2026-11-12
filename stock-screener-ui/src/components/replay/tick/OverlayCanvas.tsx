// OverlayCanvas — transparent canvas stacked over NtChart for zones, trends, RR boxes.
// Renders ONLY the <canvas>; the parent must be position:relative (see TickReplayChart).
// Owns DPR sizing + visible-range redraw. Drawing itself lives in ./overlays
// so it stays unit-testable without lightweight-charts.
import { createEffect, onCleanup } from "solid-js";
import type { Time } from "lightweight-charts";
import type { NtChartApi } from "./NtChart";

export interface OverlayCoord {
  timeToX: (t: number) => number | null;
  priceToY: (p: number) => number | null;
  width: number;
  height: number;
}

interface OverlayCanvasProps {
  chartApi: { current: NtChartApi | undefined };
  height?: number;
  draw: (ctx: CanvasRenderingContext2D, coord: OverlayCoord) => void;
  testid?: string;
}

export default function OverlayCanvas(props: OverlayCanvasProps) {
  let canvasRef: HTMLCanvasElement | undefined;

  const redraw = () => {
    const api = props.chartApi?.current;
    const canvas = canvasRef;
    if (!api || !canvas) return;
    const chart = api.getChart();
    const series = api.getSeries();
    if (!chart || !series) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const parent = canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : canvas.getBoundingClientRect();
    const height = props.height ?? 300;
    if (rect.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, height);
    const px = series as unknown as { priceToCoordinate: (v: number) => number | null };
    props.draw(ctx, {
      timeToX: (t: number) => chart.timeScale().timeToCoordinate(t as Time),
      priceToY: (p: number) => px.priceToCoordinate(p),
      width: rect.width,
      height,
    });
  };

  createEffect(() => {
    void props.draw;
    void props.height;
    const api = props.chartApi?.current;
    const chart = api?.getChart();
    if (!chart) return;
    const onVis = () => requestAnimationFrame(redraw);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVis);
    const parent = canvasRef?.parentElement;
    const ro = new ResizeObserver(onVis);
    if (parent) ro.observe(parent);
    requestAnimationFrame(redraw);
    onCleanup(() => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVis);
    });
  });

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: "0", pointerEvents: "none", zIndex: "10" }}
      data-testid={props.testid ?? "nt-overlay"}
    />
  );
}
