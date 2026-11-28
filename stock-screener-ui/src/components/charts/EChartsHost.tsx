import { createEffect, onCleanup, onMount, type JSX } from "solid-js";
import type * as ECharts from "echarts";
import { loadEcharts } from "../../utils/loadEcharts";

/** Only the lifecycle methods the host owns are exposed to consumers. */
export type EChartsHostInstance = Pick<
  ECharts.ECharts,
  "setOption" | "resize" | "dispose" | "on" | "off"
>;

export interface EChartsHostProps {
  /** Solid accessor: the host tracks it and re-applies when the value changes.
   *  A null/undefined value defers loading until the first real option. */
  option: () => unknown;
  /** Called once with the live instance, after the first option and resize. */
  onReady?: (instance: EChartsHostInstance) => void;
  onClick?: (params: any) => void;
  class?: string;
  style?: JSX.CSSProperties;
  "data-testid"?: string;
  /** Forwarded as `setOption`'s notMerge argument; replace semantics by default. */
  notMerge?: boolean;
  /** Init renderer. Kept configurable so migrated charts keep their renderer. */
  renderer?: "canvas" | "svg";
}

/**
 * One owner for the ECharts lifecycle: lazy load, init, setOption, resize and
 * dispose. Consumers only build options; they never touch the instance.
 */
export function EChartsHost(props: EChartsHostProps) {
  let hostEl: HTMLDivElement | undefined;
  let chart: EChartsHostInstance | undefined;
  let loadStarted = false;
  let disposed = false;
  let hasOption = false;
  let pendingOption: unknown;
  let lastSize: { width: number; height: number } | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let boundClick: ((params: any) => void) | undefined;
  let clickHandler: ((params: any) => void) | undefined;
  let readyNotified = false;

  // An observation can arrive while the host is mounted but its node has been
  // detached (e.g. a window desk removed the panel). ECharts throws when a
  // dead container is resized or re-optioned, so guard every instance call.
  const isAlive = () => !disposed && !!hostEl && hostEl.isConnected !== false;

  const applyOption = (option: unknown) => {
    if (!chart || !isAlive() || option == null) return;
    chart.setOption(option as never, props.notMerge ?? true);
  };

  const resizeChart = () => {
    if (!chart || !isAlive()) return;
    if (lastSize) chart.resize({ width: lastSize.width, height: lastSize.height });
    else chart.resize();
  };

  const ensureChart = () => {
    if (loadStarted || !hasOption || !isAlive()) return;
    loadStarted = true;
    void loadEcharts().then((lib: any) => {
      // The load is async: the host may have been unmounted, or its element
      // detached, before the lazy chunk resolved.
      if (!lib || !isAlive() || chart) return;
      chart = lib.init(hostEl, undefined, {
        renderer: props.renderer ?? "canvas",
      }) as EChartsHostInstance;
      if (clickHandler) {
        chart.on("click", clickHandler);
        boundClick = clickHandler;
      }
      applyOption(pendingOption);
      resizeChart();
      if (!readyNotified) {
        readyNotified = true;
        props.onReady?.(chart);
      }
    });
  };

  createEffect(() => {
    const next = props.option();
    if (next == null) return;
    pendingOption = next;
    hasOption = true;
    if (chart) applyOption(next);
    else ensureChart();
  });

  // Rebind by handler identity: a new closure must not leave the old one
  // firing, and removing the handler must detach it.
  createEffect(() => {
    const next = props.onClick;
    const previous = clickHandler;
    clickHandler = next;
    if (!chart || previous === next) return;
    if (previous && boundClick === previous) {
      chart.off("click", previous);
      boundClick = undefined;
    }
    if (next) {
      chart.on("click", next);
      boundClick = next;
    }
  });

  onMount(() => {
    const el = hostEl;
    if (!el) return;

    window.addEventListener("resize", resizeChart);
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver((entries) => {
        const rect = entries[entries.length - 1]?.contentRect;
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        lastSize = { width: rect.width, height: rect.height };
        resizeChart();
      });
      resizeObserver.observe(el);
    }
  });

  onCleanup(() => {
    disposed = true;
    window.removeEventListener("resize", resizeChart);
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    lastSize = undefined;
    boundClick = undefined;
    clickHandler = undefined;
    try {
      chart?.dispose();
    } catch {
      // A detached canvas can throw on dispose; teardown must still finish.
    }
    chart = undefined;
  });

  return (
    <div
      ref={(el) => (hostEl = el)}
      class={props.class}
      style={props.style}
      data-testid={props["data-testid"]}
    />
  );
}
