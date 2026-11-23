import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Button } from "@/ui";
import * as palette from "@/ui/palette";
import { NiftySpotValue } from "./reportCells";
import { NiftyVerdictStrip } from "./NiftyVerdictStrip";
import { REPORT_FONT, REPORT_FONT_WEIGHT } from "./reportTokens";
import type { DecisionView } from "./ReportDecisionStrip.derive";
import {
  DECISION_HERO_HEIGHT,
  GROUP_LABEL_STYLE,
  HERO_CLAIM_STYLE,
  HERO_VALUE_STYLE,
  INDIA_VIX_STYLE,
  PLAN_BAR_STYLE,
  PLAN_CONFIDENCE_STYLE,
  PLAN_ONELINER_STYLE,
  STATE_CHIP_STYLE,
  TAPE_BADGE_STYLE,
  VERDICT_EVIDENCE_GAP,
  VERDICT_NARROW_OVERRIDES,
  verdictWrapLayout,
} from "./ReportDecisionStrip.format";

/** One hero claim, once. The headline node keeps its contract but now carries
 *  the overall state instead of an unbacked "NEUTRAL · no trade" conclusion. */
export function HeroClaim(props: { view: DecisionView }): JSX.Element {
  const view = props.view;
  return (
    <Box
      data-testid="nifty-plan-oneliner"
      className="flex flex-row flex-wrap items-center gap-x-2 min-w-0"
      style={PLAN_ONELINER_STYLE}
    >
      <Box
        data-testid="nifty-plan-headline"
        data-decision-kind={view.decision().kind}
        title={`${view.decision().stateLabel} — ${view.decision().claim}`}
        className="min-w-0"
        style={{ ...HERO_CLAIM_STYLE, color: view.claimTone() }}
      >
        {view.decision().claim}
      </Box>
      <Box
        data-testid="nifty-plan-confidence"
        data-confidence-computed={view.planConfidence().computed ? "true" : "false"}
        title={
          view.planConfidence().computed
            ? "Weighted confidence behind the active side"
            : "No directional call, so there is no confidence to compute"
        }
        className="shrink-0"
        style={PLAN_CONFIDENCE_STYLE}
      >
        {view.planConfidence().text}
      </Box>
    </Box>
  );
}

/** The research rail reuses the read without duplicating the hero's testids. */
export function RailClaim(props: { view: DecisionView }): JSX.Element {
  return (
    <Box className="flex items-center gap-1 min-w-0">
      <span
        className="min-w-0"
        style={{ ...HERO_CLAIM_STYLE, color: props.view.claimTone() }}
      >
        {props.view.decision().claim}
      </span>
    </Box>
  );
}

/** Tape speed is evidence, not a second verdict; the plan button lives in the
 *  hero so its testid appears exactly once per render. */
export function TapeBadgeControl(props: { view: DecisionView }): JSX.Element {
  return (
    <Show when={props.view.tapeBadge()}>
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
}

function ReasonsButton(props: { view: DecisionView }): JSX.Element {
  return (
    <Button
      data-testid="nifty-plan-reasons-button"
      size="xs"
      variant="subtle"
      aria-label="Open the full two-sided desk plan"
      title="Open the full two-sided desk plan (E)"
      onClick={props.view.store.ui.openPlanReasons}
    >
      ▸
    </Button>
  );
}

/** The first viewport's single decision band: SPOT, CHANGE and one claim.
 *  No evidence chips are duplicated here — they live below in More stats. */
export function DecisionHero(props: { view: DecisionView }): JSX.Element {
  const view = props.view;
  const narrow = view.narrow;
  return (
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
            <NiftySpotValue live={view.mode() === "live"} fallback={view.report()?.spot ?? 0} />
          </span>
        </Box>
        <Box data-testid="nifty-hero-change" className="flex items-baseline gap-1 shrink-0">
          <span style={{ ...GROUP_LABEL_STYLE, "font-size": `${REPORT_FONT.micro}px` }}>
            CHANGE
          </span>
          <span
            data-testid="nifty-hero-change-read"
            style={{ ...HERO_VALUE_STYLE, color: view.changeTone() }}
          >
            {view.sessionChange() ? view.formatSignedPoints(view.sessionChange()!.pts) : "—"}
          </span>
        </Box>
        <Box className="ml-auto shrink-0">
          <ReasonsButton view={view} />
        </Box>
      </Box>
      <Box className={`flex flex-wrap items-center gap-2 min-w-0 ${narrow() ? "" : "flex-1"}`}>
        <span
          data-testid="nifty-decision-state"
          data-decision-kind={view.decision().kind}
          title={
            view.decision().kind === "closed"
              ? "No live feed — this is a stored snapshot"
              : view.decision().stateLabel
          }
          style={{
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": REPORT_FONT_WEIGHT.bold,
            "letter-spacing": "0.04em",
            "white-space": "nowrap",
            color: view.decision().kind === "live" ? palette.TEXT_MUTED : palette.WARNING,
          }}
        >
          {view.decision().stateLabel}
        </span>
        <Show when={view.decision().chip !== "decision"}>
          <span data-testid="nifty-decision-chip" style={STATE_CHIP_STYLE}>
            {view.decision().chip}
          </span>
        </Show>
        <Show when={!narrow()}>
          <HeroClaim view={view} />
        </Show>
      </Box>
      <Show when={narrow()}>
        <HeroClaim view={view} />
      </Show>
    </Box>
  );
}

/** The verdict block holds only evidence: no second claim, no second verdict. */
export function VerdictContent(props: { view: DecisionView }): JSX.Element {
  const view = props.view;
  const narrow = view.narrow;
  const wrapLayout = () => verdictWrapLayout(narrow());
  return (
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
          style={{ ...PLAN_BAR_STYLE, "background-color": view.claimTone() }}
        />
        <Box data-testid="nifty-verdict-evidence" className="flex flex-1 min-w-0 items-stretch gap-2">
          <span className="shrink-0 self-center" style={GROUP_LABEL_STYLE}>
            Evidence
          </span>
          <Box className="flex flex-1 min-w-0">
            <NiftyVerdictStrip report={view.report()!} mode="context" />
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
        <Show when={view.isDesk()}>
          <Box className="flex items-center gap-1 shrink-0">
            <TapeBadgeControl view={view} />
          </Box>
        </Show>
      </Box>
      <Show when={view.symbol() !== "NIFTY"}>
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
}
