import type { SectorHistoryRisk, SectorHistorySeries } from "../../../types/sectorHistory";

/**
 * Pure model for the risk drawdown panel. The old table column descriptors
 * were removed with the table; keeping the ordering, scale and
 * cumulative-return maths separate makes them directly testable.
 */

export interface RiskRow extends SectorHistoryRisk {
  spark: (number | null)[];
  /** Compounded monthly return, or null when no finite month exists. */
  cumulative: number | null;
  /** Share of the panel-wide drawdown scale, 0–1; null when max_drawdown is missing. */
  barFraction: number | null;
}

export interface RiskModel {
  rows: RiskRow[];
  /** Largest observed |max_drawdown|; 1 when no sector has a measurable drawdown. */
  scale: number;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Compound the monthly returns, clamped at -100% so a bad print cannot flip the sign. */
export function cumulativeReturn(values: (number | null)[]): number | null {
  let factor = 1;
  let seen = false;
  for (const value of values) {
    if (!finite(value)) continue;
    factor *= 1 + Math.max(-100, value) / 100;
    seen = true;
  }
  return seen ? (factor - 1) * 100 : null;
}

function compareRisk(a: RiskRow, b: RiskRow): number {
  const aValue = finite(a.max_drawdown) ? a.max_drawdown : null;
  const bValue = finite(b.max_drawdown) ? b.max_drawdown : null;
  // Null is "not measured", not a zero drawdown; it belongs after every real row.
  if (aValue === null && bValue === null) return a.name.localeCompare(b.name);
  if (aValue === null) return 1;
  if (bValue === null) return -1;
  if (aValue !== bValue) return aValue - bValue;
  return a.name.localeCompare(b.name);
}

export function buildRiskRows(
  inputRisk: SectorHistoryRisk[],
  inputSeries: SectorHistorySeries[],
): RiskModel {
  const risk = Array.isArray(inputRisk) ? inputRisk : [];
  const series = Array.isArray(inputSeries) ? inputSeries : [];
  const sparks = new Map(series.map((item) => [item.name, item.monthly_returns]));

  const rows: RiskRow[] = risk.map((item) => {
    const spark = sparks.get(item.name) ?? [];
    return { ...item, spark, cumulative: cumulativeReturn(spark), barFraction: null };
  });
  rows.sort(compareRisk);

  let scale = 0;
  for (const row of rows) {
    if (finite(row.max_drawdown)) scale = Math.max(scale, Math.abs(row.max_drawdown));
  }
  if (!(scale > 0)) scale = 1;

  return {
    rows: rows.map((row) => ({
      ...row,
      barFraction: finite(row.max_drawdown)
        ? Math.min(1, Math.abs(row.max_drawdown) / scale)
        : null,
    })),
    scale,
  };
}
