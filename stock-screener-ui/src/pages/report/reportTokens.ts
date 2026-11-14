/**
 * Single source of typography/spacing tokens for the Index Report page.
 * All hardcoded fontSize, row height, padding, and radius values in the report
 * surface should reference these tokens instead of raw numbers.
 */

// Font sizes (px) — stepwise scale for report density
export const REPORT_FONT = {
  micro: 10,    // smallest labels, badges, timestamps
  xs: 11,       // section labels, table headers, chips
  xsPlus: 11.5, // intermediate: sequence/read/signal body copy
  sm: 12,       // body values, stat values, table cells
  md: 13,       // prominent values, section headers, stat values
  lg: 14,       // headline numbers, modal titles
  xl: 15,       // anchor numbers (spot in decision strip)
  /** Helper: return the exact px value for a given step */
  px: (step: "micro" | "xs" | "xsPlus" | "sm" | "md" | "lg" | "xl"): number => REPORT_FONT[step],
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
export const REPORT_RADIUS = {
  sm: 4,   // chips, badges, inline pills
  md: 8,   // cards, panels, modals
  lg: 12,  // large containers
  /** Helper */
  px: (step: "sm" | "md" | "lg"): number => REPORT_RADIUS[step],
} as const;

// Common composite tokens for frequent patterns
// Note: REPORT_PAD.sm = 4px (not 8px). Use REPORT_PAD.md for 8px horizontal padding.
export const REPORT_CELL_PADDING = {
  vertical: REPORT_PAD.xs,   // 2px
  horizontal: REPORT_PAD.sm, // 4px
} as const;

export const REPORT_HEADER_CELL_PADDING = {
  vertical: REPORT_PAD.xs,   // 2px
  horizontal: REPORT_PAD.sm, // 4px
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
