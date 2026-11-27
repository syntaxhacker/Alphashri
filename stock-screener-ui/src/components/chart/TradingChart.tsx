import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { loadEcharts } from "../../utils/loadEcharts";
import { parseTimeToHHMM } from "../../utils/ui-helpers";
import { buildChartOption } from "../../utils/chart/buildChartOption";
import type { ChartInput } from "../../utils/chart/types";
import { Loader } from "@/ui";
import type { JSX } from "solid-js";

export interface TradingChartHandle {
  chartInstance: () => any;
  zoomToTradeByTime: (entryTime: string, exitTime: string) => void;
  zoomToTradeByIndex: (startIdx: number, endIdx: number, total: number) => void;
}

interface TradingChartProps {
  input: ChartInput;
  isLoading?: boolean;
  onTradeClick?: (tradeId: number) => void;
  style?: JSX.CSSProperties;
  /** Solid imperative-handle pattern: called once on mount with the live handle. */
  ref?: (handle: TradingChartHandle) => void;
}

function computeZoomRange(
  startIdx: number,
  endIdx: number,
  total: number,
): { start: number; end: number } {
  const span = endIdx - startIdx + 1;
  const minWindow = Math.min(60, total);
  const pad = Math.max(5, Math.floor((minWindow - span) / 2));
  let start = Math.max(0, startIdx - pad);
  let end = Math.min(total - 1, endIdx + pad);
  if (end - start + 1 < minWindow) {
    if (start === 0) end = Math.min(total - 1, minWindow - 1);
    else start = Math.max(0, end - minWindow + 1);
  }
  return { start, end };
}

function dispatchZoom(chart: any, startIdx: number, endIdx: number, total: number) {
  const { start, end } = computeZoomRange(startIdx, endIdx, total);
  const startPct = (start / total) * 100;
  const endPct = ((end + 1) / total) * 100;
  chart.dispatchAction({
    type: "dataZoom",
    dataZoomIndex: 0,
    start: startPct,
    end: endPct,
  });
  chart.dispatchAction({
    type: "dataZoom",
    dataZoomIndex: 1,
    start: startPct,
    end: endPct,
  });
}

export function TradingChart(props: TradingChartProps) {
  let chartRef: HTMLDivElement | undefined;
  let instance: any = null;
  let disposed = false;
  let allTimes: string[] = [];
  const [ready, setReady] = createSignal(false);

  const onChartClick = (params: any) => {
    if (params?.componentType === "series" && params?.seriesType === "scatter") {
      const data = params.data;
      if (data?.trade_id !== undefined) props.onTradeClick?.(data.trade_id);
    }
  };

  onMount(() => {
    const handleResize = () => instance?.resize();
    window.addEventListener("resize", handleResize);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && chartRef) {
      ro = new ResizeObserver(() => instance?.resize());
      ro.observe(chartRef);
    }

    onCleanup(() => {
      disposed = true;
      window.removeEventListener("resize", handleResize);
      ro?.disconnect();
      instance?.dispose();
      instance = null;
    });

    // Chart creation + data push, in order. The option effect waits on `ready`.
    void (async () => {
      const echartsLib = await loadEcharts();
      if (disposed || !chartRef || !echartsLib) return;
      instance = echartsLib.init(chartRef, null);
      if (props.onTradeClick) instance.on("click", onChartClick);
      setReady(true);
    })();
  });

  // Push the option whenever input/loading changes — after the chart exists.
  createEffect(() => {
    if (!ready()) return;
    if (props.isLoading || !props.input.candles.length) return;

    const times = props.input.candles.map((c) => {
      if (c.time_str) return c.time_str;
      const parts = c.time.split(/[T ]/);
      return parts.length > 1 ? parts[parts.length - 1].substring(0, 5) : c.time.substring(0, 5);
    });
    allTimes = times;

    const option = buildChartOption(props.input);
    void (async () => {
      const echartsLib = await loadEcharts();
      if (disposed || !instance || !echartsLib) return;
      instance.setOption(option, true);
      instance.resize();
    })();
  });

  const handle: TradingChartHandle = {
    chartInstance: () => instance,
    zoomToTradeByTime: (entryTime: string, exitTime: string) => {
      setTimeout(() => {
        if (!instance || !allTimes.length) return;
        const entryKey = parseTimeToHHMM(entryTime);
        const exitKey = parseTimeToHHMM(exitTime);

        let entryIdx = allTimes.findIndex((t) => t === entryKey);
        if (entryIdx === -1) {
          let best = -1;
          for (let i = 0; i < allTimes.length; i++) {
            if (allTimes[i] <= entryKey) best = i;
            else break;
          }
          entryIdx = best >= 0 ? best : 0;
        }

        let exitIdx = allTimes.findIndex((t) => t === exitKey);
        if (exitIdx === -1) {
          let best = -1;
          for (let i = 0; i < allTimes.length; i++) {
            if (allTimes[i] <= exitKey) best = i;
            else break;
          }
          exitIdx = best >= 0 ? best : allTimes.length - 1;
        }

        dispatchZoom(instance, entryIdx, exitIdx, allTimes.length);
      }, 100);
    },
    zoomToTradeByIndex: (startIdx: number, endIdx: number, total: number) => {
      setTimeout(() => {
        if (!instance) return;
        dispatchZoom(instance, startIdx, endIdx, total);
      }, 150);
    },
  };

  onMount(() => {
    props.ref?.(handle);
  });

  return (
    <div
      ref={(el) => (chartRef = el)}
      className={
        props.isLoading
          ? "flex items-center justify-center gap-2 p-2 w-full"
          : "flex items-center justify-center gap-2 p-2 flex-1 min-h-0 w-full"
      }
      style={props.isLoading ? { height: "400px", ...props.style } : props.style}
    >
      <Show when={props.isLoading}>
        <Loader size="lg" />
      </Show>
    </div>
  );
}
