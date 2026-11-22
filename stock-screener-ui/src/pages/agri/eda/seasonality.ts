import { finite, meanOf, modalOf, monthParts, quantile, rowsOf } from "./shared";
import type {
  AgriEdaCompareSeries,
  AgriEdaPoint,
  HeatmapMonth,
  HeatmapRow,
  SeasonalityBucket,
  SeasonalityResult,
} from "./types";

/** Month-of-year aggregates. `weak` is true when fewer than two years exist. */
export function seasonality(series: AgriEdaPoint[] | null | undefined): SeasonalityResult {
  const byMonth = new Map<number, number[]>();
  const years = new Map<number, Set<string>>();
  for (const point of rowsOf(series)) {
    const parts = monthParts(point?.date);
    const value = modalOf(point);
    if (!parts || value == null) continue;
    const values = byMonth.get(parts.month);
    if (values) values.push(value);
    else byMonth.set(parts.month, [value]);
    const seen = years.get(parts.month);
    if (seen) seen.add(parts.year);
    else years.set(parts.month, new Set([parts.year]));
  }
  const months: SeasonalityBucket[] = [];
  for (const month of [...byMonth.keys()].sort((a, b) => a - b)) {
    const values = (byMonth.get(month) as number[]).slice().sort((a, b) => a - b);
    months.push({
      month,
      avg: meanOf(values),
      median: quantile(values, 0.5),
      min: values[0],
      max: values[values.length - 1],
      years: (years.get(month) as Set<string>).size,
      count: values.length,
    });
  }
  return { months, weak: months.length === 0 || months.some((month) => month.years < 2) };
}

/** Mean modal per `YYYY-MM` for each comparison series, ordered by input. */
export function monthlyHeatmap(seriesByKey: AgriEdaCompareSeries[] | null | undefined): HeatmapRow[] {
  const source = Array.isArray(seriesByKey) ? seriesByKey : [];
  const rows: HeatmapRow[] = [];
  for (const entry of source) {
    if (!entry || typeof entry.key !== "string") continue;
    const byMonth = new Map<string, number[]>();
    for (const point of Array.isArray(entry.points) ? entry.points : []) {
      const parts = monthParts(point?.date);
      const value = finite(point?.modal);
      if (!parts || value == null) continue;
      const bucket = byMonth.get(parts.key);
      if (bucket) bucket.push(value);
      else byMonth.set(parts.key, [value]);
    }
    const months: HeatmapMonth[] = [];
    for (const month of [...byMonth.keys()].sort()) {
      const values = byMonth.get(month) as number[];
      months.push({ month, modal: meanOf(values) });
    }
    rows.push({ key: entry.key, label: typeof entry.label === "string" ? entry.label : entry.key, months });
  }
  return rows;
}
