import { createEffect, onMount, onCleanup, type JSX } from "solid-js";
import { loadEcharts } from "../../utils/loadEcharts";

/**
 * Minimal Solid wrapper around `echarts.init` — `echarts-for-react` is gone.
 * Mounts the chart once, applies option changes with `notMerge`, keeps it
 * sized to its container and disposes on cleanup.
 *
 * `echarts` is pulled in through `loadEcharts()` so it stays in a lazy chunk
 * instead of the entry bundle.
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
  let chart: any = null;
  let disposed = false;

  const bindEvents = (instance: any) => {
    for (const [name, handler] of Object.entries(props.onEvents ?? {})) {
      instance.off(name);
      instance.on(name, handler);
    }
  };

  onMount(() => {
    const el = chartEl;
    const resize = () => chart?.resize();
    window.addEventListener("resize", resize);
    onCleanup(() => window.removeEventListener("resize", resize));

    if (!el) return;
    void loadEcharts().then((echartsLib) => {
      if (disposed || !echartsLib) return;
      const instance = echartsLib.init(el, undefined, { renderer: "canvas" });
      chart = instance;
      instance.setOption(props.option);
      bindEvents(instance);
    });
  });

  createEffect(() => {
    const option = props.option;
    chart?.setOption(option, { notMerge: true });
  });

  createEffect(() => {
    const events = props.onEvents;
    if (!chart || !events) return;
    bindEvents(chart);
  });

  onCleanup(() => {
    disposed = true;
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