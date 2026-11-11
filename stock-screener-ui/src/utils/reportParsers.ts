/**
 * Shared numeric parsers for report modules.
 *
 * Replaces per-file `num()` helpers with two canonical variants:
 * - `safeNum`  → returns a finite `number` (fallback = 0)
 * - `safeNumNull` → returns `number | null` (fallback = null)
 *
 * Both accept `unknown` and handle:
 *   - finite number           → the number
 *   - numeric string          → parsed number
 *   - null / undefined / ""   → fallback
 *   - NaN / Infinity / other  → fallback
 *
 * Plus `median`, the canonical middle-of-set helper (sorts a copy;
 * even-length sets average the two middle values; empty → 0).
 */

export function safeNum(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

export function safeNumNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Median of a set — sorts a copy, averages the mid pair on even length, 0 for empty. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}