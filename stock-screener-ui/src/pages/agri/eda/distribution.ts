import { IQR_MULTIPLIER } from "./constants";
import {
  finite,
  meanOf,
  modalOf,
  monthLabel,
  monthParts,
  normalizeWindow,
  quantile,
  rowsOf,
  sortedModals,
} from "./shared";
import type { AgriEdaComparePoint, AgriEdaPoint, MonthlyBox, OutlierPoint } from "./types";

/** Distribution of the modal price per calendar month — the box-plot input. */
export function monthlyBox(series: AgriEdaPoint[] | null | undefined): MonthlyBox[] {
  const byMonth = new Map<string, number[]>();
  for (const point of rowsOf(series)) {
    const parts = monthParts(point?.date);
    const value = modalOf(point);
    if (!parts || value == null) continue;
    const bucket = byMonth.get(parts.key);
    if (bucket) bucket.push(value);
    else byMonth.set(parts.key, [value]);
  }
  const boxes: MonthlyBox[] = [];
  for (const month of [...byMonth.keys()].sort()) {
    const values = (byMonth.get(month) as number[]).slice().sort((a, b) => a - b);
    boxes.push({
      month,
      label: monthLabel(month),
      min: values[0],
      q1: quantile(values, 0.25),
      median: quantile(values, 0.5),
      q3: quantile(values, 0.75),
      max: values[values.length - 1],
      mean: meanOf(values),
      count: values.length,
    });
  }
  return boxes;
}

/**
 * Percentile (0–100) of the latest finite modal inside the trailing `window`
 * finite observations. Null until the full window exists, so a short or gappy
 * series cannot claim a rank.
 */
export function pricePercentile(
  series: AgriEdaComparePoint[] | null | undefined,
  window = 90,
): number | null {
  const size = normalizeWindow(window, 90);
  const values: number[] = [];
  for (const point of Array.isArray(series) ? series : []) {
    const value = finite(point?.modal);
    if (value != null) values.push(value);
  }
  if (values.length < size) return null;
  const trailing = values.slice(values.length - size);
  const current = trailing[trailing.length - 1];
  let atOrBelow = 0;
  for (const value of trailing) if (value <= current) atOrBelow++;
  return finite((atOrBelow / trailing.length) * 100);
}

/** Tukey fences from all finite modals; one record per outlying observation. */
export function iqrOutliers(series: AgriEdaPoint[] | null | undefined): OutlierPoint[] {
  const sorted = sortedModals(series);
  if (sorted.length === 0) return [];
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - IQR_MULTIPLIER * iqr;
  const highFence = q3 + IQR_MULTIPLIER * iqr;
  const outliers: OutlierPoint[] = [];
  for (const point of rowsOf(series)) {
    const value = modalOf(point);
    if (value == null) continue;
    const side = value < lowFence ? "low" : value > highFence ? "high" : null;
    if (side == null) continue;
    outliers.push({ date: point.date, modal: value, lowFence, highFence, side });
  }
  return outliers;
}
