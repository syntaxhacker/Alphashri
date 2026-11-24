import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import { NiftyVerdictStrip } from "./NiftyVerdictStrip";
import type { DecisionView } from "./ReportDecisionStrip.derive";
import {
  GROUP_LABEL_STYLE,
  INDIA_VIX_STYLE,
  PLAN_BAR_STYLE,
  TAPE_BADGE_STYLE,
  VERDICT_EVIDENCE_GAP,
  VERDICT_NARROW_OVERRIDES,
  verdictWrapLayout,
} from "./ReportDecisionStrip.format";

export { DecisionStats } from "./ReportDecisionStrip.groups";

/** Tape speed is evidence, not a second verdict. The strip renders it only for
 *  the desk; the research rail reuses it when the hero's evidence is hidden. */
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

/**
 * Legacy facade slot. It used to render `label="ALL STATS"` with
 * `testId="nifty-verdict-disclosure"` and a `data-report-band="more-stats"`
 * full-width row. The 32px decision band now owns that disclosure and its
 * `data-testid="nifty-live-tape-content"` detail as a fixed popover, so a
 * second in-flow row here would push the chart down again. This export stays
 * so the composition root owned by another lane does not have to change.
 */
export function MoreStats(_props: {
  view: DecisionView;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  return null;
}
