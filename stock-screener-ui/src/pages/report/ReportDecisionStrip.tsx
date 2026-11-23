import { Show, createMemo, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Button, useMediaQuery } from "@/ui";
import * as palette from "@/ui/palette";
import { formatNumberIN } from "@/utils/ui-helpers";
import { AnimatedValue } from "@/components/common/AnimatedValue";
import { Sparkline } from "@/components/common/Sparkline";
import {
  ContextCell,
  DecisionCell,
  DecisionChip,
  NiftySpotValue,
  formatOiCr,
  formatSignedPoints,
} from "./reportCells";
import {
  NiftyVerdictStrip,
  resolveRegimeLabel,
  regimeAccent,
  regimeDetail,
} from "./NiftyVerdictStrip";
import { NiftyFlowWindows } from "./NiftyFlowWindows";
import { IndexMoversStrip } from "./IndexMoversStrip";
import { NiftyIntelStrip } from "./NiftyIntelStrip";
import { NiftyGammaStrip } from "./NiftyGammaStrip";
import { SetupRadarStrip } from "./SetupRadarStrip";
import { gexFlipAtSpot } from "./niftyGex";
import { buildDeskPlan } from "./deskPlan";
import { summarizeDeskPlan } from "./deskPlanSummary";
import type { PlanInput } from "./deskPlanSummary";
import { pinHint, pinRisk } from "./niftyPin";
import { resolveWallBoard } from "./niftyWallsFormat";
import { useNiftyReport } from "./ReportContext";
import { LiveTapeDisclosure } from "./reportBits";
import {
  REPORT_FONT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
  REPORT_LINE_HEIGHT,
  REPORT_SECTION_ATTR,
  REPORT_STRIP_CELL_MIN,
  REPORT_STRIP_GROUP_WEIGHT,
  REPORT_STRIP_METRICS,
  groupCellGap,
} from "./reportTokens";

const formatInt = (value: number): string => formatNumberIN(value);

const format2dp = (value: number): string => value.toFixed(2);

const DECISION_STRIP_STYLE: JSX.CSSProperties = {
  "background-color": palette.TERM_HEADER,
  "--desk-border": palette.TERM_BORDER,
};

const INDIA_VIX_STYLE: JSX.CSSProperties = {
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
const PLAN_ONELINER_STYLE: JSX.CSSProperties = {
  "background-color": palette.alpha(palette.TERM_BORDER, 0.18),
};

const PLAN_BAR_STYLE: JSX.CSSProperties = {
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
 *  not as a measured 0% (a non-neutral plan is always >= 20). Rendering it as a
 *  meter makes a no-trade read look like a confidently worthless one. */
export function planConfidenceLabel(confidence: number | null | undefined) {
  const computed =
    typeof confidence === "number" && Number.isFinite(confidence) && confidence > 0;
  return {
    computed,
    text: computed ? `confidence ${confidence}%` : "not computed · no directional call",
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
  stateLabel: string;
  claim: string;
  chip: string;
}

/** One explicit overall state replaces the old repeated no-trade verdict.
 *  A closed or evidence-less report names its condition and the time of the
 *  snapshot; a directional call is only a claim once evidence backs it. */
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
      stateLabel: `MARKET CLOSED · ${snapshot}`,
      claim: directional ? input.headline! : "awaiting data",
      chip: hasEvidence ? "snapshot read" : "awaiting data",
    };
  }
  if (!hasEvidence) {
    return {
      kind: "awaiting",
      stateLabel: "AWAITING DATA · no live evidence",
      claim: "awaiting data",
      chip: "awaiting data",
    };
  }
  return {
    kind: "live",
    stateLabel: directional ? "LIVE READ" : "NO DIRECTIONAL CALL",
    claim: directional ? input.headline! : "awaiting trigger",
    chip: directional ? "decision" : "awaiting trigger",
  };
}

