import { memo } from "react";
import type { ReactNode } from "react";
import { Box, Tooltip } from "@/ui";
import type { NiftyReport } from "@/types/niftyReport";
import * as palette from "@/ui/palette";
import { controlLabel } from "./NiftyVerdictStrip";
import { REPORT_FONT, REPORT_PAD, REPORT_RADIUS, REPORT_ROW } from "./reportTokens";
import {
  classifyFlowLeg,
  detectFlowFlip,
  flowFlipClock,
  fmtFlowCr,
  fmtFlowOi,
  sessionTone,
} from "./niftyFlowRead";
import type { FlowLastFlip, FlowTone } from "./niftyFlowRead";

const TONE_COLOR: Record<FlowTone, string> = {
  bull: palette.POSITIVE,
  bear: palette.NEGATIVE,
  mixed: palette.WARNING,
  flat: palette.TEXT_MUTED,
};

function Cell({
  label,
  tone,
  value,
  emphasis = false,
  testId,
}: {
  label: string;
  tone: FlowTone;
  value: ReactNode;
  emphasis?: boolean;
  testId?: string;
}) {
  return (
    <Box
      data-testid={testId}
      className="flex items-center min-w-0"
      style={{
        gap: `${REPORT_PAD.sm}px`,
        "padding-left": `${REPORT_PAD.md}px`,
        "padding-right": emphasis ? `${REPORT_PAD.sm}px` : 0,
        "background-color": emphasis ? palette.SURFACE_ALT : "transparent",
        borderLeft: emphasis
          ? `2px solid ${TONE_COLOR[tone]}`
          : `1px solid ${palette.TERM_BORDER}`,
      }}
    >
      <span style={{ color: palette.TEXT_MUTED, "font-weight": 700, "letter-spacing": "0.06em", "flex-shrink": 0 }}>
        {label}
      </span>
      <span style={{ color: TONE_COLOR[tone], "font-weight": emphasis ? 800 : 700, "white-space": "nowrap" }}>
        {value}
      </span>
    </Box>
  );
}

/**
 * SESSION / 15m / 5m flow header.
 *
 * The session block is premium flow and is cumulative; the 15m/5m legs are
 * CE/PE OI change. They routinely disagree (2026-11-04: session CALL BUYING,
 * 5m PUT BID). Showing all three — and a FLIP badge when the short leg
 * disagrees — is the point: the old single label made the flip invisible and
 * read as a contradiction against the heatmap.
 */
