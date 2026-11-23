import { createEffect, onCleanup } from "solid-js";
import type { IChartApi } from "lightweight-charts";

export function phoneViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 600px)").matches
  );
}

/**
 * Pin the visible time range to the actual candles.
 *
 * The engine's bar offset and its own fit can leave a multi-bar tail after the
 * last candle, even when the report's CSS already reserves a cutoff lane. This
 * keeps the cutoff rule on the last bar instead of ~80px away from it.
 */
export function usePinnedChartRange(
  getChart: () => IChartApi | null,
  getCount: () => number,
  getRightOffset: () => number,
  getVersion: () => number,
): void {
  createEffect(() => {
    getVersion();
    const chart = getChart();
    const count = getCount();
    if (!chart || count === 0) return;

    const pin = () => {
      if (getChart() !== chart) return;
      const scale = chart.timeScale();
      scale.applyOptions({
        rightOffset: 0,
        rightOffsetPixels: getRightOffset(),
      });
      // Test doubles and older engines may not implement the logical-range API.
      if (typeof scale.setVisibleLogicalRange === "function") {
        scale.setVisibleLogicalRange({ from: 0, to: count - 1 });
      }
    };

    queueMicrotask(pin);
    const timer = setTimeout(pin, 0);
    const late = setTimeout(pin, 120);
    onCleanup(() => {
      clearTimeout(timer);
      clearTimeout(late);
    });
  });
}
