import type { JSX } from "solid-js";
import * as palette from "@/ui/palette";
import { formatNumberIN } from "@/utils/ui-helpers";
import {
  REPORT_FONT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
  REPORT_LINE_HEIGHT,
  REPORT_STRIP_METRICS,
  groupCellGap,
} from "./reportTokens";

export const formatInt = (value: number): string => formatNumberIN(value);

export const format2dp = (value: number): string => value.toFixed(2);

export const DECISION_STRIP_STYLE: JSX.CSSProperties = {
  "background-color": palette.TERM_HEADER,
  "--desk-border": palette.TERM_BORDER,
};

export const INDIA_VIX_STYLE: JSX.CSSProperties = {
  "flex-shrink": 0,
  "font-size": `${REPORT_FONT.micro}px`,
  "font-weight": 700,
  "letter-spacing": "0.06em",
  color: palette.TEXT_MUTED,
  "background-color": palette.alpha(palette.TERM_BORDER, 0.18),
  "border-radius": "3px",
  "padding-left": "2px",
  "padding-right": "2px",
  "padding-top": "1px",
  "padding-bottom": "1px",
  "white-space": "nowrap",
};

// A tint instead of a second border: the oneliner sits inside the bordered
// stat strip, so a 1px card border there would be a card-inside-card.
export const PLAN_ONELINER_STYLE: JSX.CSSProperties = {
  "background-color": palette.alpha(palette.TERM_BORDER, 0.18),
};

export const PLAN_BAR_STYLE: JSX.CSSProperties = {
  width: "3px",
  "align-self": "stretch",
  "margin-top": "6px",
  "margin-bottom": "6px",
  "border-radius": "1px",
  "flex-shrink": 0,
};

/** The verdict is a decision surface, not a 24px line: claim, confidence and
 *  the evidence behind them share one tinted block. */
export const VERDICT_BLOCK_HEIGHT = 48;
/** Widest inline gap allowed between the claim and the evidence it rests on. */
export const VERDICT_EVIDENCE_GAP = 8;

/** The desktop grid track sizes to the groups' summed minimums (~1.8k), wider
 *  than a 1600 viewport, so the FLOW group cannot be relied on to wrap by
 *  itself. Pinning it to its own line fixes its left edge; capping the chip row
 *  keeps the last chip inside the frame. 700px is the measured 13px readout
 *  requirement (Setup ~226 + Intel ~228 + Gamma ~219 + two 4px gaps) rounded up. */
export const FLOW_CELLS_MAX_WIDTH = 700;

/** A neutral plan emits `confidence: 0` as a sentinel for "no directional call",
 *  not as a measured 0% (a non-neutral plan is always >= 20). With no measured
 *  confidence there is nothing to print: the hero already carries one status
 *  token, so a confidence read here would be a fourth copy of the same fact. */
export function planConfidenceLabel(confidence: number | null | undefined) {
  const computed =
    typeof confidence === "number" && Number.isFinite(confidence) && confidence > 0;
  return {
    computed,
    text: computed ? `confidence ${confidence}%` : "",
  };
}

/** The first viewport owns one decision band, not a stack of four. The narrow
 *  band is content-sized up to 72px; the desktop band is a fixed 60px header. */
export const DECISION_HERO_HEIGHT = { narrowMax: 72, wide: 60 } as const;
/** Desktop's second band: one line of evidence and a More stats affordance. */
export const DECISION_CONTEXT_HEIGHT = 28;

/** Evidence is data the report actually carries. Zero of these means the plan
 *  has nothing to rest on, so its no-call must not be printed as a conclusion. */
export interface DecisionEvidenceInput {
  regimeVerdict?: string | null;
  controlVerdict?: string | null;
  gexPresent: boolean;
  hasWalls: boolean;
  hasTape: boolean;
  hasFlow: boolean;
  vixPresent: boolean;
  setupReady: boolean;
}

export function decisionEvidenceSources(input: DecisionEvidenceInput): string[] {
  const sources: string[] = [];
  if (input.hasWalls) sources.push("chain");
  if (input.gexPresent) sources.push("gamma");
  if (input.regimeVerdict) sources.push("regime");
  if (input.controlVerdict || input.hasFlow) sources.push("flow");
  if (input.vixPresent) sources.push("vix");
  if (input.setupReady) sources.push("setup");
  return sources;
}

