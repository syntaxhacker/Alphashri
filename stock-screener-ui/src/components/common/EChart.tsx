import { createEffect, onMount, onCleanup, type JSX } from "solid-js";
import { loadEcharts } from "../../utils/loadEcharts";

const NO_OPTION = Symbol("no-option");

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

  let pendingOption: unknown = props.option;
  let lastAppliedOption: unknown = NO_OPTION;
  let optionFrame = 0;
  let resizeFrame = 0;
  let resizeObserver: ResizeObserver | undefined;
  let boundEvents: Record<string, (params: any) => void> = {};

  const applyOption = () => {
    if (disposed || !chart) return;
    if (pendingOption == null || pendingOption === lastAppliedOption) return;
    lastAppliedOption = pendingOption;
    chart.setOption(pendingOption, { notMerge: true, lazyUpdate: true });
  };

  // One paint per frame. Hosts rebuild options on every poll; without this the
  // canvas is re-laid out for every intermediate value instead of the final one.
  const scheduleOption = () => {
    if (optionFrame) return;
    optionFrame = requestAnimationFrame(() => {
      optionFrame = 0;
      applyOption();
    });
  };

  const resizeChart = () => {
    // A frame can be queued before init resolves, and the observer can deliver
    // its final entry between dispose and disconnect; neither may touch a dead
    // instance (ECharts throws on resize-after-dispose).
    if (disposed || !chart) return;
    chart.resize();
  };

  const scheduleResize = () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      resizeChart();
    });
  };

  const hasArea = (entries: ResizeObserverEntry[]) => {
    const rect = entries[entries.length - 1]?.contentRect;
    return !!rect && rect.width > 0 && rect.height > 0;
  };

  // Diff by handler identity: drop names that disappeared, detach replaced
  // handlers, and leave untouched ones alone so stale closures cannot fire.
  const syncEvents = (instance: any, events: Record<string, (params: any) => void>) => {
    const next: Record<string, (params: any) => void> = {};
    for (const [name, handler] of Object.entries(events)) {
      if (!handler) continue;
      if (boundEvents[name] === handler) {
        next[name] = handler;
        continue;
      }
      if (boundEvents[name]) instance.off(name, boundEvents[name]);
      instance.on(name, handler);
      next[name] = handler;
    }
    for (const name of Object.keys(boundEvents)) {
      if (!(name in next)) instance.off(name, boundEvents[name]);
    }
    boundEvents = next;
  };

  onMount(() => {
    const el = chartEl;
    if (!el) return;

    window.addEventListener("resize", scheduleResize);
    if (typeof ResizeObserver !== "undefined") {
      // Flex/grid parents settle after ECharts' first init; without this the
      // canvas keeps its initial 100px height even when the panel grows.
      resizeObserver = new ResizeObserver((entries) => {
        if (!hasArea(entries)) return;
        scheduleResize();
      });
      resizeObserver.observe(el);
    }

    void loadEcharts().then((echartsLib) => {
      // `disposed` covers unmount-before-load; `chart` guards against a second
      // init if the loader ever resolves more than once.
      if (disposed || !echartsLib || !chartEl || chart) return;
      chart = echartsLib.init(chartEl, undefined, { renderer: "canvas" });
      // The init paint supersedes any frame queued by the option effect.
      if (optionFrame) {
        cancelAnimationFrame(optionFrame);
        optionFrame = 0;
      }
      applyOption();
      syncEvents(chart, props.onEvents ?? {});
    });
  });

  createEffect(() => {
    pendingOption = props.option;
    scheduleOption();
  });

  createEffect(() => {
    const events = props.onEvents;
    if (chart) syncEvents(chart, events ?? {});
  });

  onCleanup(() => {
    disposed = true;
    window.removeEventListener("resize", scheduleResize);
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    if (optionFrame) {
      cancelAnimationFrame(optionFrame);
      optionFrame = 0;
    }
    if (resizeFrame) {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
    }
    boundEvents = {};
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
