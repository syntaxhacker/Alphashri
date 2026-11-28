import { createEffect, onCleanup, onMount, Show, untrack } from "solid-js";
import { Box, Text } from "@/ui";
import { loadEcharts } from "@/utils/loadEcharts";
import {
  disposeCanvasChart,
  initCanvasChart,
  onWindowResize,
  setChartOption,
  useChartInk,
} from "../charts/chartDefaults";

/**
 * The empty state needs a readable box even when nothing else sizes the
 * container; a plotted chart must never reserve space the parent flex could
 * hand to the plot (the dock band does the sizing).
 */
const EMPTY_MIN_HEIGHT = "48px";

/**
 * The one ECharts lifecycle every analytics tab shares: init on mount, canvas
 * renderer, repaint only on a real change, follow the host's size, dispose on
 * unmount.
 *
 * `option` is deliberately NOT a reactive dependency — hosts rebuild it inline
 * on every render, and a fresh object identity must not trigger a paint. The
 * caller-owned `optionKey` is the repaint contract; the resolved theme ink is
 * the second so light mode keeps its higher-contrast labels.
 */
export function AnalyticsChartCore(props: {
  option: unknown;
  /** Changes only when the chart content changes; drives the repaint gate. */
  optionKey: string;
  empty?: boolean;
  emptyText?: string;
  testId?: string;
}) {
  let chartEl: HTMLDivElement | undefined;
  let chart: any = null;
  let disposed = false;
  let resizeObserver: ResizeObserver | undefined;
  let resizeFrame = 0;

  const chartMuted = useChartInk();

  let lastKey = "";
  let lastInk = "";

  const paint = () => {
    if (!chart || disposed) return;
    const key = props.optionKey;
    const ink = chartMuted();
    if (key === lastKey && ink === lastInk) return;
    lastKey = key;
    lastInk = ink;
    setChartOption(chart, untrack(() => props.option));
  };

  const resizeChart = () => {
    // A frame can be queued before init resolves, and the observer can deliver
    // its final entry between dispose and disconnect; neither may touch a dead
    // instance (ECharts throws on resize-after-dispose).
    if (disposed || !chart) return;
    chart.resize();
  };

  /**
   * One resize per frame. A dock band swap repaints several times in a row
   * (scrollbar appears, flex re-measures), and each `resize()` re-lays out the
   * canvas — coalescing keeps the last, correct width from being overwritten by
   * an earlier intermediate one.
   */
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

  onMount(() => {
    const el = chartEl;
    if (!el) return;

    // The observer is the real fix: the container changes width without a
    // window resize (scrollbar, dock maximize, 390 breakpoint) and the canvas
    // kept its old width, so the last x-axis label was clipped. The window
    // listener stays as a fallback when ResizeObserver is unavailable.
    onWindowResize(scheduleResize);
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver((entries) => {
        if (!hasArea(entries)) return;
        scheduleResize();
      });
      resizeObserver.observe(el);
    }
    onCleanup(() => {
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      if (resizeFrame) {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = 0;
      }
    });

    void loadEcharts().then((lib) => {
      chart = initCanvasChart(lib, el, () => disposed || !chartEl);
      if (!chart) return;
      paint();
    });
  });

  createEffect(() => {
    // Read the two real dependencies explicitly; `option` is read untracked in
    // paint() so an inline rebuild with the same key cannot repaint the canvas.
    void props.optionKey;
    void chartMuted();
    paint();
  });

  onCleanup(() => {
    disposed = true;
    chart = disposeCanvasChart(chart);
  });

  const testId = () => props.testId ?? "analytics-chart";

  return (
    <Box
      className="relative min-h-0 flex-1"
      style={props.empty ? { "min-height": EMPTY_MIN_HEIGHT } : undefined}
    >
      <div
        ref={(node) => (chartEl = node)}
        data-testid={testId()}
        style={{ width: "100%", height: "100%" }}
      />
      <Show when={props.empty}>
        <Box
          className="absolute inset-0 flex items-center justify-center"
          data-testid={`${testId()}-empty`}
        >
          <Text size="xs" c="dimmed">
            {props.emptyText ?? "No data"}
          </Text>
        </Box>
      </Show>
    </Box>
  );
}