/** Never invent a time: only a clock the payload carries can name the snapshot. */
export function snapshotTimeLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clock = raw.match(/(\d{1,2}):(\d{2})/);
  if (!clock) return null;
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export interface DecisionStateInput {
  marketClosed: boolean;
  eod: boolean;
  snapshotTime: string | null;
  evidenceSources: string[];
  headline: string | null;
  confidenceComputed: boolean;
}

export interface DecisionState {
  kind: "closed" | "awaiting" | "live";
  /** The one status token the hero prints as a badge. */
  stateLabel: string;
  /** The real directional call; empty until evidence actually backs one. */
  claim: string;
  /** "decision" only when the call is real — other values never print as badges. */
  chip: string;
  /** The single concise reason/timestamp printed beside the status token. */
  reason: string;
}

/** One status token, one reason. The old shape printed the same condition four
 *  times (state label, chip, claim, confidence); a no-call read is now a single
 *  AWAITING TRIGGER badge plus one snapshot/evidence reason, and the real
 *  directional call is only put in the claim slot once evidence supports it. */
export function resolveDecisionState(input: DecisionStateInput): DecisionState {
  const closed = input.marketClosed || input.eod;
  const hasEvidence = input.evidenceSources.length > 0;
  const directional = hasEvidence && input.confidenceComputed && !!input.headline;
  const snapshot = input.snapshotTime
    ? `showing ${input.snapshotTime} snapshot`
    : "showing last snapshot";
  if (closed) {
    return {
      kind: "closed",
      stateLabel: "MARKET CLOSED",
      claim: directional ? input.headline! : "",
      chip: directional ? "decision" : "closed",
      reason: snapshot,
    };
  }
  if (!hasEvidence) {
    return {
      kind: "awaiting",
      stateLabel: "AWAITING DATA",
      claim: "",
      chip: "awaiting",
      reason: "no live evidence",
    };
  }
  return {
    kind: "live",
    stateLabel: directional ? "LIVE READ" : "AWAITING TRIGGER",
    claim: directional ? input.headline! : "",
    chip: directional ? "decision" : "awaiting",
    reason: directional ? "" : snapshot,
  };
}

export const PLAN_HEADLINE_STYLE: JSX.CSSProperties = {
  // Content-sized, not flex:1 — a stretched headline shoves confidence to the
  // far edge of the strip. Natural width keeps the qualifier beside the claim.
  flex: "0 1 auto",
  "min-width": 0,
  overflow: "hidden",
  "text-overflow": "ellipsis",
  "white-space": "nowrap",
  "font-size": `${REPORT_FONT.display}px`,
  "font-weight": REPORT_FONT_WEIGHT.bold,
  "letter-spacing": "0.02em",
  "font-family": palette.MONO,
  "font-variant-numeric": "tabular-nums",
};

export const PLAN_CONFIDENCE_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.micro}px`,
  "font-weight": REPORT_FONT_WEIGHT.bold,
  color: palette.TEXT_MUTED,
  "font-variant-numeric": "tabular-nums",
  "white-space": "nowrap",
  "flex-shrink": 0,
};

/** The hero claim uses the 16px value step, never the 24px display step: a
 *  decision that must fit beside SPOT and CHANGE cannot also be the loudest
 *  text on a page whose evidence is absent. */
export const HERO_CLAIM_STYLE: JSX.CSSProperties = {
  ...planHeadlineStyle(false),
  "font-size": `${REPORT_FONT.value}px`,
};

export const HERO_VALUE_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.value}px`,
  "font-weight": REPORT_FONT_WEIGHT.bold,
  "font-family": palette.MONO,
  "font-variant-numeric": "tabular-nums",
  "white-space": "nowrap",
  "line-height": REPORT_LINE_HEIGHT.tight,
};

