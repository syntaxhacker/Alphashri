import { createEffect, onMount, onCleanup, type JSX } from "solid-js";
import * as echarts from "echarts";

/**
 * Minimal Solid wrapper around `echarts.init` — `echarts-for-react` is gone.
 * Mounts the chart once, applies option changes with `notMerge`, keeps it
 * sized to its container and disposes on cleanup.
 */
export function EChart(props: {
  /** The echarts option. Solid evaluates JSX props lazily — pass a memo accessor
   *  result and option updates flow into setOption. */
  option: unknown;
  onEvents?: Record<string, (params: any) => void>;
  class?: string;
  style?: JSX.CSSProperties;
  "data-testid"?: string;
}) {
  let chartEl: HTMLDivElement | undefined;
  let chart: echarts.ECharts | null = null;

  onMount(() => {
    if (!chartEl) return;
    chart = echarts.init(chartEl, undefined, { renderer: "canvas" });
    chart.setOption(props.option as echarts.EChartsCoreOption);
    const resize = () => chart?.resize();
    window.addEventListener("resize", resize);
    onCleanup(() => window.removeEventListener("resize", resize));
  });

  createEffect(() => {
    const option = props.option as echarts.EChartsCoreOption;
    chart?.setOption(option, { notMerge: true });
  });

  createEffect(() => {
    const events = props.onEvents;
    if (!chart) return;
    for (const [name, handler] of Object.entries(events ?? {})) {
      chart.off(name);
      chart.on(name, handler);
    }
  });

  onCleanup(() => {
    chart?.dispose();
    chart = null;
  });

  return (
    <div
      ref={(node) => (chartEl = node)}
      class={props.class}
      style={{ ...props.style, height: props.style?.height ?? "100%", width: props.style?.width ?? "100%" }}
      data-testid={props["data-testid"]}
    />
  );
}
