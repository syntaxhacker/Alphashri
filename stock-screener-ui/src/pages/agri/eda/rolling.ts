import { BAND_WIDTH, DAY_MS, DEFAULT_MAX_GAP_DAYS } from "./constants";
import {
  dayNumber,
  finite,
  maxGapOf,
  meanOf,
  modalOf,
  normalizeWindow,
  rowsOf,
  stdOf,
} from "./shared";
import type { AgriEdaComparePoint, AgriEdaPoint, RealizedVolatilityResult, RollingPoint } from "./types";

/**
 * Trailing band over the most recent `window` finite modal observations,
 * stopping at any calendar gap wider than `maxGapDays`.
 * A row emits values only once its own gap-bounded segment holds `window`
 * finite values, so the warmup is null after a hole; std is population std and
 * the band is `mean ± 1.5 * std`.
 */
export function rollingStats(
  series: AgriEdaPoint[] | null | undefined,
  window = 7,
  maxGapDays = DEFAULT_MAX_GAP_DAYS,
): RollingPoint[] {
  const rows = rowsOf(series);
  const size = normalizeWindow(window);
  const maxGap = maxGapOf(maxGapDays);
  const values = rows.map(modalOf);
  const gapDays: Array<number | null> = Array.from({ length: rows.length }, () => null);

  let previousDay: number | null = null;
  for (let i = 0; i < rows.length; i++) {
    const day = dayNumber(rows[i]?.date);
    if (day != null && previousDay != null) gapDays[i] = (day - previousDay) / DAY_MS;
    if (day != null) previousDay = day;
  }

  const output: RollingPoint[] = [];
  for (let i = 0; i < rows.length; i++) {
    const current = values[i];
    let mean: number | null = null;
    let volatility: number | null = null;
    let n = 0;
    let skippedGaps = 0;
    if (current != null) {
      const trailing: number[] = [];
      for (let j = i; j >= 0 && trailing.length < size; j--) {
        // gapDays[j + 1] is the hole between rows j and j + 1; never cross it.
        const gap = j < i ? gapDays[j + 1] : null;
        if (gap != null && gap > maxGap) {
          skippedGaps++;
          break;
        }
        const value = values[j];
        if (value != null) trailing.push(value);
      }
      n = trailing.length;
      if (n >= size) {
        mean = meanOf(trailing);
        volatility = stdOf(trailing, mean);
      }
    }
    output.push({
      date: rows[i]?.date ?? "",
      modal: current,
      mean: finite(mean),
      lower: mean != null && volatility != null ? finite(mean - BAND_WIDTH * volatility) : null,
      upper: mean != null && volatility != null ? finite(mean + BAND_WIDTH * volatility) : null,
      volatility: finite(volatility),
      n,
      gapDays: finite(gapDays[i]),
      skippedGaps,
    });
  }
  return output;
}

/**
 * Population std of log returns between adjacent finite modals, skipping any
 * pair whose dates are more than `maxGapDays` apart (inclusive at the boundary).
 * A single return is not an estimate, so `value` is null below two returns.
 */
export function realizedVolatility(
  series: AgriEdaComparePoint[] | null | undefined,
  maxGapDays = DEFAULT_MAX_GAP_DAYS,
): RealizedVolatilityResult {
  const maxGap = maxGapOf(maxGapDays);
  const observations: Array<{ day: number | null; modal: number }> = [];
  for (const point of Array.isArray(series) ? series : []) {
    const modal = finite(point?.modal);
    if (modal == null || modal <= 0) continue;
    observations.push({ day: dayNumber(point?.date), modal });
  }

  const returns: number[] = [];
  let skippedGaps = 0;
  for (let i = 1; i < observations.length; i++) {
    const previous = observations[i - 1];
    const current = observations[i];
    if (previous.day == null || current.day == null) continue;
    const elapsed = (current.day - previous.day) / DAY_MS;
    if (!Number.isFinite(elapsed) || elapsed <= 0) continue;
    if (elapsed > maxGap) {
      skippedGaps++;
      continue;
    }
    const logReturn = Math.log(current.modal / previous.modal);
    if (Number.isFinite(logReturn)) returns.push(logReturn);
  }

  const n = returns.length;
  if (n < 2) return { value: null, n, skippedGaps };
  return { value: finite(stdOf(returns, meanOf(returns))), n, skippedGaps };
}
