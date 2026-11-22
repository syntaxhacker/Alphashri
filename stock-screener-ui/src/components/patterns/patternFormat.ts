
import { formatPercentage } from "@/utils/ui-helpers";
import type { PatternHitDTO } from "@/types/chartPatterns";

function isFiniteNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

export function formatScore(value: number | null | undefined): string {
  return isFiniteNumber(value) ? value.toFixed(1) : "—";
}

export function formatRangePos(value: number | null | undefined): string {
  return isFiniteNumber(value) ? `${Math.round(value)}%` : "—";
}

export function formatOneDecimal(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatSignedPct1(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;
}

export function hitLastPrice(
  hit: Pick<PatternHitDTO, "last_close" | "end_price">,
): number {
  return hit.last_close ?? hit.end_price;
}

export function hitChangePct(
  hit: Pick<PatternHitDTO, "day_change_pct" | "start_price" | "end_price">,
): number {
  if (hit.day_change_pct != null) return hit.day_change_pct;
  return hit.start_price !== 0 ? ((hit.end_price - hit.start_price) / hit.start_price) * 100 : 0;
}

export function formatMatrixPrice(v: number | null | undefined): string {
  if (!isFiniteNumber(v)) return "—";
  return `₹${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatMatrixPct(v: number | null | undefined): string {
  if (!isFiniteNumber(v)) return "—";
  return formatPercentage(v, 2);
}
