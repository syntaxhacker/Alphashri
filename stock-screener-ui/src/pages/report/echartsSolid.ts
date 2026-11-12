/**
 * Solid replacement for src/hooks/useECharts.ts (still React).
 * `echarts.init` on mount, `setChartOption` for updates, dispose on unmount.
 * The dynamic `loadEcharts()` import keeps echarts out of the entry chunk.
 */
import { onCleanup } from "solid-js";
import { loadEcharts } from "../../utils/loadEcharts";

export function createECharts(options: { onChartClick?: (params: unknown) => void } = {}) {
  let el: HTMLDivElement | undefined;
  let chart: {
    setOption: (o: unknown, notMerge?: boolean) => void;
    resize: () => void;
    dispose: () => void;
    on: (event: string, cb: (params: unknown) => void) => void;
  } | null = null;
  let cancelled = false;
  let ro: ResizeObserver | null = null;

  const handleResize = () => chart?.resize();
  window.addEventListener("resize", handleResize);

  onCleanup(() => {
    cancelled = true;
    window.removeEventListener("resize", handleResize);
    ro?.disconnect();
    ro = null;
    chart?.dispose();
    chart = null;
  });

  const setChartOption = async (option: unknown) => {
    if (!el || cancelled) return;
    const echartsLib = await loadEcharts();
    if (!el || cancelled || !echartsLib) return;

    if (!chart) {
      chart = echartsLib.init(el, null);
      if (options.onChartClick) {
        chart.on("click", options.onChartClick);
      }
    }

    chart.setOption(option, true);
    chart.resize();
  };

  return {
    ref: (node: HTMLDivElement) => {
      el = node;
      if (typeof ResizeObserver !== "undefined" && el && !ro) {
        ro = new ResizeObserver(() => chart?.resize());
        ro.observe(el);
      }
    },
    setChartOption,
  };
}
