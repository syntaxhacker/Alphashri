/**
 * Single source of typography/spacing tokens for the Index Report page.
 * All hardcoded fontSize, row height, padding, and radius values in the report
 * surface should reference these tokens instead of raw numbers.
 */

// Font sizes (px) — four steps only: 11 micro / 12 body / 15 anchor / 16 verdict.
// The old xsPlus/md/lg names survive as aliases so existing callers keep compiling,
// but they no longer introduce extra steps (11.5/13/14) into the rendered scale.
export const REPORT_FONT = {
  micro: 11,    // smallest labels, badges, timestamps
  xs: 11,       // section labels, table headers, chips (alias of micro)
  xsPlus: 11,   // legacy alias of micro
  sm: 12,       // body values, stat values, table cells
  md: 12,       // legacy alias of sm
  lg: 15,       // legacy alias of xl
  xl: 15,       // anchor numbers (spot in decision strip)
  verdict: 16,  // the session verdict headline — the one step above an anchor
  /** Helper: return the exact px value for a given step */
  px: (
    step: "micro" | "xs" | "xsPlus" | "sm" | "md" | "lg" | "xl" | "verdict",
  ): number => REPORT_FONT[step],
} as const;

// Row heights (px) — vertical rhythm for tables and dense lists
export const REPORT_ROW = {
  dense: 22,       // ultra-compact (tape, sequence tables)
  normal: 24,      // standard report tables (walls, ladder)
  walls: 26,       // walls card/expanded tables (raised from 24)
  comfortable: 28, // expanded views, history charts
  /** Helper */
  px: (step: "dense" | "normal" | "walls" | "comfortable"): number => REPORT_ROW[step],
} as const;

// Padding scale (px) — 4px base unit
export const REPORT_PAD = {
  xs: 2,   // tight cell padding, chip internal
  sm: 4,   // standard cell padding, card inner
  md: 8,   // panel gaps, section spacing
  lg: 12,  // modal outer, major section breaks
  xl: 16,  // page-level margins
  /** Helper */
  px: (step: "xs" | "sm" | "md" | "lg" | "xl"): number => REPORT_PAD[step],
} as const;

// Border radius (px)
/**
 * Decision-strip geometry. One source for the cell primitive and the group
 * wrapper so the cell height and the inter-group gutter cannot drift apart.
 * The 8px group gutter is spent as 4px row gap + 1px hairline + 3px inset.
 */
export const REPORT_STRIP_METRICS = {
  cellHeight: 40,
  cellGap: 4,
  groupGap: 8,
  groupRowGap: 4,
  groupHairline: 1,
  groupInset: 3,
  outerPad: 8,
} as const;

export function groupCellGap(): number {
  const m = REPORT_STRIP_METRICS;
  return m.groupRowGap + m.groupHairline + m.groupInset;
}

/**
 * The desk surface has one gutter: 4px between inline items, 8px between
 * sections, 16px outside the surface. A section is one bordered/readable band,
 * not every nested cell — dividers inside a section stay at `inline`.
 */
export const REPORT_GUTTER = {
  inline: 4,
  section: 8,
  outer: 16,
} as const;

/**
 * Marker carried by every top-level section this lane renders. Guards assert
 * the shared attribute instead of a browser-specific pixel x-coordinate.
 */
export const REPORT_SECTION_ATTR = "data-report-section";

/** Top-level sections in reading order, including those owned by other lanes. */
export const REPORT_TOP_LEVEL_SECTIONS = [
  "nifty-toolbar",
  "nifty-stat-strip",
  "nifty-flow-windows",
  "movers-strip",
  "nifty-main-row",
  "desk-insight-rail",
  "desk-dock-region",
] as const;

/**
 * Sections rendered outside this lane cannot carry the marker directly, so the
 * shell aligns them with descendant rules instead of editing their components.
 * Each rule removes an inner inset that put content on a second left edge.
 */
export const REPORT_SECTION_ALIGN = {
  panel: [
    "[&_[data-report-section]>section]:border-l-0!",
    // The wrapper already carries the shared 4px inset and the toolbar's
    // CompactPanel keeps its 1px hairline. Zero the toolbar's own 8px left pad
    // so its first control lands on the same vertical as the strip content.
    "[&_[data-testid='nifty-toolbar']]:pl-0!",
  ].join(" "),
  content: [
    // The chart panel's own border and its 6px body pad put the chart 7px in.
    "[&_[data-testid='nifty-chart-panel']]:border-l-0!",
    "[&_[data-testid='nifty-chart-panel']>div:nth-child(2)]:p-0!",
    // The 58vh cap stranded a blank strip under the dock; let the chart grow.
    "[&_[data-testid='nifty-main-row']]:max-h-none!",
  ].join(" "),
} as const;

export const REPORT_RADIUS = {
  sm: 4,   // chips, badges, inline pills
  md: 8,   // cards, panels, modals
  lg: 12,  // large containers
  /** Helper */
  px: (step: "sm" | "md" | "lg"): number => REPORT_RADIUS[step],
} as const;

// Line heights (unitless, relative to fontSize)
export const REPORT_LINE_HEIGHT = {
  tight: 1.1,
  snug: 1.15,
  normal: 1.2,
  relaxed: 1.25,
  loose: 1.35,
} as const;

// Font weights
export const REPORT_FONT_WEIGHT = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
} as const;

// Letter spacing (em)
export const REPORT_LETTER_SPACING = {
  tight: "0.03em",
  normal: "0.05em",
  wide: "0.08em",
  wider: "0.1em",
} as const;
