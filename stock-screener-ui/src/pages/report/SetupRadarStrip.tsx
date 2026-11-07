import { memo } from "react";
import Box from "@mui/material/Box";
import * as palette from "@/ui/palette";
import type { SetupRead, SetupState } from "./niftySetup";
import type { PreMoveScore } from "./niftyPreMove";

const STATE_COLOR: Record<SetupState, string> = {
  QUIET: palette.TEXT_MUTED,
  ARMED: palette.WARNING,
  TRIGGER: palette.POSITIVE,
};

const STATE_LABEL: Record<SetupState, string> = {
  QUIET: "QUIET",
  ARMED: "ARMED",
  TRIGGER: "TRIGGER",
};

/**
 * Five pre-move gates in one 24px line. Green = condition present, dim = not.
 * The score is the number of gates; ARMED (4/5) means prepare, TRIGGER (5/5)
 * means the wall is actually being covered. Every gate carries its own numbers
 * in the tooltip so the chip is a prompt, not a verdict.
 */
function SetupRadarStripInner({ read, preMove }: { read: SetupRead; preMove?: PreMoveScore }) {
  return (
    <Box
      data-testid="nifty-setup-radar"
      data-state={read.state}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: "5px",
        height: 24,
        minHeight: 24,
        px: 1,
        border: `1px solid ${palette.TERM_BORDER}`,
        borderRadius: "4px",
        bgcolor: palette.TERM_HEADER,
        width: "100%",
        minWidth: 0,
        flexShrink: 0,
        fontFamily: palette.MONO,
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <Box component="span" sx={{ color: palette.TEXT_MUTED, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", flexShrink: 0 }}>
        SETUP
      </Box>
      {read.gates.map((g) => (
        <Box
          key={g.key}
          component="span"
          data-testid={`nifty-setup-${g.key.toLowerCase()}`}
          data-pass={g.pass ? "true" : "false"}
          title={`${g.key}: ${g.detail}`}
          sx={{
            px: "4px",
            py: "1px",
            border: `1px solid ${g.pass ? palette.POSITIVE : palette.TERM_BORDER}`,
            borderRadius: "3px",
            bgcolor: g.pass ? "rgba(63,185,80,0.10)" : "transparent",
            color: g.pass ? palette.POSITIVE : palette.TEXT_MUTED,
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.04em",
            flexShrink: 0,
          }}
        >
          {g.key} {g.pass ? "✓" : "–"}
        </Box>
      ))}
      {preMove && preMove.state !== "quiet" ? (
        <Box
          component="span"
          data-testid="nifty-premove"
          data-state={preMove.state}
          title={preMove.components
            .map((c) => `${c.points > 0 ? "+" : ""}${c.points} ${c.label} — ${c.detail}`)
            .join("\n")}
          sx={{
            px: "4px",
            py: "1px",
            border: `1px solid ${preMove.state === "armed" ? palette.POSITIVE : palette.WARNING}`,
            borderRadius: "3px",
            bgcolor: preMove.state === "armed" ? "rgba(63,185,80,0.10)" : "transparent",
            color: preMove.state === "armed" ? palette.POSITIVE : palette.WARNING,
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: "0.04em",
            flexShrink: 0,
          }}
        >
          PRE {preMove.score}/{preMove.max} {preMove.state === "armed" ? "ARMED" : "WATCH"}
        </Box>
      ) : null}
      <Box
        component="span"
        data-testid="nifty-setup-score"
        sx={{
          marginLeft: preMove && preMove.state !== "quiet" ? "6px" : "auto",
          fontSize: 10,
          fontWeight: 800,
          color: STATE_COLOR[read.state],
          flexShrink: 0,
        }}
      >
        {read.score}/{read.gates.length} · {STATE_LABEL[read.state]}
      </Box>
    </Box>
  );
}

/** Memoised: `read` and `preMove` are memoised by the panel; the ~1 s spot
 *  tick must not repaint this strip. */
export const SetupRadarStrip = memo(SetupRadarStripInner);
SetupRadarStrip.displayName = "SetupRadarStrip";
