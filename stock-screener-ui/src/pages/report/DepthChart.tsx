import { onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { loadEcharts } from "../../utils/loadEcharts";

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
 *  instance handle (the common case is covered by `echartsSolid`). `echarts`
 *  itself is loaded lazily via `loadEcharts()` so it stays out of the entry
 *  chunk. */
export function DepthChart(props: DepthChartProps) {
  let el: HTMLDivElement | undefined;
  let chart: any = null;
  let disposed = false;

  onMount(() => {
    const node = el;
    window.addEventListener("resize", resizeHandler);
    if (!node) return;
    void loadEcharts().then((echartsLib) => {
      if (disposed || !echartsLib) return;
      chart = echartsLib.init(node, undefined, { renderer: "canvas" });
      props.onChartReady?.(chart as DepthChartHandle);
    });
  });

  const resizeHandler = () => chart?.resize();

  onCleanup(() => {
    disposed = true;
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
