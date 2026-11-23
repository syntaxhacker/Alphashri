/**
 * Single source of typography/spacing tokens for the Index Report page.
 * All hardcoded fontSize, row height, padding, and radius values in the report
 * surface should reference these tokens instead of raw numbers.
 */
import { TYPE_SCALE } from "@/ui";
import type { JSX } from "solid-js";

// Font sizes (px) — derived from the shared six-step scale, never a private
// dialect. The report uses four steps: micro 12 / body 13 / value 16 (the
// shared title step) / display 24. Every legacy name below is an alias of one
// of those steps, so an unmigrated caller cannot reintroduce a fifth size (or
// make the old 17px private "value" step the page default again).
export const REPORT_FONT = {
  display: TYPE_SCALE.display.size, // 24 — DS Title xl; no private 23px verdict
  value: TYPE_SCALE.title.size, // 16 — alias of the shared title step
  body: TYPE_SCALE.body.size, // 13 — dense table cells
  micro: TYPE_SCALE.micro.size, // 12 — axis ticks, hints, timestamps; shared floor

  // Legacy aliases → nearest canonical step. Kept so callers that have not
  // migrated to the named steps still compile without widening the scale.
  xs: TYPE_SCALE.body.size,
  xsPlus: TYPE_SCALE.body.size,
  sm: TYPE_SCALE.body.size,
  md: TYPE_SCALE.body.size,
  lg: TYPE_SCALE.title.size,
  xl: TYPE_SCALE.title.size,
  verdict: TYPE_SCALE.display.size, // alias of display, never a separate 23px size

  px: (
    step:
      | "display"
      | "value"
      | "body"
      | "micro"
      | "xs"
      | "xsPlus"
      | "sm"
      | "md"
      | "lg"
      | "xl"
      | "verdict",
  ): number => REPORT_FONT[step],
} as const;

export const REPORT_FONT_BODY_VAR = "--report-font-body";
export const REPORT_CONTROL_LABEL_CLASS = "[&>button]:[font-size:var(--report-font-body)]!";
export const REPORT_CONTROL_LABEL_STYLE = {
  [REPORT_FONT_BODY_VAR]: `${REPORT_FONT.body}px`,
} as JSX.CSSProperties;

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
 * Border-box minimums for the strip cells. At the promoted 13px body step a
 * mono readout such as `BUY PREMIUM · RV > IV` needs 165px and the label
 * `P/C ratio · volume` needs 135px; the 11px-era 96px cell cannot hold either.
 * Each value is the measured text plus the 8px inset and 1px hairline, so an
 * ellipsis can only fire on a genuinely longer string, not on a real readout.
 * Group weights below are tuned to the sum of these minimums.
 */
export const REPORT_STRIP_CELL_MIN = {
  spot: 108,
  symbol: 78,
  change: 96,
  regime: 182,
  flip: 99,
  callWall: 103,
  putWall: 96,
  pin: 71,
  // Six mono glyphs of `22,406` at the 16px value step (~58px) plus the 44px
  // tape sparkline, 8px cell inset and 1px hairline = 111px. The old 110px
  // floor sliced the last glyph into the next cell's divider; at 390 the shell
  // overrides this floor, so the full value stays readable there too.
  maxPain: 120,
  squeezeFuel: 114,
  pcrOi: 110,
  pcrVol: 148,
  chipSetup: 178,
  chipIntel: 178,
  chipGamma: 196,
} as const;

/**
 * Flex weights **derived** from the cell minimums, never hand-picked.
 *
 * They were hand-tuned (3 / 3.1 / 3 / 4.35) against the old, smaller type. When
 * `04491dea` grew every cell to fit the bigger numerals it left these alone, so
 * PRICE was allotted 389px while its five cells needed 547 — `Regime` (439→621)
 * and `Max-OI call` (553→656) overlapped by 68px on the same row.
 *
 * Weighting by requirement makes the strip plus its padding correct by
 * construction: change a cell minimum and the weight follows.
 */
export const REPORT_STRIP_GROUP_WEIGHT = {
  price: REPORT_STRIP_CELL_MIN.symbol +
    REPORT_STRIP_CELL_MIN.change +
    REPORT_STRIP_CELL_MIN.spot +
    REPORT_STRIP_CELL_MIN.regime +
    REPORT_STRIP_CELL_MIN.flip,
  walls: REPORT_STRIP_CELL_MIN.callWall +
    REPORT_STRIP_CELL_MIN.putWall +
    REPORT_STRIP_CELL_MIN.pin +
    REPORT_STRIP_CELL_MIN.maxPain,
  volatility: REPORT_STRIP_CELL_MIN.pcrOi + REPORT_STRIP_CELL_MIN.pcrVol,
  // All three chips render together inside the desk-only group, so the floor
  // is their sum, not the widest one. At the old 196px the group fit while its
  // 552px of chips spilled past the strip edge ("Institutional flows" read as
  // "Ins"). With the real floor `flex-wrap` moves the whole group to its own
  // row instead of clipping a chip mid-word.
  flow:
    REPORT_STRIP_CELL_MIN.chipSetup +
    REPORT_STRIP_CELL_MIN.chipIntel +
    REPORT_STRIP_CELL_MIN.chipGamma,
} as const;

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

/**
 * Terminal radius vocabulary — 2 / 4 / 6 / 10 only. The report's old 8px cards
 * and 12px containers read as a separate skin next to the shared controls;
 * `xs` is the hairline/skeleton surface the shell paints at 2px.
 */
export const REPORT_RADIUS = {
  xs: 2,   // error reads, skeletons, hairline surfaces
  sm: 4,   // chips, badges, inline pills
  md: 6,   // cards, panels, modals — the control radius
  lg: 10,  // large containers
  /** Helper */
  px: (step: "xs" | "sm" | "md" | "lg"): number => REPORT_RADIUS[step],
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
