/**
 * Solid replacement for src/hooks/useECharts.ts (still React).
 * `echarts.init` on mount, `setChartOption` for updates, dispose on unmount.
 * The dynamic `loadEcharts()` import keeps echarts out of the entry chunk.
 */
import { onCleanup } from "solid-js";
import { loadEcharts } from "../../utils/loadEcharts";

type EChartsHandle = {
  setOption: (o: unknown, notMerge?: boolean) => void;
  resize: () => void;
  dispose: () => void;
  on: (event: string, cb: (params: unknown) => void) => void;
};

export function createECharts(options: { onChartClick?: (params: unknown) => void } = {}) {
  let el: HTMLDivElement | undefined;
  let chart: EChartsHandle | null = null;
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

    // Bind to a local so the non-null narrowing survives the closure.
    let instance = chart;
    if (!instance) {
      instance = echartsLib.init(el, null) as EChartsHandle;
      chart = instance;
      if (options.onChartClick) {
        instance.on("click", options.onChartClick);
      }
    }

    instance.setOption(option, true);
    instance.resize();
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
