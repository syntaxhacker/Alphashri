/**
 * Chart Patterns catalog — the single source of truth for the pattern list.
 *
 * The filter rail renders per-pattern sub-filters from this file, and the
 * quality/status help tooltips read their copy from here. Keep it in sync with
 * the backend detector registry (`chart_patterns/`).
 */

/** One selectable pattern in the catalog. */
export interface PatternCatalogEntry {
  /** Backend `pattern_id` used as the filter/query value. */
  id: string;
  /** Human display name. */
  name: string;
  /** Owning family id (`reversal` | `continuation` | `curve_cup`). */
  family: string;
}

/** An ordered family group holding its patterns. */
export interface PatternFamilyGroup {
  id: string;
  label: string;
  patterns: PatternCatalogEntry[];
}

/** Ordered families with the full pattern catalog. */
export const PATTERN_FAMILIES: PatternFamilyGroup[] = [
  {
    id: "reversal",
    label: "Reversal",
    patterns: [
      { id: "falling_wedge", name: "Falling Wedge", family: "reversal" },
      { id: "rising_wedge", name: "Rising Wedge", family: "reversal" },
      { id: "diamond_bottom", name: "Diamond Bottom", family: "reversal" },
      { id: "triple_bottom", name: "Triple Bottom", family: "reversal" },
      { id: "double_bottom", name: "Double Bottom", family: "reversal" },
      { id: "head_shoulders", name: "Head & Shoulders", family: "reversal" },
      { id: "inverse_head_shoulders", name: "Inverse Head & Shoulders", family: "reversal" },
      { id: "rounding_bottom", name: "Rounding Bottom", family: "reversal" },
    ],
  },
  {
    id: "continuation",
    label: "Continuation",
    patterns: [
      { id: "ascending_channel", name: "Ascending Channel", family: "continuation" },
      { id: "descending_channel", name: "Descending Channel", family: "continuation" },
      { id: "bull_flag", name: "Bull Flag", family: "continuation" },
      { id: "bear_flag", name: "Bear Flag", family: "continuation" },
      { id: "pennant", name: "Pennant", family: "continuation" },
      { id: "rectangle", name: "Rectangle", family: "continuation" },
      { id: "ascending_triangle", name: "Ascending Triangle", family: "continuation" },
      { id: "descending_triangle", name: "Descending Triangle", family: "continuation" },
      { id: "consolidation", name: "Consolidation", family: "continuation" },
    ],
  },
  {
    id: "curve_cup",
    label: "Curve & Cup",
    patterns: [
      { id: "curve_bearish", name: "Curve Bearish", family: "curve_cup" },
      { id: "cup_handle", name: "Cup & Handle", family: "curve_cup" },
    ],
  },
];

/** Flat, family-ordered list of every pattern. */
export const PATTERN_CATALOG: PatternCatalogEntry[] = PATTERN_FAMILIES.flatMap(
  (family) => family.patterns,
);

/** `pattern_id` → display name. */
export const PATTERN_LABELS: Record<string, string> = Object.fromEntries(
  PATTERN_CATALOG.map((pattern) => [pattern.id, pattern.name]),
);

/** Shape-quality tiers, best → weakest. */
export const QUALITY_INFO: Record<
  "textbook" | "strong" | "fair" | "marginal",
  { label: string; description: string }
> = {
  textbook: {
    label: "Textbook",
    description: "Strongest: most pivot touches, near-perfect fit and volume confirmation",
  },
  strong: {
    label: "Strong",
    description: "Clean geometry with several touches",
  },
  fair: {
    label: "Fair",
    description: "Valid shape, fewer touches",
  },
  marginal: {
    label: "Marginal",
    description: "Weak/ambiguous shape — treat with caution",
  },
};

/** Detection status values and what they mean. */
export const STATUS_INFO: Record<
  "confirmed" | "forming" | "failed" | "marginal",
  { label: string; description: string }
> = {
  confirmed: {
    label: "Confirmed",
    description: "Price closed beyond the pattern boundary",
  },
  forming: {
    label: "Forming",
    description: "Price still inside / approaching the boundary",
  },
  failed: {
    label: "Failed",
    description: "Crossed the boundary then closed back — pattern invalidated",
  },
  marginal: {
    label: "Marginal",
    description: "Low-confidence detection",
  },
};
