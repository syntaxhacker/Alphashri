import { onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import * as echarts from "echarts";

export interface DepthChartHandle {
  resize: () => void;
  setOption: (option: object, opts?: { notMerge?: boolean; lazyUpdate?: boolean }) => void;
}

export interface DepthChartProps {
  /** The echarts option, already built. This wrapper never applies it itself —
   *  the caller drives every setOption so hidden panels make zero ECharts work. */
  option: unknown;
  /** Fires once on mount with the live instance (used to drive resize/setOption). */
  onChartReady?: (instance: DepthChartHandle) => void;
  class?: string;
  style?: JSX.CSSProperties;
  "data-testid"?: string;
  "data-series"?: number;
}

/** Minimal Solid wrapper around `echarts.init` for panels that need the
 *  instance handle (the common case is covered by `echartsSolid`). */
export function DepthChart(props: DepthChartProps) {
  let el: HTMLDivElement | undefined;
  let chart: echarts.ECharts | null = null;

  onMount(() => {
    if (!el) return;
    chart = echarts.init(el, undefined, { renderer: "canvas" });
    window.addEventListener("resize", resizeHandler);
    props.onChartReady?.(chart as unknown as DepthChartHandle);
  });

  const resizeHandler = () => chart?.resize();

  onCleanup(() => {
    window.removeEventListener("resize", resizeHandler);
    chart?.dispose();
    chart = null;
  });

  return (
    <div
      ref={(elRef) => (el = elRef)}
      class={props.class}
      style={{ width: "100%", height: "100%", ...props.style }}
      data-testid={props["data-testid"]}
      data-series={props["data-series"]}
    />
  );
}