const PLAN_HEADLINE_STYLE: JSX.CSSProperties = {
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

const PLAN_CONFIDENCE_STYLE: JSX.CSSProperties = {
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
const HERO_CLAIM_STYLE: JSX.CSSProperties = {
  ...planHeadlineStyle(false),
  "font-size": `${REPORT_FONT.value}px`,
};

const HERO_VALUE_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.value}px`,
  "font-weight": REPORT_FONT_WEIGHT.bold,
  "font-family": palette.MONO,
  "font-variant-numeric": "tabular-nums",
  "white-space": "nowrap",
  "line-height": REPORT_LINE_HEIGHT.tight,
};

const STATE_CHIP_STYLE: JSX.CSSProperties = {
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

const TAPE_BADGE_STYLE: JSX.CSSProperties = {
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

const GROUP_LABEL_STYLE: JSX.CSSProperties = {
  "font-size": `${REPORT_FONT.body}px`,
  "font-weight": REPORT_FONT_WEIGHT.medium,
  "letter-spacing": REPORT_LETTER_SPACING.wide,
  "line-height": REPORT_LINE_HEIGHT.tight,
  "text-transform": "uppercase",
  "text-align": "left",
  "white-space": "nowrap",
  color: palette.TEXT_MUTED,
};

/** One labelled zone of the stat strip. The hairline sits inside the 8px
 *  gutter (4px row gap + 1px rule + 3px inset), so cells never drift apart. */
function StatGroup(props: {
  testId: string;
  label: string;
  weight: number;
  divider?: boolean;
  cellsTestId?: string;
  /** Claim a whole flex line on desktop and shrink the min-content footprint
   *  to the widest single cell, so the group no longer widens the grid track. */
  fullRow?: boolean;
  wrapCells?: boolean;
  cellsMaxWidth?: number;
  children: JSX.Element;
}) {
  const m = REPORT_STRIP_METRICS;
  return (
    <Box
      data-testid={props.testId}
      data-group-label={props.label}
      className="flex flex-col"
      style={{
        flex: props.fullRow ? "1 0 100%" : `${props.weight} 1 0%`,
        // A full-row group keeps only its widest cell as the floor: the summed
        // weight would re-widen the grid track past the viewport and pin this
        // group to the far right again. Every other group keeps the full floor
        // so its cells cannot shrink into their neighbour.
        "min-width": `${props.fullRow ? REPORT_STRIP_CELL_MIN.chipGamma : props.weight}px`,
        gap: `${m.cellGap}px`,
        ...(props.divider
          ? {
              "border-left": `1px solid ${palette.TERM_BORDER}`,
              "padding-left": `${m.groupInset}px`,
            }
          : {}),
      }}
    >
      <span data-testid={`${props.testId}-label`} title={props.label} style={GROUP_LABEL_STYLE}>
        {props.label}
      </span>
      <Box
        data-testid={props.cellsTestId ?? `${props.testId}-cells`}
        className={`flex items-stretch flex-1 min-w-0 ${props.wrapCells ? "flex-wrap" : ""}`}
        style={{
          gap: `${m.cellGap}px`,
          ...(props.cellsMaxWidth != null
            ? { "max-width": `${props.cellsMaxWidth}px` }
            : {}),
        }}
      >
        {props.children}
      </Box>
    </Box>
  );
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
const VERDICT_NARROW_OVERRIDES = [
  "max-[600px]:[&_[data-testid='nifty-verdict-strip']]:flex-wrap",
  "max-[600px]:[&_[data-testid='nifty-verdict-strip']]:h-auto",
  "max-[600px]:[&_[data-testid='nifty-verdict-strip']]:overflow-visible",
  "max-[600px]:[&_[data-testid='nifty-verdict-strip']>*]:flex-none",
  "max-[600px]:[&_[data-testid='nifty-verdict-strip']>*]:w-1/2",
].join(" ");

export function ReportDecisionStrip() {
  const store = useNiftyReport();
  const narrow = useMediaQuery("(max-width: 600px)");
  const wrapLayout = () => verdictWrapLayout(narrow());
  // SESSION/15m/5m flow stacks to ~144px on a phone. Collapse it behind the
  // same disclosure the tape bands use so the chart row keeps that height.
  const [flowOpen, setFlowOpen] = createSignal(false);
  // The verdict/plan chips stack to ~69px on a phone and duplicate the regime
  // and plan already in the stat grid — collapse them behind the same primitive.
  const [verdictOpen, setVerdictOpen] = createSignal(false);

  const report = () => store.data.report();
  const metrics = () => store.data.metrics();
  const tapeRows = () => store.data.tapeRows();
  const setup = () => store.data.setup();
  const preMove = () => store.data.preMove();
  const tapeSpeed = () => store.data.tapeSpeed();
  const lastFlip = () => store.data.lastFlip();
  const flowReport = () => store.data.flowReport();
  const isDesk = () => store.ui.isDesk();
  const symbol = () => store.selection.symbol();
  const mode = () => store.selection.mode();
  const expiry = () => store.selection.expiry();
  const date = () => store.selection.date();

  const regime = () => report()?.regime ?? null;

  const gexDegraded = createMemo(() => {
    const current = report();
    if (!current?.gex) return false;
    if (current.gex.degraded === true) return true;
    const strikes = current.strikes ?? [];
    if (strikes.length === 0) return false;
    const hasGamma = (value: number | null | undefined) =>
      typeof value === "number" && Number.isFinite(value);
    return !strikes.some((strike) => hasGamma(strike.ce.gamma) || hasGamma(strike.pe.gamma));
  });

  const gexForDisplay = () => (gexDegraded() ? undefined : report()?.gex);

  const gammaFlip = createMemo(() =>
    gexDegraded() ? null : gexFlipAtSpot(report()?.gex, report()?.spot ?? 0),
  );

  const flipDelta = createMemo(() => {
    const current = report();
    const flip = gammaFlip();
    return current && flip != null ? current.spot - flip : null;
  });

  const wallsBoard = createMemo(() =>
    resolveWallBoard(report()?.wallsNear, report()?.walls),
  );

  const maxCallWall = createMemo(
    () => wallsBoard()?.calls?.[0] ?? report()?.walls?.calls?.[0] ?? null,
  );

  const maxPutWall = createMemo(
    () => wallsBoard()?.puts?.[0] ?? report()?.walls?.puts?.[0] ?? null,
  );

  const maxCallDistance = createMemo(() => {
    const wall = maxCallWall();
    const spot = report()?.spot;
    return wall && spot ? wall.strike - spot : null;
  });

  const maxPutDistance = createMemo(() => {
    const wall = maxPutWall();
    const spot = report()?.spot;
    return wall && spot ? wall.strike - spot : null;
  });

  const nearCallWall = createMemo(
    () => (report()?.wallsNear?.calls ?? report()?.walls?.calls)?.[0] ?? null,
  );

  const pin = createMemo(() => {
    const symbolMetrics = metrics();
    if (!symbolMetrics) return null;
    const current = report();
    return pinRisk({
      spot: current?.spot,
      maxPain: current?.maxPain,
      wallsNear: current?.wallsNear,
      walls: current?.walls,
      metrics: symbolMetrics,
    });
  });

  const squeezeFuel = createMemo(() => {
    const read = pin();
    const wall = nearCallWall();
    if (read?.level !== "HIGH" || !wall) return null;
    const row = (report()?.strikes ?? []).find(
      (strike) => Math.round(Number(strike.strike)) === Math.round(Number(wall.strike)),
    );
    const sentiment = String(row?.ce?.sentiment ?? "").trim().toUpperCase();
    const covering =
      sentiment === "SC" ||
      sentiment === "SHORT COVER" ||
      sentiment === "LU" ||
      sentiment === "LONG UNWIND";
    if (!covering) return null;
    return { strike: Math.round(Number(wall.strike)), sentiment };
  });

  const dayRange = createMemo(() => {
    const current = report();
    if (!current) return null;
    const bars = current.intraday?.length ? current.intraday : (current.candles ?? []);
    let low = current.ohlc?.low ?? 0;
    let high = current.ohlc?.high ?? 0;
    if ((!low || !high) && bars.length > 0) {
      low = Math.min(...bars.map((candle) => candle.low));
      high = Math.max(...bars.map((candle) => candle.high));
    }
    return low > 0 && high > 0 ? { low, high } : null;
  });

  const pcrSeries = createMemo(() => tapeRows().map((row) => row.pcr_oi));

  const maxPainSeries = createMemo(() => tapeRows().map((row) => row.max_pain));

  // The backend does not ship a previous close, so the header change is measured
  // from the session open (`ohlc.open`) and says so — a "change" against an
  // invented prev-close would be a lie on every gap day.
  const sessionChange = createMemo(() => {
    const current = report();
    const open = current?.ohlc?.open ?? 0;
    if (!current || open <= 0 || !Number.isFinite(current.spot)) return null;
    const pts = current.spot - open;
    return { pts, pct: (pts / open) * 100 };
  });

  const changeTone = () => {
    const change = sessionChange();
    if (!change) return palette.TEXT_MUTED;
    if (change.pts > 0) return palette.POSITIVE;
    if (change.pts < 0) return palette.NEGATIVE;
    return palette.TEXT_MUTED;
  };

  const setupCounts = createMemo(() => {
    const gates = setup().gates;
    return { passed: gates.filter((gate) => gate.pass).length, total: gates.length };
  });

  const setupSummary = () => `${setupCounts().passed} of ${setupCounts().total} · ${preMove().state}`;

  const setupHelp = () => {
    const { passed, total } = setupCounts();
    const state = preMove().state;
    const meaning =
      state === "quiet"
        ? "no setup is armed"
        : state === "armed"
          ? "conditions are lined up"
          : state === "watch"
            ? "a setup is forming"
            : "the pre-move state is not available";
    return `Setup checks: ${passed} of ${total} passed. The checks are COIL, TREND, RVOL, LEVEL, WALL, GAMMA and FUEL. Pre-move "${state}" means ${meaning}. Opens the Setup tab with every check.`;
  };

  const gammaChipHelp = () => {
    if (gexDegraded()) {
      return "Dealer gamma is unavailable in this report: option greeks are missing from the snapshot, so no regime or flip strike can be shown.";
    }
    const regime =
      gexForDisplay()?.regime === "short"
        ? "short (moves are amplified)"
        : gexForDisplay()?.regime === "long"
          ? "long (moves are dampened)"
          : "flat";
    const flip = gammaFlip();
    return flip != null
      ? `Dealer gamma is ${regime}. The flip at ${formatInt(flip)} is the strike where cumulative dealer gamma crosses zero at spot.`
      : `Dealer gamma is ${regime}. The value is a dash because the profile does not cross zero at spot, so there is no flip strike to show.`;
  };

  const INTEL_CHIP_HELP =
    "Institutional flows: FII means foreign institutional investors and DII means domestic institutional investors — their net cash flows. The Intel panel shows a dash with a reason when no snapshot is available or its fetch failed. Opens the market panel.";

  const planSummary = createMemo(() => {
    const current = report();
    if (!current) return null;
    const plan = buildDeskPlan(current);
    const active = plan.bias === "bearish" ? plan.bear : plan.bull;
    const input: PlanInput = {
      bias: plan.bias,
      spot: plan.spot ?? 0,
      bull: {
        do: {
          action: plan.bull.action,
          trigger: plan.bull.entryTrigger,
          stop: plan.bull.stop,
          target: plan.bull.target,
          rr: plan.bull.rr,
        },
      },
      bear: {
        do: {
          action: plan.bear.action,
          trigger: plan.bear.entryTrigger,
          stop: plan.bear.stop,
          target: plan.bear.target,
          rr: plan.bear.rr,
        },
      },
      reasons: active.reasons.map((reason) => ({ tag: reason.tag, text: reason.text })),
    };
    return summarizeDeskPlan(input);
  });

  const planTone = () => {
    const tone = planSummary()?.tone;
    if (tone === "positive") return palette.POSITIVE;
    if (tone === "negative") return palette.NEGATIVE;
    return palette.WARNING;
  };

  const tapeBadge = createMemo(() => {
    const speed = tapeSpeed();
    const summary = planSummary();
    if (!speed || !summary || speed.ratio < 1.5) return null;
    const up = speed.delta > 0;
    const side = summary.headline.startsWith("BEARISH")
      ? "bear"
      : summary.headline.startsWith("BULLISH")
        ? "bull"
        : null;
    const conflict = (side === "bear" && up) || (side === "bull" && !up);
    const tone = conflict ? palette.WARNING : up ? palette.POSITIVE : palette.NEGATIVE;
    return { up, conflict, ratio: speed.ratio, delta: speed.delta, tone };
  });

  const planConfidence = createMemo(() => planConfidenceLabel(planSummary()?.confidence));

  const evidenceSources = createMemo(() =>
    decisionEvidenceSources({
      regimeVerdict: report()?.regime?.verdict,
      controlVerdict: report()?.control?.verdict,
      gexPresent: !gexDegraded() && report()?.gex != null,
      hasWalls: !!(maxCallWall() || maxPutWall()),
      hasTape: tapeRows().length > 0,
      hasFlow: !!flowReport() || !!report()?.flow_window,
      vixPresent: Number.isFinite(report()?.vix?.ltp ?? NaN),
      setupReady: setupCounts().passed > 0,
    }),
  );

  const decision = createMemo(() =>
    resolveDecisionState({
      marketClosed: report()?.market?.is_open === false,
      eod: mode() === "eod",
      snapshotTime: snapshotTimeLabel(
        report()?.market?.as_of ?? report()?.snapshotAt ?? report()?.fetchedAt ?? null,
      ),
      evidenceSources: evidenceSources(),
      headline: planSummary()?.headline ?? null,
      confidenceComputed: planConfidence().computed,
    }),
  );

  const claimTone = () => {
    const state = decision();
    if (state.kind === "live" && state.chip === "decision") return planTone();
    return palette.TEXT_MUTED;
  };

  /** One hero claim, once. The headline node keeps its contract but now carries
   *  the overall state instead of an unbacked "NEUTRAL · no trade" conclusion. */
  const heroClaim = () => (
    <Box
      data-testid="nifty-plan-oneliner"
      className="flex flex-row flex-wrap items-center gap-x-2 min-w-0"
      style={PLAN_ONELINER_STYLE}
    >
      <Box
        data-testid="nifty-plan-headline"
        data-decision-kind={decision().kind}
        title={`${decision().stateLabel} — ${decision().claim}`}
        className="min-w-0"
        style={{ ...HERO_CLAIM_STYLE, color: claimTone() }}
      >
        {decision().claim}
      </Box>
      <Box
        data-testid="nifty-plan-confidence"
        data-confidence-computed={planConfidence().computed ? "true" : "false"}
        title={
          planConfidence().computed
            ? "Weighted confidence behind the active side"
            : "No directional call, so there is no confidence to compute"
        }
        className="shrink-0"
        style={PLAN_CONFIDENCE_STYLE}
      >
        {planConfidence().text}
      </Box>
    </Box>
  );

  /** The research rail reuses the read without duplicating the hero's testids. */
  const railClaim = () => (
    <Box className="flex items-center gap-1 min-w-0">
      <span className="min-w-0" style={{ ...HERO_CLAIM_STYLE, color: claimTone() }}>
        {decision().claim}
      </span>
    </Box>
  );

  /** Tape speed is evidence, not a second verdict; the plan button lives in the
   *  hero so its testid appears exactly once per render. */
  const tapeBadgeControl = () => (
    <Show when={tapeBadge()}>
      {(current) => (
        <span
          data-testid="nifty-plan-tape"
          data-conflict={current().conflict ? "true" : "false"}
          title={`Last 5 min ${current().up ? "+" : ""}${Math.round(current().delta)} pts — ${current().ratio.toFixed(1)}× the median 5-min move${current().conflict ? " · this OPPOSES the plan side" : ""}`}
          style={{
            ...TAPE_BADGE_STYLE,
            // Inside the bordered stat strip: a second border would be a
            // card-inside-card, so the tone lives in text and tint only.
            "background-color": palette.alpha(current().tone, 0.18),
            color: current().tone,
          }}
        >
          {current().conflict ? "⚠ " : ""}TAPE {current().up ? "↑" : "↓"} {current().ratio.toFixed(1)}×
        </span>
      )}
    </Show>
  );

  const reasonsButton = () => (
    <Button
      data-testid="nifty-plan-reasons-button"
      size="xs"
      variant="subtle"
      aria-label="Open the full two-sided desk plan"
      title="Open the full two-sided desk plan (E)"
      onClick={store.ui.openPlanReasons}
    >
      ▸
    </Button>
  );

  const verdictContent = () => (
    <Box
      data-testid="nifty-verdict-wrap"
      className={`flex gap-1 min-w-0 ${wrapLayout().direction === "column" ? "flex-col items-stretch flex-wrap py-0.5" : "flex-nowrap items-center"} ${VERDICT_NARROW_OVERRIDES}`}
      style={{
        height: wrapLayout().height,
        "min-height": wrapLayout().minHeight,
        overflow: wrapLayout().overflow,
      }}
    >
      {/* Evidence only. The verdict claim is rendered once, in the hero; a
          second copy here is what made "NEUTRAL · no trade" the loudest text. */}
      <Box
        data-testid="nifty-verdict-block"
        className={`flex items-center min-w-0 flex-1 rounded-[4px] px-2 ${narrow() ? "flex-col items-stretch py-1" : "flex-nowrap"}`}
        style={{
          "align-self": "stretch",
          "background-color": palette.alpha(palette.TERM_BORDER, 0.18),
          gap: narrow() ? undefined : `${VERDICT_EVIDENCE_GAP}px`,
        }}
      >
        <span
          aria-hidden="true"
          data-testid="nifty-verdict-rail"
          style={{ ...PLAN_BAR_STYLE, "background-color": claimTone() }}
        />
        <Box data-testid="nifty-verdict-evidence" className="flex flex-1 min-w-0 items-stretch gap-2">
          <span className="shrink-0 self-center" style={GROUP_LABEL_STYLE}>
            Evidence
          </span>
          <Box className="flex flex-1 min-w-0">
            <NiftyVerdictStrip report={report()!} mode="context" />
          </Box>
        </Box>
        <span
          aria-hidden="true"
          data-testid="nifty-verdict-divider"
          className="shrink-0"
          style={{
            width: "1px",
            "align-self": "stretch",
            "margin-top": "6px",
            "margin-bottom": "6px",
            "background-color": palette.TERM_BORDER,
          }}
        />
        <Show when={isDesk()}>
          <Box className="flex items-center gap-1 shrink-0">{tapeBadgeControl()}</Box>
        </Show>
      </Box>
      <Show when={symbol() !== "NIFTY"}>
        <span
          data-testid="nifty-india-vix-label"
          title="VIX source: INDIA_VIX — this is India VIX, not a US VIX."
          style={INDIA_VIX_STYLE}
        >
          INDIA VIX
        </span>
      </Show>
    </Box>
  );

  return (
    <Show when={report()}>
      <Box
        data-testid="nifty-stat-strip"
        {...{ [REPORT_SECTION_ATTR]: true }}
        className="flex flex-col border border-[var(--desk-border)] rounded-[4px] overflow-hidden w-full max-w-full min-w-0 shrink-0 px-2"
        style={DECISION_STRIP_STYLE}
      >
        {/* The first viewport gets one decision band. Everything below it is
            detail and stays behind the single More stats disclosure. */}
        <Box
          data-testid="nifty-decision-hero"
          data-report-band="decision-hero"
          className={`flex min-w-0 shrink-0 ${narrow() ? "flex-col gap-0.5 py-1" : "flex-row items-center gap-3 py-1"}`}
          style={{
            height: narrow() ? "auto" : `${DECISION_HERO_HEIGHT.wide}px`,
            "min-height": narrow() ? "56px" : `${DECISION_HERO_HEIGHT.wide}px`,
            "max-height": narrow() ? `${DECISION_HERO_HEIGHT.narrowMax}px` : undefined,
            overflow: "hidden",
          }}
        >
          <Box className="flex items-center gap-2 min-w-0">
            <Box data-testid="nifty-hero-spot" className="flex items-baseline gap-1 shrink-0">
              <span style={{ ...GROUP_LABEL_STYLE, "font-size": `${REPORT_FONT.micro}px` }}>
                SPOT
              </span>
              <span data-testid="nifty-hero-spot-read" style={HERO_VALUE_STYLE}>
                <NiftySpotValue live={mode() === "live"} fallback={report()?.spot ?? 0} />
              </span>
            </Box>
            <Box data-testid="nifty-hero-change" className="flex items-baseline gap-1 shrink-0">
              <span style={{ ...GROUP_LABEL_STYLE, "font-size": `${REPORT_FONT.micro}px` }}>
                CHANGE
              </span>
              <span data-testid="nifty-hero-change-read" style={{ ...HERO_VALUE_STYLE, color: changeTone() }}>
                {sessionChange() ? formatSignedPoints(sessionChange()!.pts) : "—"}
              </span>
            </Box>
            <Box className="ml-auto shrink-0">{reasonsButton()}</Box>
          </Box>
          <Box className={`flex flex-wrap items-center gap-2 min-w-0 ${narrow() ? "" : "flex-1"}`}>
            <span
              data-testid="nifty-decision-state"
              data-decision-kind={decision().kind}
              title={decision().kind === "closed" ? "No live feed — this is a stored snapshot" : decision().stateLabel}
              style={{
                "font-size": `${REPORT_FONT.micro}px`,
                "font-weight": REPORT_FONT_WEIGHT.bold,
                "letter-spacing": "0.04em",
                "white-space": "nowrap",
                color: decision().kind === "live" ? palette.TEXT_MUTED : palette.WARNING,
              }}
            >
              {decision().stateLabel}
            </span>
            <Show when={decision().chip !== "decision"}>
              <span data-testid="nifty-decision-chip" style={STATE_CHIP_STYLE}>
                {decision().chip}
              </span>
            </Show>
            <Show when={!narrow()}>{heroClaim()}</Show>
          </Box>
          <Show when={narrow()}>{heroClaim()}</Show>
        </Box>
        <Box
          data-report-band="more-stats"
          className="w-full min-w-0 shrink-0"
          style={{ "min-height": `${DECISION_CONTEXT_HEIGHT}px` }}
        >
          <LiveTapeDisclosure
            open={verdictOpen()}
            onToggle={() => setVerdictOpen((v) => !v)}
            testId="nifty-verdict-disclosure"
            label="MORE STATS"
            openHint="hide"
            closedHint="walls · volatility · evidence"
          >
            {/* The shell promotes the old verdict body at 390. This inner gate
                keeps the new More stats detail genuinely collapsed there; only
                the toggle can open it. */}
            <Box
              className="flex flex-col gap-1 w-full min-w-0"
              style={{ display: verdictOpen() ? "flex" : "none" }}
            >
            <Box className="flex flex-wrap min-[1200px]:flex-nowrap items-stretch min-w-0 min-h-[28px]">
          <Box
            data-testid="nifty-decision-stats"
            className="flex flex-wrap flex-auto min-w-0 w-full [&_[data-testid$='-value']]:text-right"
            style={{ gap: `${REPORT_STRIP_METRICS.groupRowGap}px` }}
          >
            <StatGroup
              testId="nifty-stat-group-price"
              label="PRICE"
              weight={REPORT_STRIP_GROUP_WEIGHT.price}
            >
              <DecisionCell
                testId="nifty-stat-symbol"
                minWidth={REPORT_STRIP_CELL_MIN.symbol}
                label="Index"
                value={symbol()}
                hint={`${expiry() === "nearest" ? "nearest expiry" : expiry()} · ${mode() === "eod" ? "EOD" : "live"}`}
                accent={palette.PRIMARY}
                title="Underlying whose option chain this report was built from."
              />
              <DecisionCell
                testId="nifty-stat-change"
                minWidth={REPORT_STRIP_CELL_MIN.change}
                label="Change"
                value={sessionChange() ? formatSignedPoints(sessionChange()!.pts) : "—"}
                hint={
                  sessionChange()
                    ? `${sessionChange()!.pct >= 0 ? "+" : ""}${sessionChange()!.pct.toFixed(2)}% vs open`
                    : "vs session open"
                }
                accent={changeTone()}
                title="Session change against today's open — the report carries no previous close, so this is deliberately not labelled day-change."
              />
              <DecisionCell
                testId="nifty-stat-spot"
                minWidth={REPORT_STRIP_CELL_MIN.spot}
                label="Spot"
                value={
                  <NiftySpotValue
                    live={mode() === "live"}
                    fallback={report()?.spot ?? 0}
                  />
                }
                valueSize={REPORT_FONT.value}
                hint={
                  dayRange()
                    ? `day ${formatNumberIN(Math.round(dayRange()!.low))}–${formatNumberIN(
                        Math.round(dayRange()!.high),
                      )}`
                    : "intraday range"
                }
                title="NIFTY 50 spot, with today's low–high range underneath."
              />
              <DecisionCell
                testId="nifty-stat-regime"
                minWidth={REPORT_STRIP_CELL_MIN.regime}
                label="Regime"
                value={
                  regime()?.verdict ? resolveRegimeLabel(regime()!.verdict, regime()) : "—"
                }
                hint={regimeDetail(regime())}
                accent={regimeAccent(regime()?.verdict)}
                title="Volatility regime: sell premium in a range (realised < implied), buy premium in expansion (realised > implied)."
              />
              <DecisionCell
                testId="nifty-stat-flip"
                minWidth={REPORT_STRIP_CELL_MIN.flip}
                label="Gamma flip"
                value={
                  gexDegraded()
                    ? "n/a"
                    : gammaFlip() != null
                      ? formatInt(gammaFlip()!)
                      : "—"
                }
                hint={
                  gexDegraded()
                    ? "no dealer gamma snapshot — option greeks are missing"
                    : flipDelta() != null
                      ? `spot ${formatSignedPoints(flipDelta()!)}`
                      : "no dealer gamma cross at spot, so no flip strike"
                }
                accent={palette.TERM_FLIP}
                title="Dealer gamma flip: the strike where cumulative dealer gamma crosses zero at spot. Above it dealers damp moves; below it they amplify. The hint is spot minus the flip."
              />
            </StatGroup>

            <StatGroup
              testId="nifty-stat-group-walls"
              label="WALLS"
              weight={REPORT_STRIP_GROUP_WEIGHT.walls}
              divider
            >
              <DecisionCell
                testId="nifty-stat-call-wall"
                minWidth={REPORT_STRIP_CELL_MIN.callWall}
                label="Max-OI call"
                value={maxCallWall() ? formatInt(maxCallWall()!.strike) : "—"}
                valueSize={REPORT_FONT.value}
                hint={
                  maxCallWall()
                    ? `CE OI ${formatOiCr(maxCallWall()!.oi)}${
                        maxCallDistance() != null && Number.isFinite(maxCallDistance()!)
                          ? ` · ${maxCallDistance()! > 0 ? "+" : ""}${Math.round(maxCallDistance()!)} pts`
                          : ""
                      }`
                    : "no call OI"
                }
                accent={palette.TERM_CE}
                title="Heaviest OI across the chain (not the nearest strike). Max-OI call wall is the dealers' upside hedge; the distance from spot is shown next to the OI."
              />
              <DecisionCell
                testId="nifty-stat-put-wall"
                minWidth={REPORT_STRIP_CELL_MIN.putWall}
                label="Max-OI put"
                value={maxPutWall() ? formatInt(maxPutWall()!.strike) : "—"}
                hint={
                  maxPutWall()
                    ? `PE OI ${formatOiCr(maxPutWall()!.oi)}${
                        maxPutDistance() != null && Number.isFinite(maxPutDistance()!)
                          ? ` · ${maxPutDistance()! > 0 ? "+" : ""}${Math.round(maxPutDistance()!)} pts`
                          : ""
                      }`
                    : "no put OI"
                }
                accent={palette.TERM_PE}
                title="Heaviest OI across the chain (not the nearest strike). Max-OI put wall is the dealers' downside hedge; the distance from spot is shown next to the OI."
              />
              <DecisionCell
                testId="nifty-stat-pin"
                minWidth={REPORT_STRIP_CELL_MIN.pin}
                label="Pin risk"
                value={pin() ? pin()!.level : "—"}
                hint={pin() ? pinHint(pin()) : "spot / max pain missing"}
                accent={
                  pin()?.level === "HIGH"
                    ? palette.WARNING
                    : pin()?.level === "MEDIUM"
                      ? palette.TEXT
                      : palette.TEXT_MUTED
                }
                title="Pin detection: a wall at spot AND max pain at least 100 pts on the far side means the market is being pinned into expiry. A break there is usually a sweep — sell the range, and only buy a break after two consecutive 1-min closes beyond the wall."
              />
              <ContextCell
                testId="nifty-stat-max-pain"
                minWidth={REPORT_STRIP_CELL_MIN.maxPain}
                label="Max pain"
                value={
                  <>
                    <AnimatedValue value={report()?.maxPain ?? 0} format={formatInt} />
                    <Sparkline
                      values={maxPainSeries()}
                      testId="nifty-maxpain-spark"
                      color={palette.PRIMARY}
                    />
                  </>
                }
                valueSize={REPORT_FONT.value}
                title="Max pain — the strike where the most option contracts would expire worthless. Writers tend to pin price there into expiry; it is a magnet, not a forecast."
              />
            </StatGroup>

            <StatGroup
              testId="nifty-stat-group-volatility"
              label="VOLATILITY"
              weight={REPORT_STRIP_GROUP_WEIGHT.volatility}
              divider
              cellsTestId="nifty-context-stats"
            >
              <Show when={squeezeFuel()}>
                {(fuel) => (
                  <DecisionCell
                    testId="nifty-squeeze-fuel"
                    minWidth={REPORT_STRIP_CELL_MIN.squeezeFuel}
                    label="Squeeze fuel"
                    value="Building ↑"
                    hint={`${fuel().strike} call wall is ${fuel().sentiment === "SC" ? "short-covering" : "unwinding"} — a break above it accelerates`}
                    accent={palette.WARNING}
                    title="Squeeze fuel: price is pinned under the call wall and that wall's call OI is being covered (short-covering / long unwind). Writers are buying back the ceiling, so a break above it is fuel, not a cap. The opposite is a defended wall."
                  />
                )}
              </Show>
              <ContextCell
                testId="nifty-stat-pcr-oi"
                minWidth={REPORT_STRIP_CELL_MIN.pcrOi}
                label="P/C ratio · OI"
                value={
                  <>
                    <AnimatedValue value={report()?.pcrOi ?? 0} format={format2dp} />
                    <Sparkline
                      values={pcrSeries()}
                      testId="nifty-pcr-spark"
                      color={palette.TERM_CE}
                    />
                  </>
                }
                title="Put/call ratio · open interest — the ratio by open interest (outstanding contracts still held). Open interest is accumulated positioning; compare it with the put/call ratio by traded volume, which is today's flow."
              />
              <ContextCell
                testId="nifty-stat-pcr-vol"
                minWidth={REPORT_STRIP_CELL_MIN.pcrVol}
                label="P/C ratio · volume"
                value={<AnimatedValue value={report()?.pcrVol ?? 0} format={format2dp} />}
                title="Put/call ratio · volume — the ratio by traded volume this session. Volume is short-term flow; compare it with the put/call ratio by open interest, which is accumulated positioning."
              />
            </StatGroup>

            {/* Claim a whole line and keep the chips at their measured width:
                the old summed floor widened the grid track past 1600, so the
                group sat at the far right and Institutional flows read "Ins". */}
            <Show when={isDesk()}>
              <StatGroup
                testId="nifty-stat-group-flow"
                label="FLOW & ACTION"
                weight={REPORT_STRIP_GROUP_WEIGHT.flow}
                divider
                fullRow={!narrow()}
                wrapCells
                cellsMaxWidth={FLOW_CELLS_MAX_WIDTH}
              >
                <DecisionChip
                  testId="nifty-chip-setup"
                  minWidth={REPORT_STRIP_CELL_MIN.chipSetup}
                  label="Setup checks"
                  value={setupSummary()}
                  onClick={() => store.ui.setDeskDockTab("setup")}
                  help={setupHelp()}
                  ariaLabel="Setup checks — open the Setup tab with all seven checks"
                  fill
                />
                <DecisionChip
                  testId="nifty-chip-intel"
                  minWidth={REPORT_STRIP_CELL_MIN.chipIntel}
                  label="Institutional flows"
                  value="FII / DII"
                  onClick={() => store.ui.setDeskDockTab("market")}
                  help={INTEL_CHIP_HELP}
                  ariaLabel="Institutional flows — open the market panel for FII and DII net flows"
                  fill
                />
                <DecisionChip
                  testId="nifty-chip-gamma"
                  minWidth={REPORT_STRIP_CELL_MIN.chipGamma}
                  label="Dealer gamma"
                  value={
                    gexDegraded()
                      ? "n/a"
                      : `${gexForDisplay()?.regime === "short" ? "SHORT" : "LONG"} ${gammaFlip() != null ? formatInt(gammaFlip()!) : "—"}`
                  }
                  onClick={() => store.ui.setGammaOpen(true)}
                  tone={gexForDisplay()?.regime === "short" ? palette.NEGATIVE : palette.POSITIVE}
                  help={gammaChipHelp()}
                  ariaLabel="Dealer gamma — open the dealer gamma profile"
                  fill
                />
              </StatGroup>
            </Show>
          </Box>
        </Box>
            {verdictContent()}
            </Box>
          </LiveTapeDisclosure>
        </Box>
      </Box>

      <Show when={flowReport()}>
        {(flow) => (
          <Show
            when={narrow()}
            fallback={
              <Box {...{ [REPORT_SECTION_ATTR]: true }} className="contents">
                <NiftyFlowWindows
                  report={flow()}
                  lastFlip={lastFlip()}
                  showSessionValue={symbol() === "NIFTY"}
                />
              </Box>
            }
          >
            <LiveTapeDisclosure
              open={flowOpen()}
              onToggle={() => setFlowOpen((v) => !v)}
              testId="nifty-flow-windows-disclosure"
              label="FLOW WINDOWS"
              openHint="hide"
              closedHint="session · 15m · 5m"
            >
              <NiftyFlowWindows
                report={flow()}
                lastFlip={lastFlip()}
                showSessionValue={symbol() === "NIFTY"}
              />
            </LiveTapeDisclosure>
          </Show>
        )}
      </Show>

      <Show when={symbol() === "NIFTY" || symbol() === "SENSEX"}>
        <Box {...{ [REPORT_SECTION_ATTR]: true }} className="contents">
          <IndexMoversStrip
            index={symbol() === "NIFTY" ? "NIFTY" : "SENSEX"}
            onExpand={store.ui.openMovers}
            liveOnly={mode() === "eod" || report()?.market?.is_open === false}
          />
        </Box>
      </Show>

      <Show when={!isDesk()}>
        <Box
          data-testid="nifty-context-rail"
          className="flex items-stretch gap-0.5 w-full max-w-full min-w-0 shrink-0 max-[600px]:flex-col max-[600px]:[&>*]:flex-none max-[600px]:[&>*]:w-full"
        >
          <Show when={planSummary() != null}>
            <Box className="flex-[38_1_0] min-w-0 flex [&>*]:w-full [&>*]:min-w-0">
              <Box className="flex items-center gap-1 min-w-0">
                {railClaim()}
                {tapeBadgeControl()}
              </Box>
            </Box>
          </Show>
          <Show when={symbol() === "NIFTY"}>
            <Box
              data-testid="nifty-intel-cell"
              className="flex-[34_1_0] min-w-0 flex [&>*]:w-full [&>*]:min-w-0"
            >
              <NiftyIntelStrip
                date={mode() === "eod" ? date() || null : null}
                expiry={expiry() === "nearest" ? null : expiry()}
                eod={mode() === "eod"}
              />
            </Box>
          </Show>
          <Box
            data-testid="nifty-gamma-cell"
            className="flex-[28_1_0] min-w-0 flex [&>*]:w-full [&>*]:min-w-0"
          >
            <NiftyGammaStrip
              gex={gexForDisplay()}
              positioning={report()?.positioning}
              spot={report()?.spot ?? 0}
            />
          </Box>
        </Box>

        <SetupRadarStrip read={setup()} preMove={preMove()} />
      </Show>
    </Show>
  );
}