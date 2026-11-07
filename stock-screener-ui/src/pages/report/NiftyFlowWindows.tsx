import { memo } from "react";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
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
      sx={{
        display: "flex",
        alignItems: "center",
        gap: `${REPORT_PAD.sm}px`,
        minWidth: 0,
        pl: `${REPORT_PAD.md}px`,
        pr: emphasis ? `${REPORT_PAD.sm}px` : 0,
        bgcolor: emphasis ? palette.SURFACE_ALT : "transparent",
        borderLeft: emphasis
          ? `2px solid ${TONE_COLOR[tone]}`
          : `1px solid ${palette.TERM_BORDER}`,
      }}
    >
      <Box component="span" sx={{ color: palette.TEXT_MUTED, fontWeight: 700, letterSpacing: "0.06em", flexShrink: 0 }}>
        {label}
      </Box>
      <Box component="span" sx={{ color: TONE_COLOR[tone], fontWeight: emphasis ? 800 : 700, whiteSpace: "nowrap" }}>
        {value}
      </Box>
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
      sx={{
        display: "flex",
        alignItems: "center",
        gap: `${REPORT_PAD.md}px`,
        height: REPORT_ROW.normal,
        minHeight: REPORT_ROW.normal,
        px: `${REPORT_PAD.md}px`,
        borderTop: `1px solid ${palette.TERM_BORDER}`,
        borderBottom: `1px solid ${palette.TERM_BORDER}`,
        bgcolor: palette.TERM_HEADER,
        fontFamily: palette.MONO,
        fontSize: REPORT_FONT.xs,
        whiteSpace: "nowrap",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <Box component="span" sx={{ color: palette.TEXT_MUTED, fontWeight: 800, fontSize: REPORT_FONT.micro, letterSpacing: "0.1em" }}>
        WINDOWS
      </Box>

      <Tooltip
        title="CALL BID = CE build + PE unwind · PUT BID = CE unwind + PE build · BOTH BUILD/UNWIND = two-sided, no direction"
        placement="bottom-start"
        enterTouchDelay={0}
      >
        <Box
          component="span"
          role="button"
          tabIndex={0}
          data-testid="flow-legend"
          aria-label="Flow window legend: CALL BID means call OI build plus put unwind; PUT BID means call unwind plus put build; BOTH BUILD or BOTH UNWIND is two-sided with no direction"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 14,
            height: 14,
            flexShrink: 0,
            borderRadius: `${REPORT_RADIUS.sm}px`,
            border: `1px solid ${palette.TERM_BORDER}`,
            color: palette.TEXT_MUTED,
            fontSize: REPORT_FONT.micro,
            fontWeight: 800,
            lineHeight: 1,
            cursor: "help",
            "&:hover, &:focus-visible": { color: palette.TEXT, borderColor: palette.TEXT_MUTED, outline: "none" },
          }}
        >
          ?
        </Box>
      </Tooltip>

      <Cell
        testId="flow-session"
        label="SESSION"
        tone={session}
        value={
          <>
            {sessionLabel}
            {showSessionValue ? (
              <Box component="span" sx={{ color: palette.TEXT_MUTED, fontWeight: 500 }}>
                {" "}{fmtFlowCr(report.control?.flow_bias)}
              </Box>
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
            <Box component="span" sx={{ color: TONE_COLOR[leg15c.tone], fontWeight: 800 }}>{leg15c.label}</Box>
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
            <Box component="span" sx={{ color: TONE_COLOR[leg5c.tone], fontWeight: 800 }}>{leg5c.label}</Box>
          </>
        }
      />

      {flip.flipped ? (
        <Box
          data-testid="flow-flip"
          sx={{
            ml: "auto",
            display: "flex",
            alignItems: "center",
            gap: `${REPORT_PAD.sm}px`,
            px: `${REPORT_PAD.sm}px`,
            py: "1px",
            color: palette.WARNING,
            border: `1px solid ${palette.WARNING}`,
            borderRadius: `${REPORT_RADIUS.sm}px`,
            fontWeight: 800,
            letterSpacing: "0.05em",
            flexShrink: 0,
          }}
        >
          FLOW FLIP{flipAt ? ` since ${flipAt}` : ""} · {flip.reason}
        </Box>
      ) : (
        <Box
          data-testid="flow-aligned"
          sx={{ ml: "auto", color: palette.TEXT_MUTED, fontWeight: 700, letterSpacing: "0.05em", flexShrink: 0 }}
        >
          ALIGNED
        </Box>
      )}

      {!flip.flipped && lastFlipAt ? (
        <Box
          component="span"
          data-testid="flow-last-flip"
          title={`Last 5m sign flip ${lastFlipAt}${lastFlip?.reason ? ` · ${lastFlip.reason}` : ""}`}
          sx={{
            color: palette.TEXT_MUTED,
            fontWeight: 700,
            letterSpacing: "0.05em",
            flexShrink: 0,
            px: `${REPORT_PAD.sm}px`,
            border: `1px solid ${palette.TERM_BORDER}`,
            borderRadius: `${REPORT_RADIUS.sm}px`,
            opacity: 0.85,
          }}
        >
          LAST FLOW FLIP {lastFlipAt}
        </Box>
      ) : null}
    </Box>
  );
});
NiftyFlowWindows.displayName = "NiftyFlowWindows";