export const NiftyFlowWindows = memo(function NiftyFlowWindows({
  report,
  lastFlip = null,
  showSessionValue = true,
}: {
  report: NiftyReport;
  lastFlip?: FlowLastFlip | null;
  /** NIFTY's `control.flow_bias` is ₹ crore; generic underlyings use a
   *  different premium unit, so their session cell shows the verdict only. */
  showSessionValue?: boolean;
}) {
  const fw = report.flow_window;
  const leg5 = fw?.["5m"];
  const leg15 = fw?.["15m"];
  const session = sessionTone(report.control?.verdict);
  const flip = detectFlowFlip(leg5, leg15, session);
  const leg5c = classifyFlowLeg(leg5);
  const leg15c = classifyFlowLeg(leg15);
  const sessionLabel = controlLabel(report.control?.verdict).replace(/^SESSION(?: FLOW)? · /, "");
  const flipAt = leg5?.from ? String(leg5.from).slice(11, 16) : null;
  const lastFlipAt = flowFlipClock(lastFlip?.at);

  return (
    <Box
      data-testid="nifty-flow-windows"
      title="SESSION = premium flow (cumulative) · 15m/5m = CE/PE OI change. FLOW FLIP means the 5m leg disagrees with the 15m or the session."
      className="flex items-center min-w-0"
      style={{
        gap: `${REPORT_PAD.md}px`,
        height: `${REPORT_ROW.normal}px`,
        "min-height": `${REPORT_ROW.normal}px`,
        "padding-left": `${REPORT_PAD.md}px`,
        "padding-right": `${REPORT_PAD.md}px`,
        borderTop: `1px solid ${palette.TERM_BORDER}`,
        borderBottom: `1px solid ${palette.TERM_BORDER}`,
        "background-color": palette.TERM_HEADER,
        fontFamily: palette.MONO,
        "font-size": `${REPORT_FONT.xs}px`,
        "white-space": "nowrap",
        overflow: "hidden",
        "flex-shrink": 0,
      }}
    >
      <span style={{ color: palette.TEXT_MUTED, "font-weight": 800, "font-size": `${REPORT_FONT.micro}px`, "letter-spacing": "0.1em" }}>
        WINDOWS
      </span>

      <Tooltip
        label="CALL BID = CE build + PE unwind · PUT BID = CE unwind + PE build · BOTH BUILD/UNWIND = two-sided, no direction"
        position="bottom-start"
      >
        <span
          role="button"
          tabIndex={0}
          data-testid="flow-legend"
          aria-label="Flow window legend: CALL BID means call OI build plus put unwind; PUT BID means call unwind plus put build; BOTH BUILD or BOTH UNWIND is two-sided with no direction"
          style={{
            display: "inline-flex",
            "align-items": "center",
            "justify-content": "center",
            width: "14px",
            height: "14px",
            "flex-shrink": 0,
            "border-radius": `${REPORT_RADIUS.sm}px`,
            border: `1px solid ${palette.TERM_BORDER}`,
            color: palette.TEXT_MUTED,
            "font-size": `${REPORT_FONT.micro}px`,
            "font-weight": 800,
            "line-height": 1,
            cursor: "help",
          }}
        >
          ?
        </span>
      </Tooltip>

      <Cell
        testId="flow-session"
        label="SESSION"
        tone={session}
        value={
          <>
            {sessionLabel}
            {showSessionValue ? (
              <span style={{ color: palette.TEXT_MUTED, "font-weight": 500 }}>
                {" "}{fmtFlowCr(report.control?.flow_bias)}
              </span>
            ) : null}
          </>
        }
      />

      <Cell
        testId="flow-15m"
        label="15m"
        tone={leg15c.tone}
        value={
          <>
            CE {fmtFlowOi(leg15?.ce)} · PE {fmtFlowOi(leg15?.pe)}{" "}
            <span style={{ color: TONE_COLOR[leg15c.tone], "font-weight": 800 }}>{leg15c.label}</span>
          </>
        }
      />

      <Cell
        testId="flow-5m"
        label="5m"
        tone={leg5c.tone}
        emphasis
        value={
          <>
            CE {fmtFlowOi(leg5?.ce)} · PE {fmtFlowOi(leg5?.pe)}{" "}
            <span style={{ color: TONE_COLOR[leg5c.tone], "font-weight": 800 }}>{leg5c.label}</span>
          </>
        }
      />

      {flip.flipped ? (
        <Box
          data-testid="flow-flip"
          className="flex items-center shrink-0"
          style={{
            "margin-left": "auto",
            gap: `${REPORT_PAD.sm}px`,
            "padding-left": `${REPORT_PAD.sm}px`,
            "padding-right": `${REPORT_PAD.sm}px`,
            "padding-top": "1px",
            "padding-bottom": "1px",
            color: palette.WARNING,
            border: `1px solid ${palette.WARNING}`,
            "border-radius": `${REPORT_RADIUS.sm}px`,
            "font-weight": 800,
            "letter-spacing": "0.05em",
          }}
        >
          FLOW FLIP{flipAt ? ` since ${flipAt}` : ""} · {flip.reason}
        </Box>
      ) : (
        <Box
          data-testid="flow-aligned"
          className="shrink-0"
          style={{
            "margin-left": "auto",
            color: palette.TEXT_MUTED,
            "font-weight": 700,
            "letter-spacing": "0.05em",
          }}
        >
          ALIGNED
        </Box>
      )}

      {!flip.flipped && lastFlipAt ? (
        <span
          data-testid="flow-last-flip"
          title={`Last 5m sign flip ${lastFlipAt}${lastFlip?.reason ? ` · ${lastFlip.reason}` : ""}`}
          style={{
            color: palette.TEXT_MUTED,
            "font-weight": 700,
            "letter-spacing": "0.05em",
            "flex-shrink": 0,
            "padding-left": `${REPORT_PAD.sm}px`,
            "padding-right": `${REPORT_PAD.sm}px`,
            border: `1px solid ${palette.TERM_BORDER}`,
            "border-radius": `${REPORT_RADIUS.sm}px`,
            opacity: 0.85,
          }}
        >
          LAST FLOW FLIP {lastFlipAt}
        </span>
      ) : null}
    </Box>
  );
});
NiftyFlowWindows.displayName = "NiftyFlowWindows";
