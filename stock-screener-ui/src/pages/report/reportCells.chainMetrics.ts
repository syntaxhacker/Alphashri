import { REPORT_FONT, REPORT_PAD, REPORT_ROW } from "./reportTokens";

/**
 * Chain rhythm. Column labels stay at the 12px floor while the numbers they
 * label read at the 13px body step; the old `dense` preset squeezed both into
 * 18px rows with 1px/6px insets, which cut wall tags and ΔOI values mid-word.
 */
export const OI_CHAIN_METRICS = {
  rowHeight: REPORT_ROW.walls, // 26 — deliberate row height, no 18px cram
  cellPadding: `${REPORT_PAD.sm}px ${REPORT_PAD.md}px`, // 4px 8px
  labelSize: REPORT_FONT.micro, // 12 — column labels
  valueSize: REPORT_FONT.body, // 13 — numbers and badges they describe
} as const;

/**
 * Definite pixel cap — never a percentage. The report's chain parent is a
 * non-definite flex item, so `max-height: 100%` resolved to a collapsed wrap
 * (header + bars, no STRIKE/values) in the real 1600 capture.
 *
 * 360px leaves the ~177px five-row desk chain (28px header row + 5×26px rows
 * + the compact panel header) untouched, and bounds a ~782px full chain to
 * ~12 visible rows with vertical scroll. The table's own scroll area carries
 * the overflow, so no row is clipped by the main row's `overflow: hidden`.
 */
export const OI_CHAIN_MAX_HEIGHT = 360;
/** Header row height the cap is derived around (see OI_CHAIN_MAX_HEIGHT). */
export const OI_CHAIN_HEADER_HEIGHT = 28;

/**
 * Phone chain track. 32px of CHAIN/HEATMAP tabs + ~40px compact panel header
 * (the 30px expand button inside a 4px/4px inset and a hairline) + the 28px
 * table header + two 26px strike rows = 152px; 156px leaves a sliver of the
 * next row as the vertical scroll cue. The chart keeps the first grid track,
 * so this is the smallest reserve that still shows two full rows.
 */
export const OI_CHAIN_MOBILE_ROW_PX = 156;
/**
 * A scroll viewport at or below this height is the phone chain. Pin ATM just
 * under the sticky table header (instead of centring it in the viewport) so a
 * second full strike row stays visible next to the emphasised ATM row.
 */
export const OI_CHAIN_MOBILE_VIEWPORT_MAX = 112;

// Full chain (390px): roomy columns behind the wrapper's horizontal scroll.
export const OI_CE_CHG_W = 116;
export const OI_CE_OI_W = 96;
export const OI_SIG_W = 80;
export const OI_STRIKE_W = 128;

/**
 * Desk chain (1600px): five core columns must fit the measured ~420px side
 * panel with no clipping. Widths are the smallest that still hold the widest
 * real value at the 12/13px scale — ΔOI "2.69 Cr", signal "BULL", STRIKE
 * "25,700" plus two wall tags — with the 4px/8px cell inset.
 */
export const OI_DESK_OI_W = 76;
export const OI_DESK_SIG_W = 60;
export const OI_DESK_STRIKE_W = 112;
/** Measured width of the report's right-hand chain panel at 1600px. */
export const OI_CHAIN_PANEL_BUDGET = 420;
/** 76 + 60 + 112 + 60 + 76 — deliberately below the panel budget. */
export const OI_CHAIN_DESK_WIDTH =
  OI_DESK_OI_W * 2 + OI_DESK_SIG_W * 2 + OI_DESK_STRIKE_W;
