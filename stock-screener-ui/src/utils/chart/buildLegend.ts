/** ECharts legend bag; `show: false` is the only field when hidden. */
export interface ChartLegend extends Record<string, unknown> {
  show?: boolean;
  data?: string[];
  bottom?: number;
  type?: string;
  itemWidth?: number;
  itemHeight?: number;
  itemGap?: number;
  textStyle?: { color: string };
}

/** Tolerates absent series names (`null`/`undefined`) from optional series. */
export function buildLegend(
  seriesNames: Array<string | null | undefined>,
  showLegend: boolean,
  mutedColor?: string,
): ChartLegend {
  if (!showLegend) return { show: false };

  const unique = [...new Set(seriesNames.filter((n): n is string => Boolean(n)))];
  return {
    data: unique,
    bottom: 6,
    type: "scroll",
    itemWidth: 14,
    itemHeight: 10,
    itemGap: 8,
    ...(mutedColor ? { textStyle: { color: mutedColor } } : {}),
  };
}
