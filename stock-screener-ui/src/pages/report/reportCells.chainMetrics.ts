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
