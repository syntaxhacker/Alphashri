import { NEGATIVE, POSITIVE, SURFACE, TEXT_MUTED } from "@/ui/palette";
import { withAlpha } from "@/utils/color";
import { compositeOver, pickTextColor } from "@/utils/contrast";
import { formatSectorPercentage as formatPercentage } from "../sectorUtils";
import type { RotationPeriod, RotationRow } from "@/types/rotation";

export const ROTATION_PERIODS: RotationPeriod[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"];

/** A missing or non-finite return must sort last, never read as a flat 0. */
export function finiteReturn(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface ReturnHeat {
  fill: string;
  ink: string;
}

const HEAT_SCALE = 12;
const HEAT_MAX_TINT = 0.24;

/** Signed heat tint; the ink is picked against the composited fill, not the raw token. */
export function returnHeat(value: number | null | undefined): ReturnHeat {
  const safe = finiteReturn(value);
  if (safe === null) return { fill: "transparent", ink: TEXT_MUTED };
  const intensity = Math.min(Math.abs(safe) / HEAT_SCALE, 1) * HEAT_MAX_TINT;
  const tint = safe >= 0 ? POSITIVE : NEGATIVE;
  return {
    fill: withAlpha(tint, intensity),
    ink: pickTextColor(compositeOver(tint, SURFACE, intensity)),
  };
}

/**
 * Compact heat-cell label. Three-digit returns drop the decimal so a 7.2px
 * monospace advance still fits the 45px column at 390.
 */
export function formatHeatReturn(value: number | null | undefined): string {
  const safe = finiteReturn(value);
  if (safe === null) return "—";
  return formatPercentage(safe, Math.abs(safe) >= 100 ? 0 : 1, true);
}

/**
 * Signed return label with a unit. Zero is neutral: "0.0%", never "+0.0%".
 */
export function formatReturn(value: number | null | undefined, precision = 1): string {
  const safe = finiteReturn(value);
  if (safe === null) return "—";
  return formatPercentage(safe, precision, safe !== 0);
}

export type ReturnTone = "success" | "error" | "dimmed";

/** Zero and missing returns are neutral ink, never the green "positive" tone. */
export function returnTone(value: number | null | undefined): ReturnTone {
  const safe = finiteReturn(value);
  if (safe === null || safe === 0) return "dimmed";
  return safe > 0 ? "success" : "error";
}

export interface SignedBarScale {
  negative: boolean;
  zero: boolean;
  /** Percentage points of the full track (0–50), measured from the centre. */
  width: number;
}

export function signedBarScale(
  value: number | null | undefined,
  maxAbs: number,
): SignedBarScale {
  const safe = finiteReturn(value) ?? 0;
  const bound = Math.max(1e-9, Math.abs(finiteReturn(maxAbs) ?? 0));
  return {
    negative: safe < 0,
    zero: safe === 0,
    width: Math.max(0, Math.min(1, Math.abs(safe) / bound)) * 50,
  };
}

/** Stable descending sort; rows without a finite value sink to the bottom in input order. */
export function sortRowsByPeriod(
  rows: RotationRow[],
  period: RotationPeriod,
): RotationRow[] {
  return rows
    .map((row, index) => ({ row, index, value: finiteReturn(row.returns[period]) }))
    .sort((a, b) => {
      const av = a.value ?? Number.NEGATIVE_INFINITY;
      const bv = b.value ?? Number.NEGATIVE_INFINITY;
      return bv - av || a.index - b.index;
    })
    .map((entry) => entry.row);
}
