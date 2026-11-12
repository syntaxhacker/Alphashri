import { createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { loadEcharts } from "../../utils/loadEcharts";

/**
 * Minimal Solid wrapper around echarts. `option` is a thunk evaluated inside
 * a tracking scope, so the chart re-applies whenever anything the option
 * builder reads changes.
 */
export function EChartSolid(props: {
  option: () => Record<string, unknown>;
  style?: JSX.CSSProperties;
  class?: string;
  "data-testid"?: string;
}) {
  let chartEl: HTMLDivElement | undefined;
  let chart: any = null;
  let resizeHandler: (() => void) | null = null;
  let ro: ResizeObserver | null = null;
  const [libReady, setLibReady] = createSignal(false);
  let echartsLib: any = null;

  onMount(async () => {
    const lib = await loadEcharts();
    if (!lib) return;
    echartsLib = lib;
    setLibReady(true);
  });

  onCleanup(() => {
    if (resizeHandler) window.removeEventListener("resize", resizeHandler);
    ro?.disconnect();
    if (chart) {
      chart.dispose();
      chart = null;
    }
  });

  createEffect(() => {
    if (!libReady()) return;
    const option = props.option();
    if (!chart && chartEl) {
      chart = echartsLib.init(chartEl, null);
      resizeHandler = () => chart?.resize();
      window.addEventListener("resize", resizeHandler);
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => chart?.resize());
        ro.observe(chartEl);
      }
    }
    if (!chart) return;
    chart.setOption(option, true);
    chart.resize();
  });

  return (
    <div
      ref={chartEl}
      class={props.class ?? "w-full"}
      style={props.style}
      data-testid={props["data-testid"]}
    />
  );
}
