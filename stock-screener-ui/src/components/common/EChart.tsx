import { createEffect, onMount, onCleanup, type JSX } from "solid-js";
import { loadEcharts } from "../../utils/loadEcharts";

/**
 * `echarts` is pulled in through `loadEcharts()` so it stays in a lazy chunk
 * instead of the entry bundle.
 */
export function EChart(props: {
  /** Solid evaluates JSX props lazily — pass a memo accessor result so option
   *  updates flow into setOption. */
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
    let observer: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== "undefined") {
      // Flex/grid parents settle after ECharts' first init; without this the
      // canvas keeps its initial 100px height even when the panel grows.
      observer = new ResizeObserver(resize);
      observer.observe(el);
    }
    onCleanup(() => {
      window.removeEventListener("resize", resize);
      observer?.disconnect();
    });

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
      style={{
        ...props.style,
        flex: props.style?.flex ?? "1 1 0%",
        "min-height": props.style?.["min-height"] ?? "0px",
        height: props.style?.height ?? "100%",
        width: props.style?.width ?? "100%",
      }}
      data-testid={props["data-testid"]}
    />
  );
}