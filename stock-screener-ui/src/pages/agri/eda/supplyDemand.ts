import { addDays, arrivalsOf, finite, meanOf, modalOf, rowsOf } from "./shared";
import type { AgriEdaPoint, SupplyDemandPoint, SupplyDemandResult } from "./types";

/** Alignment of arrivals with the modal `lagDays` later, plus OLS on finite pairs. */
export function supplyDemand(series: AgriEdaPoint[] | null | undefined, lagDays = 0): SupplyDemandResult {
  const rows = rowsOf(series);
  const lag = Number.isFinite(lagDays) ? Math.trunc(lagDays) : 0;
  const modalByDate = new Map<string, number>();
  for (const point of rows) {
    const value = modalOf(point);
    // Duplicate dates: the last finite modal wins, so nulls never clobber a value.
    if (value != null && typeof point?.date === "string") modalByDate.set(point.date, value);
  }

  const points: SupplyDemandPoint[] = rows.map((point) => {
    const date = typeof point?.date === "string" ? point.date : "";
    return {
      date,
      arrivals_qtl: arrivalsOf(point),
      modal: modalOf(point),
      laggedModal: finite(modalByDate.get(addDays(date, lag)) ?? null),
    };
  });

  const pairs: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    if (point.arrivals_qtl != null && point.laggedModal != null) {
      pairs.push({ x: point.arrivals_qtl, y: point.laggedModal });
    }
  }

  let pearson: number | null = null;
  let slope: number | null = null;
  let intercept: number | null = null;
  let r2: number | null = null;
  if (pairs.length >= 2) {
    const xMean = meanOf(pairs.map((p) => p.x));
    const yMean = meanOf(pairs.map((p) => p.y));
    let sumXX = 0;
    let sumYY = 0;
    let sumXY = 0;
    for (const pair of pairs) {
      const dx = pair.x - xMean;
      const dy = pair.y - yMean;
      sumXX += dx * dx;
      sumYY += dy * dy;
      sumXY += dx * dy;
    }
    if (sumXX > 0 && sumYY > 0) {
      const correlation = sumXY / Math.sqrt(sumXX * sumYY);
      pearson = finite(correlation);
      r2 = finite(correlation * correlation);
    }
    if (sumXX > 0) {
      const gradient = sumXY / sumXX;
      slope = finite(gradient);
      intercept = finite(yMean - gradient * xMean);
    }
  }

  return { points, pearson, slope, intercept, r2, n: pairs.length };
}