export const STATE_CHIP_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.micro}px`,
  "font-weight": REPORT_FONT_WEIGHT.bold,
  "letter-spacing": "0.04em",
  "text-transform": "uppercase",
  "white-space": "nowrap",
  "padding-left": "4px",
  "padding-right": "4px",
  "padding-top": "1px",
  "padding-bottom": "1px",
  "border-radius": "3px",
  "background-color": palette.alpha(palette.TERM_BORDER, 0.18),
  color: palette.TEXT_MUTED,
};

/** The hero's single status token. Amber while the call is unbacked, neutral
 *  once a real directional call exists — never a bullish/bearish green. */
export const DECISION_STATUS_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.micro}px`,
  "font-weight": REPORT_FONT_WEIGHT.bold,
  "letter-spacing": "0.04em",
  "text-transform": "uppercase",
  "white-space": "nowrap",
  "padding-left": "4px",
  "padding-right": "4px",
  "padding-top": "1px",
  "padding-bottom": "1px",
  "border-radius": "3px",
};

/** The one concise reason/timestamp. Plain muted text, not a second badge. */
export const DECISION_REASON_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.micro}px`,
  "font-weight": REPORT_FONT_WEIGHT.normal,
  color: palette.TEXT_MUTED,
  "white-space": "nowrap",
};

export const TAPE_BADGE_STYLE: JSX.CSSProperties = {
  "flex-shrink": 0,
  "padding-left": "4px",
  "padding-right": "4px",
  "padding-top": "1px",
  "padding-bottom": "1px",
  "border-radius": "3px",
  "font-size": `${REPORT_FONT.micro}px`,
  "font-weight": REPORT_FONT_WEIGHT.extrabold,
  "letter-spacing": "0.03em",
  "font-family": palette.MONO,
  "white-space": "nowrap",
};

export const GROUP_LABEL_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.body}px`,
  "font-weight": REPORT_FONT_WEIGHT.medium,
  "letter-spacing": REPORT_LETTER_SPACING.wide,
  "line-height": REPORT_LINE_HEIGHT.tight,
  "text-transform": "uppercase",
  "text-align": "left",
  "white-space": "nowrap",
  color: palette.TEXT_MUTED,
};

/** Verdict-wrap geometry. Narrow screens stack the chips and the plan line
 *  instead of clipping them mid-word; desktop gives the decision a 48px block. */
export function verdictWrapLayout(narrow: boolean) {
  return {
    wrap: narrow,
    direction: narrow ? ("column" as const) : ("row" as const),
    height: narrow ? "auto" : `${VERDICT_BLOCK_HEIGHT}px`,
    minHeight: narrow ? "24px" : `${VERDICT_BLOCK_HEIGHT}px`,
    overflow: narrow ? "visible" : "hidden",
  };
}

/** The plan headline is a deliberate single line with ellipsis on desktop.
 *  On a phone it wraps instead — an ellipsis cut through a number is a
 *  misleading readout, not a truncation strategy. */
export function planHeadlineStyle(narrow: boolean): JSX.CSSProperties {
  return narrow
    ? {
        ...PLAN_HEADLINE_STYLE,
        "white-space": "normal",
        overflow: "visible",
        "text-overflow": "clip",
        "line-height": "1.2",
      }
    : { ...PLAN_HEADLINE_STYLE };
}

/** Contract used by the layout guards and by the browser measurement: the
 *  largest edge-to-edge gap anywhere in the strip, in px. */
export function statStripGaps() {
  return {
    withinGroup: REPORT_STRIP_METRICS.cellGap,
    betweenGroups: groupCellGap(),
    trailing: REPORT_STRIP_METRICS.outerPad,
    cellHeight: REPORT_STRIP_METRICS.cellHeight,
  };
}

// The verdict strip owns its own layout; these overrides let it wrap its
// compact cells two-per-row on a phone without editing that component.
export const VERDICT_NARROW_OVERRIDES = [
  "max-[600px]:[&_[data-testid='nifty-verdict-strip']]:flex-wrap",
  "max-[600px]:[&_[data-testid='nifty-verdict-strip']]:h-auto",
  "max-[600px]:[&_[data-testid='nifty-verdict-strip']]:overflow-visible",
  "max-[600px]:[&_[data-testid='nifty-verdict-strip']>*]:flex-none",
  "max-[600px]:[&_[data-testid='nifty-verdict-strip']>*]:w-1/2",
].join(" ");
