import type { PatternHitDTO } from "@/types/chartPatterns";

/** The upper and lower edges of a pattern's trigger box. */
export interface TriggerLevels {
  /** Top edge of the box (resistance / breakout level). Null when unknown. */
  upper: number | null;
  /** Bottom edge of the box (support level). Null when unknown. */
  lower: number | null;
}

/**
 * Box top/bottom from trendlines, then pivots, then null.
 *
 * Mirrors the logic `PatternCard` uses for consolidation edges (read it, do
 * not import from it): the first point of each non-empty trendline polyline
 * is an edge level; the upper edge is the highest of those (or the highest
 * pivot high), the lower edge is the lowest level below the upper (or the
 * lowest pivot low). Never throws.
 */
export function triggerLevels(hit: PatternHitDTO): TriggerLevels {
  const prices = (hit.trendlines ?? [])
    .filter((line) => line.length > 0)
    .map((line) => line[0]?.price)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p));

  const pivotHighs = (hit.pivots ?? [])
    .filter((p) => p.kind !== "low")
    .map((p) => p.price)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p));

  const upper =
    prices.length > 0
      ? Math.max(...prices)
      : pivotHighs.length > 0
        ? Math.max(...pivotHighs)
        : null;

  const below = upper == null ? prices : prices.filter((p) => p < upper);

  const pivotLows = (hit.pivots ?? [])
    .filter((p) => p.kind !== "high")
    .map((p) => p.price)
    .filter(
      (p): p is number =>
        typeof p === "number" && Number.isFinite(p) && (upper == null || p < upper),
    );

  let lower: number | null = null;
  if (below.length > 0) lower = Math.min(...below);
  else if (pivotLows.length > 0) lower = Math.min(...pivotLows);

  return { upper, lower };
}

/**
 * Signed % from the last close to the upper trigger: `(close - upper) / upper * 100`.
 *
 * `close` is `last_close` (enrichment adds it), falling back to `end_price`.
 * Returns `null` when data is missing or the trigger level is zero / non-finite.
 * Positive = price is above the trigger; negative = below it.
 */
export function triggerDistancePct(hit: PatternHitDTO): number | null {
  const { upper } = triggerLevels(hit);
  const close = hit.last_close ?? hit.end_price ?? null;
  if (
    close == null ||
    upper == null ||
    !Number.isFinite(close) ||
    !Number.isFinite(upper) ||
    upper === 0
  ) {
    return null;
  }
  return ((close - upper) / upper) * 100;
}
