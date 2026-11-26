import type { SectorCorrelationResponse } from "../../../types/sector";

export type CorrelationSector = SectorCorrelationResponse["sectors"][number];

/** Best improvement first; ties resolve so a reorder never rearranges equal rows. */
export function rankChangeRows(sectors: CorrelationSector[]): CorrelationSector[] {
  return [...sectors].sort(
    (a, b) =>
      b.rank_change_1m - a.rank_change_1m ||
      a.rank_current - b.rank_current ||
      a.name.localeCompare(b.name),
  );
}

/** Most volatile versus the benchmark first. */
export function betaRows(sectors: CorrelationSector[]): CorrelationSector[] {
  return [...sectors].sort(
    (a, b) => b.beta_vs_index - a.beta_vs_index || a.name.localeCompare(b.name),
  );
}

/** Current strength rank: #1 first, as in the old rankings table. */
export function strengthRows(sectors: CorrelationSector[]): CorrelationSector[] {
  return [...sectors].sort(
    (a, b) => a.rank_current - b.rank_current || a.name.localeCompare(b.name),
  );
}

export function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
