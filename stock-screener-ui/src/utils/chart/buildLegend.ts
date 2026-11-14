/** Tolerates absent series names (`null`/`undefined`) from optional series. */
export function buildLegend(
  seriesNames: Array<string | null | undefined>,
  showLegend: boolean,
  mutedColor?: string,
): any {
  if (!showLegend) return { show: false };

  const unique = [...new Set(seriesNames.filter(Boolean))];
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
