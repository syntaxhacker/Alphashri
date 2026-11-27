/**
 * Chronological, de-duplicated month keys for the heatmap's category axis.
 *
 * Kept in a `*.columns.ts` module so consumers never declare the axis columns
 * inline; the derivation is data-driven, so it is a factory rather than a static
 * list.
 */
export function heatmapColumns(byRow: Map<string, number | null>[]): string[] {
  return [...new Set(byRow.flatMap((map) => [...map.keys()]))].sort();
}
