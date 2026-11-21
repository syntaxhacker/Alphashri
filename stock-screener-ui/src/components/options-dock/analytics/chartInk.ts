import { useColorScheme } from "@/ui";
import * as palette from "@/ui/palette";

/**
 * ECharts paints labels on a canvas, which cannot resolve `var(...)`. Read the
 * computed theme token so a scheme flip repaints the axis ink instead of
 * leaving the dark anchor baked into the option.
 */
export function chartMutedInk(): string {
  if (typeof document === "undefined") return palette.CHART_MUTED;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-fin-text-muted")
    .trim();
  return value || palette.CHART_MUTED;
}

/** Reactive accessor for use inside an option memo. */
export function useChartInk(): () => string {
  const { colorScheme } = useColorScheme();
  return () => {
    void colorScheme();
    return chartMutedInk();
  };
}
