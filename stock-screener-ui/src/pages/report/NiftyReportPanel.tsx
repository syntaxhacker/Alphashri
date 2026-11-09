import { formatNumberIN } from "@/utils/ui-helpers";
import { hexToRgba } from "@/utils/color";
import { usePolling } from "@/hooks/usePolling";
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import { IconX } from "@tabler/icons-react";
import {
  Button,
  SegmentedControl,
  Select,
  Text,
  TextInput,
} from "@/ui";
import * as palette from "@/ui/palette";
import {
  REPORT_FONT,
  REPORT_LINE_HEIGHT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
  REPORT_PAD,
} from "./reportTokens";
import {
  NiftyChartPanel,
  CHART_HEIGHTS,
  CHART_ROW_CHROME,
  FILL_MAX_HEIGHT,
} from "./NiftyChartPanel";
import type { ChartSize, ChartTimeframe } from "./NiftyChartPanel";
import {
  NiftyReplayBar,
  buildReplaySegments,
  countReplayHoles,
  toReplayReasons,
} from "./NiftyReplayBar";
import type { ReplayReason } from "./NiftyReplayBar";
import { NiftyUpdatedLabel } from "./NiftyUpdatedLabel";
import { NiftyDataFreshness } from "./NiftyDataFreshness";
import { formatReportClock } from "./reportFormat";
import { NiftyTapeTable } from "./NiftyTapeTable";
import { NiftyUnusualVolume, UNUSUAL_TERM_BG, UNUSUAL_TERM_BORDER } from "./NiftyUnusualVolume";
import { sentimentCode, sentimentLabel, sentimentNote, sentimentSign } from "./optionSentiment";
import { NiftyStructureShifts } from "./NiftyStructureShifts";
import { NiftyOiHeatmap } from "./NiftyOiHeatmap";
import { NiftyFlowStrip } from "./NiftyFlowStrip";
import { NiftyIntelStrip } from "./NiftyIntelStrip";
import { NiftyGammaStrip } from "./NiftyGammaStrip";
import { NiftyPositionsDrawer } from "./NiftyPositionsDrawer";
import { SimDesk } from "./sim/SimDesk";
import { NiftyDeskGuide } from "./NiftyDeskGuide";
import { NiftyWallMigration } from "./NiftyWallMigration";
import { NiftyParticipantFlow } from "./NiftyParticipantFlow";
import { NiftyVolumeProfile } from "./NiftyVolumeProfile";
import { NiftyPnlAttribution } from "./NiftyPnlAttribution";
import type { NiftyPnlGreeks, NiftyPnlPosition } from "./niftyPnlAttribution";
import { NiftyDeltaPositioning } from "./NiftyDeltaPositioning";
import {
  NiftyGexProfile,
  gexFlipAtSpot,
  gexRegimeAtSpot,
  gexSideCopy,
  gexSideLevels,
} from "./NiftyGexProfile";
import { NiftyIvSkew } from "./NiftyIvSkew";
import { NiftyIvStraddle } from "./NiftyIvStraddle";
import { NiftyGammaTime } from "./NiftyGammaTime";
import {
  NiftyVerdictStrip,
  resolveRegimeLabel,
  regimeAccent,
  regimeDetail,
} from "./NiftyVerdictStrip";
import {
  NiftyFlowWindows,
} from "./NiftyFlowWindows";
import { IndexMoversStrip } from "./IndexMoversStrip";
import { IndexMoversModal } from "./IndexMoversModal";
import {
  detectFlowFlip,
  detectFlipChange,
  flipStorageKey,
  flowWindowFromTape,
  loadStoredFlip,
  saveStoredFlip,
  sessionTone,
} from "./niftyFlowRead";
import type { FlipWatchState, FlowLastFlip } from "./niftyFlowRead";
import { NiftyDeskPlan } from "./NiftyDeskPlan";
import { LevelsInPlay, LevelsInPlayContent } from "./LevelsInPlay";
import { buildDeskPlan } from "./deskPlan";
import { summarizeDeskPlan } from "./deskPlanSummary";
import type { PlanInput } from "./deskPlanSummary";
import { PanelModal } from "@/components/common/PanelModal";
import { useDeskHotkeys } from "@/hooks/useDeskHotkeys";
import type { DeskChartTimeframe } from "@/hooks/useDeskHotkeys";
import { MarketAlertLog, MarketAlertStack } from "@/components/notifications/MarketAlertCard";
import { OI_ALERT_TOAST_MAX, useNiftyOiAlerts } from "./useNiftyOiAlerts";
import { TREND_EMA_SPAN, criticalBannerText, burstTimeLabel, isNonTradeAlertType, spotMinutesBefore, premiumChangeBefore } from "./niftyOiBursts";
import { pinHint, pinRisk } from "./niftyPin";
import { alertsMuted, flashAlertTitle, playAlertSound, setAlertsMuted } from "./alertSound";
import { createWallMoveState, nextWallMoveState, wallMoveTitle } from "./niftyWallMoves";
import { buildPressure } from "./niftyPressure";
import { setupRadar } from "./niftySetup";
import { symbolMetrics, flowNoiseFor, type SymbolMetrics } from "./symbolMetrics";
import { scorePreMove, seedPreMoveHistory } from "./niftyPreMove";
import type { PreMoveScore } from "./niftyPreMove";
import { NiftySqueezeRadar, type WallSnapshot } from "./NiftySqueezeRadar";
import { NiftyWallsCard } from "./NiftyWallsCard";
import { NiftyWallErosionBoard } from "./NiftyWallErosionBoard";
import { useReplayWalls } from "./useReplayWalls";
import { NiftyWallsExpanded } from "./NiftyWallsExpanded";
import { resolveWallBoard } from "./niftyWallsFormat";
import { wallCode, wallSide } from "./niftyChartMath";
import { DeskDock, type DeskDockKey, type DeskDockTab } from "./DeskDock";
import { appendPreMove } from "./niftyPreMoveHistory";
import type { PreMovePoint } from "./niftyPreMoveHistory";
import { NiftyPressureLane } from "./NiftyPressureLane";
import { SetupRadarStrip } from "./SetupRadarStrip";
import { BreadthStrip } from "./BreadthStrip";
import { Nifty10sStrip } from "./Nifty10sStrip";
import { useNiftyBlasts } from "./useNiftyBlasts";
import type { OiPoint } from "./Nifty10sStrip";
import { buildFlowSeries } from "./niftyFlowSeries";
import { NiftyFlowChart } from "./NiftyFlowChart";
import { paperToPnlLeg } from "./niftyPositions";
import { resampleTape } from "./tapeRange";
import type { TapeRange } from "./tapeRange";
import { RangeToggle } from "./RangeToggle";
import { Sparkline } from "@/components/common/Sparkline";

/** Placeholder report for playhead-only frames (never painted). */
const REPLAY_STUB_REPORT = Object.freeze({}) as unknown as NiftyReport;
import type { MinutePremium } from "./niftyOiBursts";
import { useNiftyBurstStream } from "@/hooks/useNiftyBurstStream";
import { useNiftyReportStream, useNiftySpotTick } from "@/hooks/useNiftyReportStream";
import type { OiBurst } from "./niftyOiBursts";
import { TanStackTable } from "@/components/common/TanStackTable";
import { formatLegChange, rowFlags } from "./optionChainMetrics";
import type { ChainWalls } from "./optionChainMetrics";
import { AnimatedValue } from "@/components/common/AnimatedValue";
import { CompactPanel, CompactStat, CompactStatGrid } from "@/components/common/compact";
import { EmptyCompact, ErrorAlert, InlineLoader } from "@/components/common/states";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  NiftyBurst,
  NiftyReport,
  NiftyReportMode,
  NiftyReplay,
  NiftyReplayFrame,
  NiftySensex,
  NiftyStrike,
  NiftyTape,
} from "@/types/niftyReport";
import { fetchBreadth, fetchChain10sSummary, fetchLiveNifty, fetchLiveSensex, fetchNiftyByDate, fetchNiftyExpiries, fetchNiftyReplay, fetchNiftyReplayFrame, fetchNiftyReplayMeta, fetchNiftyReplayDates, fetchNiftyTape, fetchNiftyBursts, fetchOptionsLive, fetchOptionsLiveCandles, fetchOptionsTape, fetchOptionsBursts, fetchOptionsChain10s, fetchOptionsReplay, fetchOptionsReplayDates, fetchOptionsReplayFrame, fetchOptionsReplayMeta, fetchOptionsSnapshot, fetchOptionsExpiries, snapshotNifty } from "@/api/reportNifty";
import type { BreadthPayload, Chain10sSummaryPoint, NiftyReplayMeta } from "@/api/reportNifty";
import { fetchPositions } from "@/api/paperTrading";
import type { PaperPosition } from "@/types/paperTrading";
import {
  computeReplayCoverage,
} from "./niftyReplayCoverage";
import { isDerivativesOpenIst } from "@/utils/marketClock";

export interface NiftyReportPanelProps {
  onOpenSymbol?: (s: string) => void;
}

/** Hoisted empty fallback — an inline `[]` would break `NiftySqueezeRadar`'s
 *  memo on every parent render (the parent repaints ~1/s on the spot tick). */
const EMPTY_WALL_HISTORY: WallSnapshot[] = [];

/**
 * Headline cell of the decision strip: a 9px muted label over a 12px tabular
 * value (spot runs 15px as the anchor number). The old third detail line
 * moved into the `title` tooltip so the strip is one ~30px row: label above,
 * value below, nothing else. The strip answers five questions in the same
 * order every session — where is spot, what regime, where does dealer gamma
 * flip, and where are the call/put walls. Everything else is context.
 */
const DECISION_CELL_SX = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  // Grow into the strip's slack: the parent is `flex: 1 1 auto`, so without a
  // grow the header cells stay content-width and leave a dead band before the
  // right-anchored context group at wide viewports. The `minWidth` floors keep
  // the narrow-screen wrap behaviour intact.
  flex: "1 1 0",
  gap: "1px",
  minWidth: { xs: 92, md: 96 },
  px: REPORT_PAD.sm / 8,
  py: REPORT_PAD.xs / 8,
  borderLeft: `1px solid ${palette.TERM_BORDER}`,
  "&:first-of-type": { borderLeft: "none" },
} as const;

const DECISION_LABEL_STYLE: CSSProperties = {
  fontSize: REPORT_FONT.xs - 1,
  lineHeight: REPORT_LINE_HEIGHT.snug,
  letterSpacing: REPORT_LETTER_SPACING.wide,
  textTransform: "uppercase",
};

const DECISION_VALUE_STYLE: CSSProperties = {
  fontSize: REPORT_FONT.sm,
  fontWeight: REPORT_FONT_WEIGHT.bold,
  lineHeight: REPORT_LINE_HEIGHT.tight,
  fontFamily: palette.MONO,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/** Secondary context cell (PCR / max pain) — same rows, quieter type. */
const CONTEXT_CELL_SX = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  // Same grow as the headline cells so the right group shares the strip
  // instead of sitting on an `auto` margin at a fixed content width.
  flex: "1 1 0",
  gap: "1px",
  minWidth: 64,
  px: REPORT_PAD.sm / 8,
  py: REPORT_PAD.xs / 8,
  borderLeft: `1px solid ${palette.TERM_BORDER}`,
} as const;

const CONTEXT_LABEL_STYLE: CSSProperties = {
  fontSize: REPORT_FONT.xs - 1,
  lineHeight: REPORT_LINE_HEIGHT.snug,
  letterSpacing: REPORT_LETTER_SPACING.normal,
  textTransform: "uppercase",
};

const CONTEXT_VALUE_STYLE: CSSProperties = {
  fontSize: REPORT_FONT.sm,
  fontWeight: REPORT_FONT_WEIGHT.bold,
  lineHeight: REPORT_LINE_HEIGHT.snug,
  fontFamily: palette.MONO,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

/** One headline number. `hint` feeds the tooltip, never a third text line. */
function DecisionCell({
  testId,
  label,
  value,
  hint,
  accent,
  title,
  valueSize,
}: {
  testId: string;
  label: string;
  value: ReactNode;
  hint: string;
  accent?: string;
  title?: string;
  /** Spot runs larger than the rest; defaults to DECISION_VALUE_STYLE. */
  valueSize?: number;
}) {
  return (
    <Box
      data-testid={testId}
      title={title ? `${title} — ${hint}` : `${label}: ${hint}`}
      sx={DECISION_CELL_SX}
    >
      <Text span size="xs" fw={700} c="dimmed" style={DECISION_LABEL_STYLE}>
        {label}
      </Text>
      <Text
        span
        fw={700}
        c={accent}
        style={{
          ...DECISION_VALUE_STYLE,
          ...(valueSize != null ? { fontSize: valueSize } : {}),
        }}
        data-testid={`${testId}-value`}
      >
        {value}
      </Text>
    </Box>
  );
}

/** Compact context number (label above, 13px value). */
function ContextCell({
  testId,
  label,
  value,
}: {
  testId: string;
  label: string;
  value: ReactNode;
}) {
  return (
    <Box data-testid={testId} sx={CONTEXT_CELL_SX}>
      <Text span size="xs" fw={700} c="dimmed" style={CONTEXT_LABEL_STYLE}>
        {label}
      </Text>
      <Text span fw={700} style={CONTEXT_VALUE_STYLE}>
        {value}
      </Text>
    </Box>
  );
}

function DecisionChip({
  testId,
  label,
  value,
  onClick,
  tone,
}: {
  testId: string;
  label: string;
  value: string;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <Button
      data-testid={testId}
      size="sm"
      variant="subtle"
      onClick={onClick}
      title={`${label} — ${value}`}
      sx={{
        minWidth: 0,
        height: 20,
        px: 0.6,
        py: 0,
        gap: 0.4,
        border: `1px solid ${palette.TERM_BORDER}`,
        borderRadius: "4px",
        whiteSpace: "nowrap",
      }}
    >
      <Text span size="xs" fw={700} c="dimmed" style={{ fontSize: 8, letterSpacing: "0.05em" }}>
        {label}
      </Text>
      <Text
        span
        size="xs"
        fw={700}
        style={{ fontSize: 9, color: tone ?? palette.TEXT, fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </Text>
    </Button>
  );
}

/** Analytics grid cell: the panel fills the row height so both columns end on
 *  the same line instead of leaving a hole under the shorter panel. */
const ANALYTICS_CELL_SX = {
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  "& > *": { flex: 1, minHeight: 0 },
} as const;

/** The delta table has unbounded rows; contain it so the (bounded) gamma
 *  panel sets the analytics row height and the table scrolls inside. */
const ANALYTICS_FILL_CELL_SX = {
  ...ANALYTICS_CELL_SX,
  contain: { xs: "none", lg: "size" },
} as const;

/** Signed integer points, Indian grouping (`+733 pts`). */
function formatSignedPoints(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${formatNumberIN(rounded)} pts`;
}

/** Open interest in contracts, compact (`2.69 Cr`, `18.4 L`). */
function formatOiCr(oi: number | null | undefined): string {
  if (oi == null || !Number.isFinite(oi) || oi <= 0) return "—";
  if (oi >= 1e7) return `${(oi / 1e7).toFixed(2)} Cr`;
  if (oi >= 1e5) return `${(oi / 1e5).toFixed(1)} L`;
  return formatNumberIN(oi);
}

/** Priority copy for the setup banner: a live flow flip outranks "arming". */
export function setupBannerHeadline(
  flipped: boolean,
  reason: string | null | undefined,
  score: number,
  max: number,
): string {
  return flipped
    ? `FLOW FLIP · ${reason ?? "5m vs 15m"} — setup paused`
    : `⏳ SETUP ARMING ${score}/${max}`;
}

/** Overnight levels derived from the live chain — no static copy. */
export function buildOvernightLevels(report: NiftyReport): {
  resistance: { strike: number; pct: number }[];
  support: { strike: number; pct: number }[];
  painPull: { dir: string; pct: number };
  pcrVerdict: string;
} {
  const pct = (s: number) =>
    report.spot > 0 ? ((s - report.spot) / report.spot) * 100 : 0;
  const resistance = [...(report.walls?.calls ?? [])]
    .map((w) => w.strike)
    .filter((s) => s > report.spot)
    .sort((a, b) => a - b)
    .slice(0, 2)
    .map((strike) => ({ strike, pct: pct(strike) }));
  const support = [...(report.walls?.puts ?? [])]
    .map((w) => w.strike)
    .filter((s) => s < report.spot)
    .sort((a, b) => b - a)
    .slice(0, 2)
    .map((strike) => ({ strike, pct: pct(strike) }));
  const painPct = pct(report.maxPain);
  const painPull = {
    dir: painPct > 0.05 ? "up" : painPct < -0.05 ? "down" : "flat",
    pct: painPct,
  };
  // Replay frames and pre-open snapshots can omit PCR (no quoted legs yet).
  // The old direct `toFixed` crashed the whole panel on that payload.
  const pcrOi = Number(report.pcrOi);
  const pcrVerdict = !Number.isFinite(pcrOi)
    ? "PCR-OI n/a — chain incomplete"
    : pcrOi < 0.7
      ? `Bearish (PCR-OI ${pcrOi.toFixed(2)} — call writers in control)`
      : pcrOi > 1.0
        ? `Bullish (PCR-OI ${pcrOi.toFixed(2)} — put writers in control)`
        : `Neutral (PCR-OI ${pcrOi.toFixed(2)})`;
  return { resistance, support, painPull, pcrVerdict };
}

/**
 * Compact buildup badge. The code *is* the content (`LB`/`SB`/`SC`/`LU`) with
 * the full label on the tooltip — 60 full "Long Buildup" pills turned both
 * signal columns into a wall of text at the chain's real width. The hue still
 * carries direction (green = bullish for that side, red = bearish) via the
 * same tick + coloured-text language. Unknown labels render raw (dimmed) so
 * legacy payloads (`Bullish`/`Bearish`) never blank the column.
 */
function sentimentBadge(sentiment: string, side: "ce" | "pe") {
  const code = sentimentCode(sentiment);
  const label = sentimentLabel(sentiment);
  // Same directional map as the backend `class_sign` (see optionSentiment):
  // CE LB/SC bullish; PE SB/LU bullish. The per-contract reading lives in the
  // tooltip because e.g. a put `SC` is writers closing a long-delta hedge —
  // bearish for the market even though it is a "cover".
  const sign = sentimentSign(sentiment, side);
  const tone = sign === 0 ? palette.TEXT_MUTED : sign > 0 ? palette.POSITIVE : palette.NEGATIVE;
  const short = sign === 0 ? label || "—" : code;
  const upperSide: "CE" | "PE" = side === "ce" ? "CE" : "PE";
  const title = code
    ? `${label} (${upperSide}) — ${sentimentNote(code, upperSide)}`
    : label || sentiment;
  return (
    <Box
      component="span"
      title={title}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "4px",
        maxWidth: "100%",
        overflow: "hidden",
        px: "4px",
        py: "1px",
        borderRadius: "3px",
        // No fill: a coloured block behind 16 identical labels turns both
        // signal columns into a pair of neon bands. The tick + coloured text
        // carries the same meaning on a black surface.
        whiteSpace: "nowrap",
        verticalAlign: "middle",
      }}
    >
      <Box
        component="span"
        aria-hidden
        sx={{ width: 3, height: 11, borderRadius: "1px", bgcolor: tone, flexShrink: 0 }}
      />
      <Text size="xs" fw={700} span truncate sx={{ color: tone }}>
        {short}
      </Text>
    </Box>
  );
}

/** Call-wall / put-wall tag: a 5px leg-hue dot + 9px code, before the numeral.
 *  Uses wallSide/wallCode to show CW↓/PW↑ when the strike is on the wrong side of spot. */
function wallTag(strike: number, spot: number, isCall: boolean, color: string) {
  const side = wallSide(strike, spot);
  const code = wallCode(isCall, side, false);
  const isPrimaryCall = isCall && side === "above";
  const isPrimaryPut = !isCall && side === "below";
  const testId = isPrimaryCall
    ? "nifty-wall-cw"
    : isPrimaryPut
    ? "nifty-wall-pw"
    : isCall
    ? "nifty-wall-cw-below"
    : "nifty-wall-pw-above";
  const title = isCall
    ? side === "above"
      ? "Call wall (top CE OI)"
      : "Call wall below spot (broken resistance)"
    : side === "below"
    ? "Put wall (top PE OI)"
    : "Put wall above spot (broken support)";
  return (
    <Box
      component="span"
      data-testid={testId}
      title={title}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
        flexShrink: 0,
      }}
    >
      <Box
        component="span"
        aria-hidden
        sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: color, flexShrink: 0 }}
      />
      <Text size="xs" span fw={700} style={{ fontSize: 9 }} sx={{ color }}>
        {code}
      </Text>
    </Box>
  );
}

/**
 * ΔOI cell: right-aligned numeral in the leg hue plus a 3px bar underneath
 * whose width is `|ΔOI| / max|ΔOI|` over the visible rows (cap 100%). The
 * number keeps the leg hue (the column already says which side it is); the
 * bar carries the sign (green build / red unwind) so direction reads at a
 * glance without repainting every numeral.
 */
function oiChangeBarCell(
  value: number,
  max: number | undefined,
  legHue: string,
  barTestId: string,
) {
  const text = Number.isFinite(value) ? formatNumberIN(value) : "—";
  const denom = max != null && max > 0 ? max : 0;
  const pct = denom > 0 && Number.isFinite(value) ? Math.min(100, (Math.abs(value) / denom) * 100) : 0;
  const tone =
    value > 0 ? palette.POSITIVE : value < 0 ? palette.NEGATIVE : palette.TEXT_MUTED;
  return (
    <Box
      component="span"
      title={`${text} ΔOI`}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: "2px",
        overflow: "hidden",
        fontFamily: palette.MONO,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Text size="xs" span fw={500} sx={{ color: legHue }}>
        {text}
      </Text>
      <Box
        component="span"
        aria-hidden
        sx={{
          display: "block",
          width: "100%",
          height: 3,
          borderRadius: "1px",
          bgcolor: hexToRgba(legHue, 0.18),
          overflow: "hidden",
        }}
      >
        <Box
          component="span"
          data-testid={barTestId}
          data-pct={Math.round(pct)}
          sx={{
            display: "block",
            width: `${pct}%`,
            height: "100%",
            borderRadius: "1px",
            bgcolor: tone,
          }}
        />
      </Box>
    </Box>
  );
}

/**
 * Premium change cell: points in the signed tone (red/green, leg hue when
 * flat) with the percent in a smaller dimmer span. Both halves come from the
 * one `formatLegChange` label (`"−139.20 (−5.1%)"`, split at the `" ("`) so
 * the header can never again disagree with the cell.
 */
function legChangeCell(leg: NiftyStrike["ce"], legHue: string) {
  const change = formatLegChange(leg);
  const tone =
    change.points < 0
      ? palette.NEGATIVE
      : change.points > 0
        ? palette.POSITIVE
        : legHue;
  const sep = change.label.lastIndexOf(" (");
  const pointsText = sep >= 0 ? change.label.slice(0, sep) : change.label;
  const pctText = sep >= 0 ? change.label.slice(sep + 1) : "";
  return (
    <Box
      component="span"
      title={change.label}
      sx={{
        display: "block",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontFamily: palette.MONO,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Text size="xs" span fw={500} sx={{ color: tone }}>
        {pointsText}
      </Text>
      {pctText ? (
        <Text size="xs" span c="dimmed" style={{ fontSize: 10 }}>
          {" "}
          {pctText}
        </Text>
      ) : null}
    </Box>
  );
}

/** GEX regime line shown in LIVE mode. */
export function gexRegimeText(regime: string): string {
  if (regime === "long") return "Dealers LONG gamma — moves dampened";
  if (regime === "short") return "Dealers SHORT gamma — moves amplified";
  return "Flat";
}

/** Signed Cr/pt total, e.g. "+12.40 Cr/pt". */
export function formatGexTotal(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)} Cr/pt`;
}

/** Strike plus signed exposure, e.g. "25,700 (+5.20 Cr)". */
export function formatGexLevel(strike: number, netGex: number): string {
  return `${formatNumberIN(strike)} (${netGex >= 0 ? "+" : ""}${netGex.toFixed(2)} Cr)`;
}

/** OI-burst log height: one ~20px row per alert plus chrome, capped so the
    signals row stays compact — overflow scrolls inside the log. */
export function oiBurstLogHeight(count: number): number {
  return Math.min(22 + count * 20 + 18, 140);
}
/** Live updates arrive over the report WebSocket (the single live source) —
    there is no HTTP polling in live mode. The one-shot REST `load()` below
    only paints the first frame (and serves EOD mode). */
/** The socket has been down this long → show the stale badge, not an error. */
const STALE_AFTER_MS = 90_000;

/** Replay play cadence — one recorded minute per ~700 ms. */
const REPLAY_PLAY_MS = 700;

/**
 * Build the playhead-only replay from a meta response (t + spot per frame).
 * The frame bodies are fetched lazily by `fetchOptionsReplayFrame`, keyed by
 * minute, so the whole day never has to land in one payload.
 */
function replayFromMeta(meta: NiftyReplayMeta): NiftyReplay {
  return {
    date: meta.date,
    count: meta.frames.length,
    interval_sec: meta.interval_sec,
    gap_reasons: meta.gap_reasons,
    snapshots: meta.frames.map((f) => ({
      t: f.t,
      fetched_at: "",
      report: REPLAY_STUB_REPORT,
      sensex: null,
    })),
  };
}

/** Chart presets are re-exported from the memoised chart panel (single implementation). */

const SENSEX_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Raised when the Sensex request exceeds SENSEX_REQUEST_TIMEOUT_MS.
 *
 * Surfacing a timeout needs its own type: the timeout works by aborting the
 * request controller, and the caller ignores aborted requests (that is how a
 * superseding load and unmount are detected). Without this marker the timeout
 * was indistinguishable from a cancellation, so its message never reached the
 * UI and a failed refresh silently kept showing stale numbers.
 */
export class SensexTimeoutError extends Error {
  constructor() {
    super("Sensex data request timed out");
    this.name = "SensexTimeoutError";
  }
}

export async function fetchSensexWithTimeout(controller: AbortController): Promise<NiftySensex> {
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SENSEX_REQUEST_TIMEOUT_MS);
  try {
    return await fetchLiveSensex(controller.signal);
  } catch (error) {
    if (timedOut) throw new SensexTimeoutError();
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Closest strike in the chain to spot; null when there is no data. Tie → lower strike. */
export function findAtmStrike(strikes: NiftyStrike[], spot: number): number | null {
  if (!strikes || strikes.length === 0) return null;
  if (!Number.isFinite(spot)) return null;
  let best = strikes[0].strike;
  let bestDist = Math.abs(best - spot);
  for (let i = 1; i < strikes.length; i++) {
    const s = strikes[i].strike;
    const d = Math.abs(s - spot);
    if (d < bestDist || (d === bestDist && s < best)) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}


/** Fixed chain column widths — the sticky strike offset below derives from
 *  the three CE widths, so keep them in one place. Total (586) fits a 1440px
 *  panel with room to spare; every column keeps an explicit meta.align. */
const OI_CE_CHG_W = 110;
const OI_CE_OI_W = 88;
const OI_SIG_W = 64;
const OI_STRIKE_W = 92;
/** Left pin of the sticky strike column = the three CE tracks before it. */
const OI_STRIKE_STICKY_LEFT = OI_CE_CHG_W + OI_CE_OI_W + OI_SIG_W;
/** DESK hides the points+% `CE Chg` track, so the pin moves left by its width. */
const OI_STRIKE_STICKY_LEFT_COMPACT = OI_CE_OI_W + OI_SIG_W;

/** Optional per-render scale/anchor for the OI chain columns. All optional
 *  so `getNiftyOiColumns(atm)` keeps working (no bars/walls without scale). */
export interface NiftyOiColumnOpts {
  /** Max |CE ΔOI| over the visible rows — the 100% bar anchor. */
  maxCeOiChange?: number;
  /** Max |PE ΔOI| over the visible rows — the 100% bar anchor. */
  maxPeOiChange?: number;
  /** Spot for the `rowFlags` wall/ATM derivation. */
  spot?: number;
  /** Top walls (callers pass the top-1 each); flags come from `rowFlags`. */
  walls?: ChainWalls;
  /** DESK drops the two points+% premium-change tracks (5 columns); the
   *  default keeps all seven for RESEARCH. */
  showLegChange?: boolean;
}

export function getNiftyOiColumns(
  atmStrike: number | null,
  opts?: NiftyOiColumnOpts,
): ColumnDef<NiftyStrike>[] {
  const legChangeColumns: ColumnDef<NiftyStrike>[] = [
  {
    header: (
      <Box component="span" title="points (LTP − prev close)">
        CE Chg
      </Box>
    ),
    accessorKey: "ce.priceChange",
    accessorFn: (row) => formatLegChange(row.ce).points,
    size: OI_CE_CHG_W,
    meta: { align: "right" },
    cell: (info) => legChangeCell(info.row.original.ce, palette.TERM_CE),
  },
  ];
  const coreColumns: ColumnDef<NiftyStrike>[] = [
  {
    header: "CE OI Chg",
    accessorKey: "ce.oiChange",
    accessorFn: (row) => row.ce.oiChange,
    size: OI_CE_OI_W,
    meta: { align: "right" },
    cell: (info) => {
      const v = Number(info.getValue());
      return oiChangeBarCell(v, opts?.maxCeOiChange, palette.TERM_CE, "nifty-oi-bar-ce");
    },
  },
  {
    header: "CE Signal",
    accessorKey: "ce.sentiment",
    accessorFn: (row) => row.ce.sentiment,
    size: OI_SIG_W,
    meta: { align: "center" },
    cell: (info) => sentimentBadge(String(info.getValue() ?? ""), "ce"),
  },
  {
    header: "Strike",
    accessorKey: "strike",
    size: OI_STRIKE_W,
    meta: { align: "right" },
    cell: (info) => {
      const strike = Number(info.getValue());
      const isAtm = atmStrike !== null && strike === atmStrike;
      // Wall/ATM flags from the shared helper when spot is known; otherwise
      // fall back to the raw wall lists (factory called without opts).
      const walls = opts?.walls ?? {};
      const flags =
        opts?.spot != null && Number.isFinite(opts.spot)
          ? rowFlags(info.row.original, opts.spot as number, walls)
          : null;
      const isCW = flags
        ? flags.callWall
        : (walls.calls ?? []).some((w) => w.strike === strike);
      const isPW = flags
        ? flags.putWall
        : (walls.puts ?? []).some((w) => w.strike === strike);
      const spot = opts?.spot ?? 0;
      return (
        <Box
          component="span"
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "4px",
            overflow: "hidden",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {isCW ? wallTag(strike, spot, true, palette.TERM_CE) : null}
          {isPW ? wallTag(strike, spot, false, palette.TERM_PE) : null}
          {/* No inline "ATM" capsule: at the chain's real width the number
              plus a capsule overflows the strike column and clips the
              numeral. The anchor is the gold numeral + gold row band, the
              same language the delta ladder uses. */}
          <Text
            size="xs"
            span
            fw={700}
            c={isAtm ? palette.TERM_FLIP : undefined}
            data-testid={isAtm ? "nifty-strike-atm-badge" : undefined}
            title={isAtm ? "ATM strike" : undefined}
          >
            {formatNumberIN(strike)}
          </Text>
        </Box>
      );
    },
  },
  {
    header: "PE Signal",
    accessorKey: "pe.sentiment",
    accessorFn: (row) => row.pe.sentiment,
    size: OI_SIG_W,
    meta: { align: "center" },
    cell: (info) => sentimentBadge(String(info.getValue() ?? ""), "pe"),
  },
  {
    header: "PE OI Chg",
    accessorKey: "pe.oiChange",
    accessorFn: (row) => row.pe.oiChange,
    size: OI_CE_OI_W,
    meta: { align: "right" },
    cell: (info) => {
      const v = Number(info.getValue());
      return oiChangeBarCell(v, opts?.maxPeOiChange, palette.TERM_PE, "nifty-oi-bar-pe");
    },
  },
  ];
  if (opts?.showLegChange === false) return coreColumns;
  const peChg: ColumnDef<NiftyStrike> = {
    header: (
      <Box component="span" title="points (LTP − prev close)">
        PE Chg
      </Box>
    ),
    accessorKey: "pe.priceChange",
    accessorFn: (row) => formatLegChange(row.pe).points,
    size: OI_CE_CHG_W,
    meta: { align: "right" },
    cell: (info) => legChangeCell(info.row.original.pe, palette.TERM_PE),
  };
  return [...legChangeColumns, ...coreColumns, peChg];
}


/** Report underlyings the toolbar can switch between. NIFTY keeps its
 *  recorded tape/replay; the others use the generic options-live endpoint. */
type ReportSymbol = "NIFTY" | "SENSEX" | "RELIANCE";
const SYMBOL_SELECT_DATA: { value: ReportSymbol; label: string }[] = [
  { value: "NIFTY", label: "NIFTY" },
  { value: "SENSEX", label: "SENSEX" },
  { value: "RELIANCE", label: "RELIANCE" },
];

/** Module-level toggle data — one stable array identity for every render, so
 *  memoised children never see a new `data` prop. */
const INDEX_TOGGLE_DATA: { value: string; label: string }[] = [
  { value: "nifty", label: "NIFTY" },
  { value: "sensex", label: "SENSEX" },
];
const MODE_TOGGLE_DATA: { value: string; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "eod", label: "EOD" },
];
const VIEW_TOGGLE_DATA: { value: string; label: string }[] = [
  { value: "chart", label: "Chart" },
  { value: "depth", label: "Depth" },
];
const DESK_TOGGLE_DATA: { value: string; label: string }[] = [
  { value: "desk", label: "DESK" },
  { value: "research", label: "RESEARCH" },
];

/** localStorage key for the desk/research mode toggle. */
export const NIFTY_DESK_MODE_KEY = "nifty.deskMode";

/** Hoisted `sx` objects — inline literals here would defeat `React.memo` on
 *  the receiving child (e.g. `NiftyUnusualVolume sx={{ minWidth: 0 }}`). */
const EXPIRY_SELECT_SX = { width: 120, flex: "0 0 auto", minWidth: 0 };
const SYMBOL_SELECT_SX = { width: 130, flex: "0 0 auto", minWidth: 0 };
const UNUSUAL_VOLUME_SX = { minWidth: 0 };

/** Hoisted `AnimatedValue` formatters — inline arrows would be new closures. */
const formatInt = (v: number): string => formatNumberIN(v);
const format2dp = (v: number): string => v.toFixed(2);
const formatGexTotalValue = (v: number): string => formatGexTotal(v);

/** Live Spot stat. Subscribes to the tick store itself so the ~1/second tick
 *  repaints only this value — the panel never re-renders on a tick. */
const NiftySpotValue = memo(function NiftySpotValue({
  live,
  fallback,
}: {
  /** Subscribe to the live tick store (off for EOD/replay and non-NIFTY). */
  live: boolean;
  fallback: number;
}) {
  const tick = useNiftySpotTick();
  return <AnimatedValue value={(live ? tick?.spot : undefined) ?? fallback} format={formatInt} />;
});

/** OI-chain panel skin — hoisted so the memoised chain never rebuilds it. */
const OI_CHAIN_PANEL_SX = {
  minWidth: 0,
  minHeight: 0,
  // Terminal surface like the tape panel — the table overrides keep every
  // inner layer black/transparent.
  background: palette.TERM_BG,
  borderColor: palette.TERM_BORDER,
  // The chain must not size the row: without this the table's natural height
  // (all ~30 legs) sets the chart row to ~900px and leaves the chart floating
  // in a void. `size` containment makes the panel take the row height from the
  // chart instead, and the table scrolls inside it. Desktop only — on xs the
  // grid is one column and the panel needs its own height.
  contain: { xs: "none", lg: "size" },
} as const;

/** The chain fills whatever height the chart row gives it and scrolls
 *  internally — no fixed 180px cap, so XL charts show ~30 strikes. */
const OI_CHAIN_WRAP_SX = {
  display: "flex",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
} as const;

/** `minWidth: 0` overrides the shared 640px floor, which forced a sideways
 *  scrollbar and cut the PE columns off at the panel edge. */
const OI_CHAIN_TABLE_STYLE: CSSProperties = { minWidth: 0 };

const OI_CHAIN_EXPAND_SX = {
  minWidth: 22,
  px: "4px",
  lineHeight: 1,
  fontSize: 12,
} as const;

interface NiftyOiChainProps {
  /** Already windowed to ATM ±750 — identity is stable across a spot tick. */
  strikes: NiftyStrike[];
  columns: ColumnDef<NiftyStrike>[];
  getRowStyle: (row: NiftyStrike) => CSSProperties | undefined;
  getRowTestId: (row: NiftyStrike) => string | undefined;
  panelTestId: string;
  tableTestId: string;
  wrapTestId: string;
  wrapRef: RefObject<HTMLDivElement | null>;
  /** Inline copy gets the expand button; the modal copy omits it. */
  onExpand?: () => void;
}

/**
 * The ~40-row × 7-cell option chain, isolated behind `memo`.
 *
 * `report` — and therefore `strikes`, `columns` and the row callbacks — keeps
 * its identity between report frames, and the ~1/second spot tick lives in a
 * leaf-only store, so the chain table is not reconciled per tick.
 */
const NiftyOiChain = memo(function NiftyOiChain({
  strikes,
  columns,
  getRowStyle,
  getRowTestId,
  panelTestId,
  tableTestId,
  wrapTestId,
  wrapRef,
  onExpand,
}: NiftyOiChainProps) {
  return (
    <CompactPanel
      flush
      scrollable
      title="Option-chain OI (±750 ATM)"
      testId={panelTestId}
      action={
        onExpand ? (
          <Button
            data-testid="nifty-oi-expand"
            size="sm"
            variant="subtle"
            aria-label="Expand the option chain"
            title="Expand the option chain"
            onClick={onExpand}
            sx={OI_CHAIN_EXPAND_SX}
          >
            ⤢
          </Button>
        ) : undefined
      }
      sx={OI_CHAIN_PANEL_SX}
    >
      <Box ref={wrapRef} data-testid={wrapTestId} sx={OI_CHAIN_WRAP_SX}>
        <TanStackTable<NiftyStrike>
          data={strikes}
          columns={columns}
          dataTestId={tableTestId}
          emptyMessage="No strikes for this expiry"
          fillContainer
          style={OI_CHAIN_TABLE_STYLE}
          dense
          getRowStyle={getRowStyle}
          getRowTestId={getRowTestId}
        />
      </Box>
    </CompactPanel>
  );
});

export function NiftyReportPanel({ onOpenSymbol }: NiftyReportPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState<"nifty" | "sensex">("nifty");
  /** Underlying shown in the panel. NIFTY keeps the recorded tape/replay;
   *  SENSEX/RELIANCE load the generic options-live report (no tape history). */
  const [symbol, setSymbol] = useState<ReportSymbol>("NIFTY");
  const [mode, setMode] = useState<NiftyReportMode>("live");
  const [expiry, setExpiry] = useState<string>("nearest");
  const [expiryOptions, setExpiryOptions] = useState<string[]>([]);
  const [date, setDate] = useState<string>("");
  /** Recorded replay days for a non-NIFTY underlying (empty = no history). */
  const [historyDates, setHistoryDates] = useState<string[]>([]);
  // Gate the first fetch until we know whether to open on Live or on the
  // newest recorded day (the bootstrap effect lives just above `load`).
  const [booted, setBooted] = useState(false);
  const wasOpenAtMount = useRef(isDerivativesOpenIst());
  const [report, setReport] = useState<NiftyReport | null>(null);
  const [sensex, setSensex] = useState<NiftySensex | null>(null);
  const [sensexLoading, setSensexLoading] = useState(false);
  const [sensexError, setSensexError] = useState<string | null>(null);
  const [tape, setTape] = useState<NiftyTape | null>(null);
  const [wallsOpen, setWallsOpen] = useState(false);
  const [moversOpen, setMoversOpen] = useState(false);
  const openMovers = useCallback(() => setMoversOpen(true), []);
  const closeMovers = useCallback(() => setMoversOpen(false), []);
  // In-app CW/PW alerts: a wall move is a level change, not tape noise.
  // The rules (seed on context change, live-only, dedupe by side+strike) live
  // in the pure `niftyWallMoves` reducer so they are unit-tested.
  const wallMoveStateRef = useRef(createWallMoveState());
  /** Backend-detected bursts; null = endpoint unavailable → derive locally. */
  const [bursts, setBursts] = useState<OiBurst[] | null>(null);
  /** Raw open paper book. Null = not loaded yet; the P&L attribution maps it
   *  to NIFTY option legs and the POSITIONS drawer lists every open leg. */
  const [paperPositions, setPaperPositions] = useState<PaperPosition[] | null>(null);
  /** Reload the open book (drawer refresh on open + every 30s). */
  const refreshPaperPositions = useCallback(async () => {
    try {
      const list = await fetchPositions();
      setPaperPositions(list ?? []);
    } catch {
      // Keep the last-good book on a failed refresh; never blank the drawer.
      setPaperPositions((prev) => prev ?? []);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    fetchPositions()
      .then((list) => {
        if (alive) setPaperPositions(list ?? []);
      })
      .catch(() => {
        if (alive) setPaperPositions((prev) => prev ?? []);
      });
    return () => {
      alive = false;
    };
  }, []);
  /** Attributable option legs for the RESEARCH P&L panel. */
  const pnlPositions = useMemo<NiftyPnlPosition[] | null>(
    () => (paperPositions ? paperPositions.flatMap(paperToPnlLeg) : null),
    [paperPositions],
  );
  const [view, setView] = useState<"chart" | "depth">("chart");
  // Desk/research shell: desk (default) keeps the decision surface —
  // header, banners, PLAN one-liner, chart, alerts, OI chain — while the
  // slower research panels mount only in research mode. Persisted.
  const [deskMode, setDeskMode] = useState<"desk" | "research">(() => {
    try {
      return window.localStorage.getItem(NIFTY_DESK_MODE_KEY) === "research"
        ? "research"
        : "desk";
    } catch {
      return "desk";
    }
  });
  const isDesk = deskMode === "desk";
  const toggleDeskMode = useCallback(
    () => setDeskMode((v) => (v === "desk" ? "research" : "desk")),
    [],
  );
  const handleDeskChange = useCallback(
    (v: string) => setDeskMode(v === "research" ? "research" : "desk"),
    [],
  );
  // Desk modals: plan reasons, chart fullscreen, IV skew, GEX, visuals stub,
  // and the OI-burst alerts log (DESK compact bar opens the full log here).
  const [planOpen, setPlanOpen] = useState(false);
  const [deskDockTab, setDeskDockTab] = useState<DeskDockKey | null>(null);
  const [sideTab, setSideTab] = useState<"chain" | "heatmap">(() => {
    try {
      return window.localStorage.getItem("nifty.sideTab") === "heatmap" ? "heatmap" : "chain";
    } catch {
      return "chain";
    }
  });
  const [chartFull, setChartFull] = useState(false);
  const [ivOpen, setIvOpen] = useState(false);
  const [gexOpen, setGexOpen] = useState(false);
  const [gammaOpen, setGammaOpen] = useState(false);
  const [visualsOpen, setVisualsOpen] = useState(false);
  // Chart timeframe shared by the inline + fullscreen chart instances so the
  // 1/5/15 hotkeys move both and no instance refetches (data flows via props).
  const [chartTf, setChartTf] = useState<ChartTimeframe>("1m");
  const handleChartTf = useCallback((tf: DeskChartTimeframe) => setChartTf(tf), []);
  // The inline chart owns its S/M/L/XL state; the parent mirrors it so a DESK
  // row can size itself to the selected preset (fill is capped at 300px).
  const [chartSize, setChartSize] = useState<ChartSize>("fill");
  const handleChartSize = useCallback((size: ChartSize) => setChartSize(size), []);
  /** DESK chart row height: the fill cap (or the explicit preset) + the card
   *  chrome. Everything else goes to the FLOW band below, so the page never
   *  leaves a void under a short chart. */
  const chartRowHeight =
    chartSize === "fill" ? FILL_MAX_HEIGHT + CHART_ROW_CHROME : CHART_HEIGHTS[chartSize] + CHART_ROW_CHROME;
  const openPlanReasons = useCallback(() => setPlanOpen(true), []);
  const openAlertsDock = useCallback(() => setDeskDockTab("alerts"), []);
  useEffect(() => {
    try {
      window.localStorage.setItem("nifty.sideTab", sideTab);
    } catch {
      /* localStorage can be blocked */
    }
  }, [sideTab]);

  const openChartFull = useCallback(() => setChartFull(true), []);
  const openVisuals = useCallback(() => setVisualsOpen(true), []);
  const closeTopModal = useCallback(() => {
    if (visualsOpen) setVisualsOpen(false);
    else if (gexOpen) setGexOpen(false);
    else if (gammaOpen) setGammaOpen(false);
    else if (ivOpen) setIvOpen(false);
    else if (chartFull) setChartFull(false);
    else if (planOpen) setPlanOpen(false);
    else if (moversOpen) setMoversOpen(false);
  }, [visualsOpen, gexOpen, gammaOpen, ivOpen, chartFull, planOpen, moversOpen]);
  useDeskHotkeys({
    onToggleDesk: toggleDeskMode,
    onChartFullscreen: openChartFull,
    onExpandHovered: openPlanReasons,
    onVisualsGrid: openVisuals,
    onClose: closeTopModal,
    onTimeframe: handleChartTf,
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(NIFTY_DESK_MODE_KEY, deskMode);
    } catch {
      /* private mode: the toggle still works for the session */
    }
  }, [deskMode]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshotting, setSnapshotting] = useState<boolean>(false);
  // Live bookkeeping: last-good timestamp + wall-clock for the staleness
  // display. Live updates arrive via WS; Refresh re-runs the one-shot load.
  const [updatedAtMs, setUpdatedAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  // When the report socket dropped (null while connected / not live).
  const [wsDownSinceMs, setWsDownSinceMs] = useState<number | null>(null);
  // Overlap guard: skip a one-shot reload while a fetch is still in flight.
  const loadingRef = useRef<boolean>(false);
  // Invalidate and cancel requests when the report context changes. Without
  // this, a slow Live response can overwrite a newly selected EOD/expiry
  // context after the new request was skipped by the overlap guard.
  const requestIdRef = useRef<number>(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const sensexControllerRef = useRef<AbortController | null>(null);
  const [streamed, setStreamed] = useState<NiftyBurst[]>([]);
  // EOD replay: the date's recorded minute frames plus the playhead index.
  // Null (or an empty list) = no replay for that day → the single EOD
  // snapshot stays on screen and the replay bar stays hidden.
  const [replay, setReplay] = useState<NiftyReplay | null>(null);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  // Throttle-with-catch-up: the walls endpoint takes 100-400 ms, so aborting
  // the request on every scrub tick starved the card while the chart/heatmap
  // (already in memory) moved. This keeps at most one request in flight and
  // chases the newest playhead when it settles.
  const { walls } = useReplayWalls({
    enabled: mode === "live" ? Boolean(report) : Boolean(replay),
    symbol,
    date: mode === "eod" ? date || undefined : undefined,
    at: mode === "eod" && replay ? replay.snapshots[replayIndex]?.t : undefined,
    includeMap: wallsOpen,
    live: mode === "live",
    liveTick: mode === "live" ? report : null,
    throttleMs: mode === "live" ? 4_000 : 150,
  });
  useEffect(() => {
    // Replay frames only exist in EOD (non-live), where the reducer always
    // seeds — so the frame index is deliberately not part of this key.
    const context = `${symbol}|${expiry}|${mode}|${date}`;
    const { moves, state } = nextWallMoveState(
      wallMoveStateRef.current,
      context,
      walls?.calls?.[0]?.strike ?? null,
      walls?.puts?.[0]?.strike ?? null,
      mode === "live",
    );
    wallMoveStateRef.current = state;
    for (const move of moves) flashAlertTitle(wallMoveTitle(move));
  }, [walls, symbol, expiry, mode, date]);
  // EOD replay frames store the chain per minute but not the day's 1m candles
  // (the snapshot does). Keep the snapshot's series and merge it into a frame
  // that arrives without intraday/candles, otherwise the SENSEX chart says
  // "No intraday candles" even though the snapshot has 747 bars.
  const baseIntradayRef = useRef<NonNullable<NiftyReport["intraday"]>>([]);
  const baseCandlesRef = useRef<NonNullable<NiftyReport["candles"]>>([]);
  const withBaseCandles = useCallback((next: NiftyReport): NiftyReport => {
    const hasIntraday = (next.intraday?.length ?? 0) > 0;
    const hasCandles = (next.candles?.length ?? 0) > 0;
    if (hasIntraday || hasCandles) return next;
    if (baseIntradayRef.current.length === 0 && baseCandlesRef.current.length === 0) {
      return next;
    }
    return {
      ...next,
      ...(baseIntradayRef.current.length > 0 ? { intraday: baseIntradayRef.current } : {}),
      ...(baseCandlesRef.current.length > 0 ? { candles: baseCandlesRef.current } : {}),
    };
  }, []);
  // Scrub coalescing: slider input can fire far faster than the ~5,668-node
  // panel tree can repaint. Only the newest frame is kept; one rAF applies
  // it, so stale frames never land. The concrete frame (not the index) is
  // stored so a context switch cannot redirect it onto a new replay.
  const scrubRafRef = useRef<number | null>(null);
  /** Lazy replay frames: minute ISO → normalized report (max 8, FIFO). */
  const replayFrameCacheRef = useRef<Map<string, NiftyReport>>(new Map());
  /** In-flight lazy frames keyed `date|minute` — one request per minute even
   *  when a scrub lands on a frame that is already loading. */
  const replayFrameInflightRef = useRef<Map<string, Promise<NiftyReplayFrame | null>>>(
    new Map(),
  );
  /** Pending idle prefetch of the NEXT minute (one frame ahead, never more). */
  const replayPrefetchCancelRef = useRef<(() => void) | null>(null);
  const replayFrameReqRef = useRef(0);
  const pendingScrubRef = useRef<{ report: NiftyReport; sensex: NiftySensex | null } | null>(null);

  /** Insert into the 8-entry FIFO frame cache (oldest minute evicted). */
  const cacheReplayFrame = useCallback((minute: string, report: NiftyReport) => {
    const cache = replayFrameCacheRef.current;
    cache.set(minute, report);
    if (cache.size > 8) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
  }, []);

  /**
   * Fetch one lazy replay frame, deduped by `date|minute`. A scrub back onto a
   * minute that is already loading joins that request instead of firing a
   * second one, and the result lands in the shared cache either way.
   */
  const loadReplayFrame = useCallback(
    (dateKey: string, minute: string): Promise<NiftyReplayFrame | null> => {
      const inflightKey = `${symbol}|${dateKey}|${minute}`;
      const pending = replayFrameInflightRef.current.get(inflightKey);
      if (pending) return pending;
      const request = (symbol === "NIFTY"
        ? fetchNiftyReplayFrame(dateKey, minute)
        : fetchOptionsReplayFrame(symbol, dateKey, minute)
      )
        .then((loaded) => {
          if (loaded) cacheReplayFrame(minute, loaded.report);
          return loaded;
        })
        .catch(() => null);
      replayFrameInflightRef.current.set(inflightKey, request);
      void request.finally(() => {
        if (replayFrameInflightRef.current.get(inflightKey) === request) {
          replayFrameInflightRef.current.delete(inflightKey);
        }
      });
      return request;
    },
    [cacheReplayFrame, symbol],
  );

  const cancelReplayPrefetch = useCallback(() => {
    replayPrefetchCancelRef.current?.();
    replayPrefetchCancelRef.current = null;
  }, []);

  /**
   * Warm exactly ONE minute ahead once the current frame has landed. Playback
   * paints a stub until the minute is in memory, so the next fetch is made
   * while the browser is idle; the prefetch never schedules another one.
   */
  const prefetchNextReplayFrame = useCallback(
    (dateKey: string, next: NiftyReplayFrame | undefined) => {
      cancelReplayPrefetch();
      // Whole-day payloads (older backend) are already in memory.
      if (!next || !next.t || next.report !== REPLAY_STUB_REPORT) return;
      if (replayFrameCacheRef.current.has(next.t)) return;
      const minute = next.t;
      const run = () => {
        replayPrefetchCancelRef.current = null;
        void loadReplayFrame(dateKey, minute);
      };
      const idleWindow = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
      };
      if (typeof idleWindow.requestIdleCallback === "function") {
        const handle = idleWindow.requestIdleCallback(run, { timeout: 1_000 });
        replayPrefetchCancelRef.current = () => idleWindow.cancelIdleCallback?.(handle);
        return;
      }
      // Safari/older engines: a short timer is the closest equivalent.
      const handle = window.setTimeout(run, 150);
      replayPrefetchCancelRef.current = () => window.clearTimeout(handle);
    },
    [cancelReplayPrefetch, loadReplayFrame],
  );

  // How complete is this day's recording? The replay only has the minutes the
  // recorder captured; playback jumps the holes in one tick, which reads as a
  // stutter. Show the coverage instead of leaving it implicit.
  const replayCoverage = useMemo(
    () => (replay ? computeReplayCoverage(replay.snapshots) : null),
    [replay],
  );
  // Why the day has holes — the recorder's own skip reasons (gap journal).
  // Absent for days recorded before the journal existed, so this can be empty.
  // Memoised on `replay` identity so the memoised replay bar keeps stable props.
  const replayReasons: ReplayReason[] = useMemo(
    () => toReplayReasons(replay?.gap_reasons),
    [replay],
  );

  // In-session holes only — the lead-in and tail are the recorder starting
  // late / stopping early, not missed ticks. Memoised on `replay` so the
  // replay bar's segment strip is never rebuilt by unrelated renders.
  const replayHoles = useMemo(
    () => countReplayHoles(buildReplaySegments(replay, replayCoverage)),
    [replay, replayCoverage],
  );

  // Exchange session gate (from the `market` block). When closed, the
  // snapshot is labelled "Market closed" instead of "live".
  const marketClosed = report?.market?.is_open === false;
  const contextKey = mode === "eod" ? `eod:${date}` : `live:${expiry}`;
  const prevContext = useRef(contextKey);
  /** True when EOD was chosen BY the app (close/weekend), not by the user.
   *  Only then may the app switch itself back to Live at the next open. */
  const autoEodRef = useRef(false);
  /** Recorded days for whichever underlying is on screen (NIFTY or generic). */
  const replayDatesForSymbol = useCallback(
    (signal?: AbortSignal) =>
      symbol === "NIFTY"
        ? fetchNiftyReplayDates(signal)
        : fetchOptionsReplayDates(symbol, signal),
    [symbol],
  );

  // Closed-market default: open on the newest day that has a recording instead
  // of an empty Live screen. The dates endpoint only lists days with
  // snapshots, so a holiday/weekend resolves to the last real session.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (!isDerivativesOpenIst()) {
          const dates = await fetchNiftyReplayDates();
          if (alive && dates.length > 0) {
            autoEodRef.current = true;
            setMode("eod");
            setDate(dates[0]);
          }
        }
      } catch {
        // A failed/absent dates lookup must never block the first load — the
        // panel falls back to Live.
      } finally {
        if (alive) setBooted(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The tab can stay open across the 15:30 close. Switch once, at the close,
  // to that day's EOD replay; a later manual Live choice is respected.
  useEffect(() => {
    if (!wasOpenAtMount.current) return;
    const controller = new AbortController();
    const id = window.setInterval(() => {
      if (isDerivativesOpenIst()) return;
      wasOpenAtMount.current = false;
      void replayDatesForSymbol(controller.signal).then((dates) => {
        if (dates.length > 0) {
          autoEodRef.current = true;
          setMode("eod");
          setDate(dates[0]);
        }
      });
    }, 30_000);
    return () => {
      window.clearInterval(id);
      controller.abort();
    };
  }, [replayDatesForSymbol]);

  // Generic underlying switched while the market is closed: seed the same
  // "open on the newest recorded day" default NIFTY gets at mount, once per
  // symbol, so a manual Live choice afterwards is respected.
  const genericAutoEodRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (symbol === "NIFTY" || mode !== "live") return;
    if (historyDates.length === 0 || isDerivativesOpenIst()) return;
    if (genericAutoEodRef.current.has(symbol)) return;
    genericAutoEodRef.current.add(symbol);
    autoEodRef.current = true;
    setMode("eod");
    setDate(historyDates[0]);
  }, [symbol, mode, historyDates]);

  // ...and switch back to Live when the next session opens — but ONLY if the
  // EOD switch was automatic. A user-picked EOD stays put.
  usePolling(
    () => {
      if (!autoEodRef.current) return;
      if (!isDerivativesOpenIst()) return;
      autoEodRef.current = false;
      setMode("live");
      setDate("");
    },
    30_000,
    { skipIfRunning: false },
  );

  // Generic underlyings (SENSEX/RELIANCE) have no WebSocket — poll the
  // generic report + tape every ~15 s in live mode. Each poll uses an
  // AbortController with a 15 s timeout so a hung/404 request cannot
  // leave `loadingRef` true and freeze all future loads.
  useEffect(() => {
    if (symbol === "NIFTY" || mode !== "live") return;
    let alive = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const runPoll = async () => {
      if (!alive) return;
      // Reuse the existing load() but with a dedicated controller + timeout
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const controller = new AbortController();
      requestControllerRef.current = controller;

      // 15 s timeout — if the request hangs, abort it and reset loadingRef
      const timeoutId = window.setTimeout(() => {
        controller.abort();
      }, 15_000);

      try {
        loadingRef.current = true;
        setLoading(true);
        setError(null);

        const tapeDate = undefined; // live mode

        const [optionsReport, tapeData, burstData] = await Promise.all([
          fetchOptionsLive(
            symbol,
            expiry === "nearest" ? undefined : expiry,
            controller.signal,
          ),
          fetchOptionsTape(symbol, tapeDate, controller.signal),
          fetchOptionsBursts(symbol, tapeDate, controller.signal),
        ]);

        if (!alive || requestId !== requestIdRef.current || controller.signal.aborted) return;

        const nextReport = optionsReport;
        if (!nextReport) {
          throw new Error(`No ${symbol} option-chain report available.`);
        }

        baseIntradayRef.current = nextReport.intraday ?? [];
        baseCandlesRef.current = nextReport.candles ?? [];
        setReport(nextReport);
        if (tapeData) setTape(tapeData);
        setBursts(burstData as OiBurst[]);
        setSensex(null);
        setSensexError(null);
        setSensexLoading(false);

        const now = Date.now();
        setUpdatedAtMs(now);
        setNowMs(now);
      } catch (e) {
        if (!alive || requestId !== requestIdRef.current || controller.signal.aborted) return;
        setNowMs(Date.now());
        setError(e instanceof Error ? e.message : `Failed to load ${symbol} report`);
      } finally {
        window.clearTimeout(timeoutId);
        if (requestId === requestIdRef.current) {
          requestControllerRef.current = null;
          loadingRef.current = false;
          setLoading(false);
        }
      }

      if (alive) {
        pollTimer = window.setTimeout(runPoll, 15_000);
      }
    };

    // Initial poll (load() already ran on mount/context change via the
    // booted effect; this schedules the next one)
    pollTimer = window.setTimeout(runPoll, 15_000);

    return () => {
      alive = false;
      if (pollTimer) window.clearTimeout(pollTimer);
      // Clean up any in-flight request
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      loadingRef.current = false;
      setLoading(false);
    };
  }, [symbol, mode, expiry, booted]);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      // Non-NIFTY underlyings read their OWN recorded history from the generic
      // `/api/reports/options/{symbol}/…` namespace. The NIFTY recorder paths
      // (tape/bursts/replay/report) are never called for another symbol, so a
      // switch can never inherit NIFTY's tape or overwrite its recording.
      if (symbol !== "NIFTY") {
        const tapeDate = mode === "eod" ? date || undefined : undefined;
        const genericReplay = mode === "eod" && date
          ? fetchOptionsReplayMeta(symbol, date, controller.signal)
              .then((meta): Promise<NiftyReplay | null> | NiftyReplay | null =>
                meta && meta.frames.length > 0
                  ? replayFromMeta(meta)
                  : fetchOptionsReplay(symbol, date, controller.signal),
              )
              .catch(() => null)
          : Promise.resolve(null);
        const [optionsReport, tapeData, burstData, replayData] = await Promise.all([
          mode === "live"
            ? fetchOptionsLive(
                symbol,
                expiry === "nearest" ? undefined : expiry,
                controller.signal,
              )
            : fetchOptionsSnapshot(symbol, date, controller.signal),
          // Tape/burst failures stay non-fatal: keep the last-good blocks.
          fetchOptionsTape(symbol, tapeDate, controller.signal),
          fetchOptionsBursts(symbol, tapeDate, controller.signal),
          genericReplay,
        ]);
        if (requestId !== requestIdRef.current || controller.signal.aborted) return;
        // EOD fallback: a day with frames but no stored snapshot still paints
        // its first frame rather than an empty screen.
        const firstFrame = replayData?.snapshots[0] ?? null;
        const nextReport =
          optionsReport ??
          (firstFrame && firstFrame.report !== REPLAY_STUB_REPORT
            ? firstFrame.report
            : null);
        if (!nextReport) {
          throw new Error(
            mode === "eod"
              ? `No ${symbol} snapshot recorded for ${date}.`
              : `No ${symbol} option-chain report available.`,
          );
        }
        baseIntradayRef.current = nextReport.intraday ?? [];
        baseCandlesRef.current = nextReport.candles ?? [];
        setReport(nextReport);
        if (tapeData) setTape(tapeData);
        setBursts(burstData as OiBurst[]);
        setReplay(replayData && replayData.snapshots.length > 0 ? replayData : null);
        setReplayIndex(0);
        setReplayPlaying(false);
        setSensex(null);
        setSensexError(null);
        setSensexLoading(false);
        const now = Date.now();
        setUpdatedAtMs(now);
        setNowMs(now);
        // The fast payload has `intraday: []`. Candles are the slow optional
        // path (~20 s cold, cached ~120 s), so fetch them ONCE in the
        // background and merge when they land — the chain never waits on them
        // and no poll loop ever requests them.
        if (
          mode === "live" &&
          (!nextReport.intraday || nextReport.intraday.length === 0)
        ) {
          void fetchOptionsLiveCandles(symbol, undefined, controller.signal)
            .then((withCandles) => {
              if (requestId !== requestIdRef.current) return;
              const intraday = withCandles.intraday;
              if (!intraday || intraday.length === 0) return;
              setReport((prev) =>
                prev
                  ? {
                      ...prev,
                      intraday,
                      // The fast chain-only payload carries the flat-spot OHLC
                      // fallback; the candle response has the real session OHLC.
                      ...(withCandles.ohlc ? { ohlc: withCandles.ohlc } : {}),
                      ...(withCandles.emas ? { emas: withCandles.emas } : {}),
                      // Candle-derived verdicts: the fast payload computed
                      // them from an empty intraday cache on a cold start.
                      ...(withCandles.control ? { control: withCandles.control } : {}),
                      ...(withCandles.regime ? { regime: withCandles.regime } : {}),
                      ...(withCandles.strength ? { strength: withCandles.strength } : {}),
                    }
                  : prev,
              );
            })
            .catch(() => undefined);
        }
        return;
      }
      // EOD: fetch the recorded frames BEFORE painting the REST snapshot. The
      // snapshot is the 15:30 close; painting it first made a 09:30 replay
      // flash the closing chain for a frame before the first frame landed.
      const replayPromise =
        mode === "eod" && date
          ? fetchNiftyReplayMeta(date, controller.signal)
              .then((meta): Promise<NiftyReplay | null> | NiftyReplay | null =>
                meta && meta.frames.length > 0
                  ? replayFromMeta(meta)
                  : fetchNiftyReplay(date, controller.signal).catch(() => null),
              )
              .catch(() => null)
          : Promise.resolve(null);
      const [data, tapeData, burstData, replayData] = await Promise.all([
        mode === "live"
          ? fetchLiveNifty(expiry === "nearest" ? undefined : expiry, controller.signal)
          : fetchNiftyByDate(date, controller.signal),
        // Tape failures stay non-fatal: keep the last-good tape on screen.
        fetchNiftyTape(
          mode === "eod" ? date || undefined : undefined,
          controller.signal,
        ).catch(() => null),
        // Bursts are backend-derived (survive tab close); never fatal.
        fetchNiftyBursts(
          mode === "eod" ? date || undefined : undefined,
          controller.signal,
        ),
        replayPromise,
      ]);
      if (requestId !== requestIdRef.current) return;
      const firstReplayFrame = replayData?.snapshots[0] ?? null;
      const nextNiftyReport =
        firstReplayFrame && firstReplayFrame.report !== REPLAY_STUB_REPORT
          ? firstReplayFrame.report
          : data;
      // The replay frames are chain-only. Keep the REST snapshot's 1m series
      // (the EOD `data` has it; the first frame does not) as the chart base.
      baseIntradayRef.current =
        (data.intraday?.length ?? 0) > 0
          ? data.intraday
          : nextNiftyReport.intraday ?? [];
      baseCandlesRef.current =
        (data.candles?.length ?? 0) > 0
          ? data.candles
          : nextNiftyReport.candles ?? [];
      setReport(nextNiftyReport);
      if (mode === "live") {
        // Sensex is optional context. Load it after Nifty succeeds so a slow
        // BSE request can never hold the main Nifty report in loading state.
        sensexControllerRef.current?.abort();
        const sensexController = new AbortController();
        sensexControllerRef.current = sensexController;
        setSensexLoading(true);
        setSensexError(null);
        void fetchSensexWithTimeout(sensexController)
          .then((sensexData) => {
            if (requestId === requestIdRef.current && !sensexController.signal.aborted) {
              setSensex(sensexData);
            }
          })
          .catch((sensexFetchError) => {
            const timedOut = sensexFetchError instanceof SensexTimeoutError;
            // Ignore superseded loads (requestId moved on) and unmounts (the
            // controller was aborted). A timeout aborts the controller too, so
            // it must be excluded here or its message is never surfaced.
            if (requestId !== requestIdRef.current) return;
            if (sensexController.signal.aborted && !timedOut) return;
            setSensex(null);
            setSensexError(
              sensexFetchError instanceof Error ? sensexFetchError.message : "Sensex data unavailable",
            );
          })
          .finally(() => {
            if (requestId === requestIdRef.current) setSensexLoading(false);
          });
      } else {
        sensexControllerRef.current?.abort();
        setSensex(null);
        setSensexLoading(false);
        setSensexError(null);
      }
      if (mode === "eod" && date) {
        // EOD replay state travels with the already-fetched frames; absence
        // (404 / empty) is not an error — the REST snapshot stays on screen.
        if (replayData && replayData.snapshots.length > 0) {
          setReplay(replayData);
          setReplayIndex(0);
          setReplayPlaying(false);
          setSensex(null);
        } else {
          setReplay(null);
          setReplayIndex(0);
          setReplayPlaying(false);
        }
      }
      if (tapeData) setTape(tapeData);
      setBursts(burstData as OiBurst[]);
      const now = Date.now();
      setUpdatedAtMs(now);
      setNowMs(now);
    } catch (e) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      // Keep the last-good report on screen; the full error alert only
      // renders when there is no cached data (see below).
      setNowMs(Date.now());
      setError(e instanceof Error ? e.message : "Failed to load Nifty report");
    } finally {
      if (requestId === requestIdRef.current) {
        requestControllerRef.current = null;
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [mode, expiry, date, symbol]);

  // Expiries come from the underlying's OWN listing: NIFTY keeps its recorded
  // weekly list, every other symbol uses the exchange's real (monthly) list.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setExpiryOptions([]);
    const request =
      symbol === "NIFTY"
        ? fetchNiftyExpiries(controller.signal).then((list) => list.map((e) => e.date))
        : fetchOptionsExpiries(symbol, controller.signal);
    request
      .then((list) => {
        if (active) setExpiryOptions(list);
      })
      .catch(() => {
        /* non-fatal: picker falls back to nearest */
      });
    return () => {
      active = false;
      // A symbol switch must not leave the old expiry request running.
      controller.abort();
    };
  }, [symbol]);

  // Recorded days for the selected underlying. Empty for a symbol the recorder
  // has never written → the EOD toggle and date picker stay hidden rather than
  // promising history that does not exist.
  useEffect(() => {
    if (symbol === "NIFTY") {
      setHistoryDates([]);
      return;
    }
    let alive = true;
    const controller = new AbortController();
    void fetchOptionsReplayDates(symbol, controller.signal)
      .then((dates) => {
        if (alive) setHistoryDates(dates);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      controller.abort();
    };
  }, [symbol]);

  // Context switch (mode/expiry/date): cancel the previous load before the
  // load effect below starts the new one, then drop stale report data so a 404
  // cannot hide behind the previous context's successful response.
  useEffect(() => {
    if (prevContext.current !== contextKey) {
      prevContext.current = contextKey;
      requestIdRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      loadingRef.current = false;
      setLoading(false);
      setReport(null);
      setSensex(null);
      sensexControllerRef.current?.abort();
      sensexControllerRef.current = null;
      setSensexLoading(false);
      setSensexError(null);
      setTape(null);
      setBursts(null);
      setStreamed([]);
      // Replay frames are keyed by MINUTE only, so a frame cached for the
      // previous date would be served for the new one (wrong chain, wrong
      // spot). Dropping the cache also releases the up-to-8 full reports it
      // pins from the old context.
      replayFrameCacheRef.current.clear();
      replayFrameReqRef.current += 1;
      // Session-scoped live series belong to the previous context. Keeping
      // them pins their objects *and* blocks the pre-move timeline from
      // re-seeding — it only seeds while the history is empty.
      setOiPoints([]);
      setWallHistory([]);
      setLivePreMoveHistory([]);
      setPreMoveAlert(null);
      // Replay belongs to one (mode, date) context only — dropping it also
      // tears down the playback interval via the play effect's cleanup.
      // Cancel any coalesced scrub frame so a stale frame from the old
      // context never lands on the new one.
      if (scrubRafRef.current !== null) {
        window.cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }
      pendingScrubRef.current = null;
      // A prefetch belongs to the old (mode, date) context; drop it so an
      // idle callback cannot fire into the new replay.
      cancelReplayPrefetch();
      setReplay(null);
      setReplayIndex(0);
      setReplayPlaying(false);
      setError(null);
    }
  }, [contextKey, cancelReplayPrefetch]);

  // Abort an in-flight request on unmount without updating state afterward.
  useEffect(
    () => () => {
      requestIdRef.current += 1;
      requestControllerRef.current?.abort();
      sensexControllerRef.current?.abort();
      requestControllerRef.current = null;
      sensexControllerRef.current = null;
      if (scrubRafRef.current !== null) {
        window.cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }
      pendingScrubRef.current = null;
      cancelReplayPrefetch();
      replayFrameInflightRef.current.clear();
    },
    [cancelReplayPrefetch],
  );

  useEffect(() => {
    if (!booted) return;
    if (mode === "live" || (mode === "eod" && date)) {
      void load();
    }
  }, [mode, load, date, booted]);

  // Live report over WebSocket — the single live source. There is no HTTP
  // polling fallback; the one-shot REST load above only paints the first
  // frame so the page never waits on the socket.
  const { report: wsReport, tape: wsTape, sensex: wsSensex, connected: wsConnected } = useNiftyReportStream({
    expiry: expiry === "nearest" ? undefined : expiry,
    // The NIFTY socket must never push into a non-NIFTY view, and never open
    // before `booted`: on a closed market the bootstrap flips to EOD, so an
    // early socket connect is a wasted handshake + a report frame.
    enabled: booted && mode === "live" && symbol === "NIFTY",
  });

  // A pushed report replaces the REST state directly — no refetch needed.
  useEffect(() => {
    if (symbol !== "NIFTY") return;
    if (wsReport) {
      setReport(wsReport);
      setUpdatedAtMs(Date.now());
    }
  }, [wsReport, symbol]);

  // Pushed tape/sensex keep those blocks live after the initial REST load.
  // Nulls never arrive here (the hook keeps the last good value), so a
  // non-null push always replaces the REST state.
  useEffect(() => {
    if (symbol !== "NIFTY") return;
    if (wsTape) {
      setTape(wsTape);
      setUpdatedAtMs(Date.now());
    }
  }, [wsTape, symbol]);

  useEffect(() => {
    if (symbol !== "NIFTY") return;
    if (wsSensex) {
      setSensex(wsSensex);
      setSensexError(null);
      setUpdatedAtMs(Date.now());
    }
  }, [wsSensex, symbol]);

  // The ~1/second spot tick is consumed by the isolated header label (which
  // owns its own clock) and the Spot stat only — it deliberately never bumps
  // `updatedAtMs`. It still re-renders this component (the tick is hook state
  // here), which is why every heavy child is `memo`-bound with stable props:
  // the tick repaints the shell + Spot numeral, not the chain/walls/charts.

  // Track how long the live socket has been down. `nowMs` only moves on
  // loads, WS pushes and tab-visibility flips, so schedule a one-shot
  // wake-up at the stale threshold — this is a clock, never a refetch.
  useEffect(() => {
    if (mode !== "live" || marketClosed) {
      setWsDownSinceMs(null);
      return;
    }
    if (wsConnected) {
      setWsDownSinceMs(null);
      return;
    }
    setWsDownSinceMs((prev) => prev ?? Date.now());
  }, [mode, marketClosed, wsConnected]);

  useEffect(() => {
    if (mode !== "live" || marketClosed || wsConnected || wsDownSinceMs === null) return;
    const remaining = wsDownSinceMs + STALE_AFTER_MS - Date.now();
    if (remaining <= 0) {
      setNowMs(Date.now());
      return;
    }
    const id = setTimeout(() => setNowMs(Date.now()), remaining + 250);
    return () => clearTimeout(id);
  }, [mode, marketClosed, wsConnected, wsDownSinceMs]);

  // Track tab visibility so the clock (and staleness badge) refreshes when
  // the user returns.
  useEffect(() => {
    const onVisibility = () => {
      setNowMs(Date.now());
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const handleRefresh = useCallback(() => {
    void load();
  }, [load]);

  const handleSnapshot = useCallback(async () => {
    // A snapshot is "capture the chain right now". EOD has no live chain to
    // capture — POSTing the picked (past) date would overwrite history with
    // today's data, so the action is a no-op and the button is disabled.
    // Snapshots are NIFTY-only (the endpoint records the NIFTY chain).
    if (mode === "eod" || symbol !== "NIFTY") return;
    setSnapshotting(true);
    setError(null);
    try {
      const data = await snapshotNifty(
        undefined,
        expiry === "nearest" ? undefined : expiry,
      );
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Snapshot failed");
    } finally {
      setSnapshotting(false);
    }
  }, [mode, expiry, symbol]);

  // Scrub the replay playhead. The thumb/counter follow the pointer
  // immediately (urgent `replayIndex`), while the heavy `report`/`sensex`
  // swap is coalesced to one frame per animation frame — newest wins, stale
  // frames never land — and applied in a transition so React can skip
  // intermediate frames instead of blocking input. Pausing first so a scrub
  // never fights the play interval. Stable identity keeps the memoised
  // replay bar's props stable.
  const scrubReplay = useCallback(
    (rawIndex: number) => {
      if (!replay) return;
      const clamped = Math.max(
        0,
        Math.min(replay.snapshots.length - 1, Math.floor(rawIndex)),
      );
      setReplayPlaying(false);
      setReplayIndex(clamped);
    },
    [replay],
  );

  // Play/Pause. Pressing Play on the last frame restarts the day from
  // minute one (replaying from the end would otherwise be a no-op).
  // Pausing cancels any coalesced-but-unapplied scrub frame so nothing
  // lands after the pause.
  const handleReplayPlayToggle = useCallback(() => {
    if (replayPlaying) {
      if (scrubRafRef.current !== null) {
        window.cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }
      pendingScrubRef.current = null;
      setReplayPlaying(false);
      return;
    }
    if (replay && replayIndex >= replay.snapshots.length - 1) {
      const first = replay.snapshots[0];
      setReplayIndex(0);
      // Whole-day payloads are already in memory; meta payloads carry a stub
      // here, so the playhead effect fetches the frame instead.
      if (first && first.report !== REPLAY_STUB_REPORT) {
        startTransition(() => {
          setReport(first.report);
          setSensex(first.sensex ?? null);
        });
      }
      setReplayPlaying(true);
      return;
    }
    setReplayPlaying(true);
  }, [replay, replayIndex, replayPlaying]);

  // Load the frame for the playhead. The playhead list is tiny; each frame is
  // fetched once and cached (newest 8), so scrubbing costs ~100 KB per new
  // minute instead of holding the whole day (~33 MB) in memory.
  useEffect(() => {
    if (mode !== "eod" || !date || !replay) return;
    const frame = replay.snapshots[replayIndex];
    if (!frame || !frame.t) return;
    const nextFrame = replay.snapshots[replayIndex + 1];
    if (frame.report !== REPLAY_STUB_REPORT) {
      // Fallback path (whole-day payload from an older backend): coalesce the
      // heavy paint behind one animation frame — newest scrub wins, so five
      // inputs in a tick never paint five chains.
      pendingScrubRef.current = { report: withBaseCandles(frame.report), sensex: frame.sensex };
      if (scrubRafRef.current !== null) return;
      scrubRafRef.current = window.requestAnimationFrame(() => {
        scrubRafRef.current = null;
        const pending = pendingScrubRef.current;
        pendingScrubRef.current = null;
        if (!pending) return;
        startTransition(() => {
          setReport(pending.report);
          setSensex(pending.sensex);
        });
      });
      return;
    }
    const key = frame.t;
    const cached = replayFrameCacheRef.current.get(key);
    if (cached) {
      startTransition(() => setReport(withBaseCandles(cached)));
      prefetchNextReplayFrame(date, nextFrame);
      return;
    }
    const requestId = ++replayFrameReqRef.current;
    void loadReplayFrame(date, key).then((loaded) => {
      if (requestId !== replayFrameReqRef.current || !loaded) return;
      startTransition(() => {
        setReport(withBaseCandles(loaded.report));
        setSensex(loaded.sensex);
      });
      prefetchNextReplayFrame(date, nextFrame);
    });
  }, [mode, date, replay, replayIndex, loadReplayFrame, prefetchNextReplayFrame, withBaseCandles]);

  /** Symbol-specific metrics derived from the report (strike step, lot size, thresholds). */
  const metrics = useMemo<SymbolMetrics | null>(
    () => (report ? symbolMetrics(report) : null),
    [report],
  );

  /** Readability: full chain is noise — show the ATM window only (symbol-aware). */
  const visibleStrikes = useMemo(
    () =>
      report && Array.isArray(report.strikes)
        ? report.strikes.filter((s) => Math.abs(s.strike - report.spot) <= (metrics?.atmWindowPts ?? 750))
        : [],
    [report, metrics],
  );

  /** Current-strike anchor: closest chain strike to spot. */
  const atmStrike = useMemo(
    () => (report && Array.isArray(report.strikes) ? findAtmStrike(report.strikes, report.spot) : null),
    [report],
  );

  /** Bar anchors: max |ΔOI| per leg over the visible (±750) rows. */
  const oiScale = useMemo(() => {
    let maxCeOiChange = 0;
    let maxPeOiChange = 0;
    for (const s of visibleStrikes) {
      const ce = Math.abs(s.ce.oiChange ?? 0);
      const pe = Math.abs(s.pe.oiChange ?? 0);
      if (ce > maxCeOiChange) maxCeOiChange = ce;
      if (pe > maxPeOiChange) maxPeOiChange = pe;
    }
    return { maxCeOiChange, maxPeOiChange };
  }, [visibleStrikes]);

  /** CW/PW tag the heaviest strike NEAR spot — a far wall is not intraday. */
  const oiWalls = useMemo(
    () => ({
      calls: (report?.wallsNear?.calls ?? report?.walls?.calls ?? []).slice(0, 1),
      puts: (report?.wallsNear?.puts ?? report?.walls?.puts ?? []).slice(0, 1),
    }),
    [report],
  );

  const oiColumns = useMemo(
    () =>
      getNiftyOiColumns(atmStrike, {
        maxCeOiChange: oiScale.maxCeOiChange,
        maxPeOiChange: oiScale.maxPeOiChange,
        spot: report?.spot,
        walls: oiWalls,
        // DESK drops the two premium-change tracks: the chain fits its rail
        // with no horizontal scrollbar. RESEARCH keeps all seven columns.
        showLegChange: !isDesk,
      }),
    [atmStrike, oiScale, oiWalls, report?.spot, isDesk],
  );
  const oiStrikeStickyLeft = isDesk
    ? OI_STRIKE_STICKY_LEFT_COMPACT
    : OI_STRIKE_STICKY_LEFT;

  const getOiRowStyle = useCallback(
    (row: NiftyStrike) =>
      atmStrike !== null && row.strike === atmStrike
        ? { background: hexToRgba(palette.TERM_FLIP, 0.08) }
        : undefined,
    [atmStrike],
  );

  const getOiRowTestId = useCallback(
    (row: NiftyStrike) =>
      atmStrike !== null && row.strike === atmStrike
        ? "nifty-strike-atm"
        : "nifty-strike-row",
    [atmStrike],
  );

  // The OI chain renders twice when the chart fullscreen modal is open
  // (inline + modal copy, same props, no refetch). One memoised renderer
  // keeps them identical; distinct testids keep queries unambiguous.
  const oiExpandedWrapRef = useRef<HTMLDivElement>(null);
  const openOiExpand = useCallback(() => setOiExpand(true), []);
  // Stable wall callbacks: inline arrows here were new props on every ~1 s
  // spot tick, defeating `memo` on NiftyWallsCard / NiftyWallsExpanded.
  const openWalls = useCallback(() => setWallsOpen(true), []);
  const closeWalls = useCallback(() => setWallsOpen(false), []);

  // Contained auto-scroll: center the ATM row inside the TABLE's own scroll
  // container only. Never scrollIntoView — that escapes to the page scroller
  // and buries the toolbar.
  const oiWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!report || atmStrike === null) return;
    try {
      const root = oiWrapRef.current;
      if (!root) return;
      const row = root.querySelector('[data-testid="nifty-strike-atm"]');
      if (!row || !(row instanceof HTMLElement)) return;
      let node: HTMLElement | null = row.parentElement;
      let scroller: HTMLElement | null = null;
      while (node && node !== root) {
        if (node.scrollHeight > node.clientHeight + 1) {
          scroller = node;
          break;
        }
        node = node.parentElement;
      }
      if (!scroller && root.scrollHeight > root.clientHeight + 1) scroller = root;
      if (!scroller) return;
      const sRect = scroller.getBoundingClientRect();
      const rRect = row.getBoundingClientRect();
      scroller.scrollTop +=
        (rRect.top - sRect.top) - (sRect.height / 2 - rRect.height / 2);
    } catch {
      /* non-fatal: leave scroll position alone */
    }
  }, [report, atmStrike, visibleStrikes]);

  const levels = useMemo(
    () => (report ? buildOvernightLevels(report) : null),
    [report],
  );

  // PLAN one-liner: the deterministic desk plan adapted to the summary
  // input (active side's reasons only) → single headline + confidence.
  const planSummary = useMemo(() => {
    if (!report) return null;
    const plan = buildDeskPlan(report);
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
      reasons: active.reasons.map((r) => ({ tag: r.tag, text: r.text })),
    };
    return summarizeDeskPlan(input);
  }, [report]);
  const planTone =
    planSummary?.tone === "positive"
      ? palette.POSITIVE
      : planSummary?.tone === "negative"
        ? palette.NEGATIVE
        : palette.WARNING;

  // (Chart candles, EMAs and mark-lines now live in the memoised
  // NiftyChartPanel, which owns the size/timeframe state.)

  // In-app OI-burst alerts. Bursts come from the backend when it has any
  // (they survive the tab being closed); an empty/absent backend answer falls
  // back to the local detector so the page never goes blind. Plain hook state.
  // Server-pushed alerts (WebSocket) land here within ~seconds of the tape row,
  // instead of waiting for the next report frame. The hook's seen-set dedupes,
  // so a burst from the REST snapshot and the stream arrives only once.
  const onStreamEvent = useCallback((b: NiftyBurst) => {
    setStreamed((prev) =>
      prev.some((x) => x.id === b.id) ? prev : [...prev, b].slice(-200),
    );
  }, []);
  useNiftyBurstStream(onStreamEvent, booted && mode === "live" && symbol === "NIFTY");

  // Bursts come from the SERVER only (REST for the day + the WS stream). The
  // client-side detector was a duplicate implementation and drifted from the
  // backend's flow read (2026-10-23 "longs liquidating → BUY CE").
  const detectedBursts = useMemo<OiBurst[]>(() => bursts ?? [], [bursts]);

  // EOD replay: the tape must agree with the frame on screen. Without this the
  // header kept the last row of the day (15:28) while the chain/GEX showed the
  // scrubbed frame — three different flips and two max pains on one page.
  // Declared before the burst context so session trend/5-minute/premium are
  // measured at the playhead, not against the full (future-inclusive) tape.
  const replayFrameT =
    replay && replayIndex < replay.snapshots.length
      ? replay.snapshots[replayIndex].t
      : null;
  const replayFrameLabel = replayFrameT ? burstTimeLabel(replayFrameT) : null;
  const tapeRows = useMemo(() => {
    const rows = tape?.rows ?? [];
    if (!replayFrameLabel) return rows;
    // Compare HH:MM labels: tape rows may be bare clock strings while the
    // replay frame carries a full IST timestamp (and vice versa).
    return rows.filter((r) => burstTimeLabel(r.t) <= replayFrameLabel);
  }, [tape, replayFrameLabel]);

  // Generic underlyings (SENSEX/RELIANCE) do not get a server-side
  // `flow_window`; derive the same 5m/15m CE/PE OI windows from their tape so
  // the WINDOWS strip and flip markers work exactly like NIFTY.
  const derivedFlow = useMemo(
    () => report?.flow_window ?? flowWindowFromTape(tapeRows),
    [report?.flow_window, tapeRows],
  );
  const flowReport = useMemo(
    () => (report ? { ...report, flow_window: derivedFlow } : report),
    [report, derivedFlow],
  );

  /** Last 5m flow sign flip, persisted per symbol/mode/date for 30 minutes. */
  const [lastFlip, setLastFlip] = useState<FlowLastFlip | null>(null);
  const flipWatchRef = useRef<FlipWatchState | null>(null);
  const flipStorageKeyNow = flipStorageKey(symbol, mode, date || report?.date || "live");
  // Context change (symbol/mode/date): reload the persisted flip and re-seed
  // the watcher. The first poll after a reload must not invent a flip.
  useEffect(() => {
    flipWatchRef.current = null;
    setLastFlip(loadStoredFlip(flipStorageKeyNow));
  }, [flipStorageKeyNow]);
  // Poll-to-poll flip detection. The pure reducer seeds on first sight and
  // only reports a real sign change / newly-disagreeing 5m leg afterwards.
  useEffect(() => {
    if (!derivedFlow) return;
    const at = derivedFlow.as_of || new Date().toISOString();
    const next = detectFlipChange(
      flipWatchRef.current,
      derivedFlow["5m"],
      derivedFlow["15m"],
      sessionTone(report?.control?.verdict),
      at,
    );
    flipWatchRef.current = next.state;
    if (next.flip) {
      setLastFlip(next.flip);
      saveStoredFlip(flipStorageKeyNow, next.flip);
    }
  }, [derivedFlow, report?.control?.verdict, flipStorageKeyNow]);
  /** Current disagreement (drives the flip badge + the paused setup banner). */
  const currentFlip = useMemo(
    () =>
      detectFlowFlip(
        derivedFlow?.["5m"],
        derivedFlow?.["15m"],
        sessionTone(report?.control?.verdict),
      ),
    [derivedFlow, report?.control?.verdict],
  );
  const flipAt = lastFlip?.at ?? null;
  /** First intraday candle (or first tape row for generic underlyings) —
   *  anchors the heatmap axis at the session open. */
  const intradayStart = useMemo(
    () =>
      report?.intraday?.[0]?.time ??
      report?.candles?.[0]?.time ??
      tapeRows[0]?.t ??
      null,
    [report?.intraday, report?.candles, tapeRows],
  );

  // Option-volume pressure + the five pre-move gates. Both read the same tape
  // the flow strip/heatmap already consume (no extra request); the radar also
  // needs the report's walls/strikes for the WALL/FUEL gates.
  const pressure = useMemo(() => buildPressure(tapeRows), [tapeRows]);
  /** Last completed 1-min move (replay-filtered tape, never the live tape). */
  const spotMove1m = useMemo(() => {
    if (!tapeRows || tapeRows.length < 2) return null;
    const last = tapeRows[tapeRows.length - 1]?.spot;
    const prev = tapeRows[tapeRows.length - 2]?.spot;
    return typeof last === "number" && typeof prev === "number" && last > 0 && prev > 0
      ? last - prev
      : null;
  }, [tapeRows]);
  const setup = useMemo(
    () =>
      metrics
        ? setupRadar({
            rows: tapeRows,
            spot: report?.spot,
            wallsNear: report?.wallsNear,
            walls: report?.walls,
            strikes: report?.strikes,
            pressure,
            gex: report?.gex,
            pivots: report?.pivots,
            prevDay: report?.pivots?.prev,
            metrics,
          })
        : { gates: [], score: 0, state: "QUIET" as const },
    [tapeRows, report?.spot, report?.wallsNear, report?.walls, report?.strikes, pressure, report?.gex, report?.pivots, metrics],
  );
  const flowSeries = useMemo(() => buildFlowSeries(tapeRows), [tapeRows]);

  /** Tape displacement over 5 minutes, in units of the median 5-min move.
   *  Lets the UI say "the positioning read says bearish, but the tape is
   *  running up" instead of leaving the contradiction silent. */
  const tapeSpeed = useMemo(() => {
    const sp = tapeRows.map((r) => r.spot).filter((v) => Number.isFinite(v) && v > 0);
    if (sp.length < 7) return null;
    const last = sp[sp.length - 1];
    const ref = sp[Math.max(0, sp.length - 6)];
    const moves = sp.slice(1).map((v, i) => Math.abs(v - sp[i])).sort((a, b) => a - b);
    const med = moves[Math.floor(moves.length / 2)] || 1;
    const delta = last - ref;
    return { delta, ratio: Math.abs(delta) / Math.max(1, med * 5) };
  }, [tapeRows]);
  // Expanded-pane aggregation: 1m/5m/15m. Declared before the memos below so
  // they can read it (the JSX state block sits later in the component).
  const [expandRange, setExpandRange] = useState<TapeRange>(1);
  /** One resample feeds both expanded panes (was two identical passes). */
  const expandRows = useMemo(
    () => resampleTape(tapeRows, expandRange),
    [tapeRows, expandRange],
  );
  const pressureRange = useMemo(() => buildPressure(expandRows), [expandRows]);
  const flowRange = useMemo(() => buildFlowSeries(expandRows), [expandRows]);
  const maxPainSeries = useMemo(
    () => tapeRows.map((r) => r.max_pain),
    [tapeRows],
  );
  const pcrSeries = useMemo(
    () => tapeRows.map((r) => r.pcr_oi),
    [tapeRows],
  );

  /** Modal title with the 1m/5m/15m aggregation control on the right. */
  const rangeTitle = (label: string, prefix: string) => (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%", minWidth: 0 }}>
      <Box
        component="span"
        sx={{
          flex: 1,
          minWidth: 0,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          color: palette.TEXT_MUTED,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </Box>
      <RangeToggle value={expandRange} onChange={setExpandRange} testIdPrefix={prefix} />
    </Box>
  );

  // Index breadth: 5 indices, 60s cache on the server, refreshed once a minute
  // while the tab is VISIBLE. A hidden tab skips the tick (no request), and
  // returning to the tab does one immediate refresh instead of waiting for the
  // next interval. Failure keeps the last strip (or renders nothing).
  const [breadth, setBreadth] = useState<BreadthPayload | null>(null);
  const [oiPoints, setOiPoints] = useState<OiPoint[]>([]);
  useEffect(() => {
    // Live-only source: `/api/reports/breadth` has no date/`at` parameter and
    // serves a 60 s cache, so polling it from an EOD replay would paint the
    // current breadth over a 09:17 frame.
    if (mode !== "live") return;
    let alive = true;
    let lastLoadAt = 0;
    const controller = new AbortController();
    const load = () => {
      if (document.hidden) return;
      const now = Date.now();
      // Visibility + interval can collide on focus; one request is enough.
      if (now - lastLoadAt < 2_000) return;
      lastLoadAt = now;
      fetchBreadth(controller.signal)
        .then((b) => {
          if (alive) setBreadth(b);
        })
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, 60_000);
    const onVisibility = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      window.clearInterval(id);
      controller.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode]);

  // 10-second chain feed. LIVE polls the last ~15 min; EOD reads the selected
  // date ONCE — a past date never changes, so re-fetching 2,000 rows every
  // 10s was pure waste. Hidden tabs skip the live tick and refresh on return.
  // NIFTY reads its recorder; every other underlying reads its own generic
  // `chain10s` history. A symbol without a recorded chain simply returns `[]`
  // and the existing points are kept (never faked).
  useEffect(() => {
    if (!booted) return;
    let alive = true;
    let lastLoadAt = 0;
    const controller = new AbortController();
    const load = () => {
      if (!alive) return;
      if (mode === "live" && document.hidden) return;
      const now = Date.now();
      if (mode === "live" && now - lastLoadAt < 2_000) return;
      lastLoadAt = now;
      const limit = mode === "eod" ? 2000 : 90;
      const dateKey = mode === "eod" ? date || undefined : undefined;
      const request =
        symbol === "NIFTY"
          ? fetchChain10sSummary(dateKey, limit, controller.signal)
          : fetchOptionsChain10s(symbol, dateKey, limit, controller.signal);
      request
        .then((rows: Chain10sSummaryPoint[]) => {
          if (!alive || !rows.length) return;
          setOiPoints(
            rows.map((r) => ({
              t: r.t,
              ce: r.ce_oi,
              pe: r.pe_oi,
              spot: r.spot ?? null,
              cePrem: r.ce_prem ?? null,
              pePrem: r.pe_prem ?? null,
            })),
          );
        })
        .catch(() => undefined);
    };
    load();
    // A historical day is immutable: fetch once, no interval.
    if (mode === "eod") {
      return () => {
        alive = false;
        controller.abort();
      };
    }
    const id = window.setInterval(load, 10_000);
    const onVisibility = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      window.clearInterval(id);
      controller.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode, date, symbol, booted]);

  // Live bursts for a generic underlying. NIFTY gets pushed bursts over its
  // socket; the generic history has no stream, so poll the recorded feed.
  useEffect(() => {
    if (symbol === "NIFTY" || mode !== "live") return;
    let alive = true;
    const controller = new AbortController();
    const id = window.setInterval(() => {
      void fetchOptionsBursts(symbol, undefined, controller.signal).then((rows) => {
        if (alive && rows.length > 0) setBursts(rows as OiBurst[]);
      });
    }, 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
      controller.abort();
    };
  }, [symbol, mode]);

  /**
   * EOD replay: the 10s feed carries the whole day (limit 2000). Score only
   * the points at/before the playhead, otherwise the radar shows the 15:30
   * flow while replaying 12:40 — the lookahead that made it peak at the
   * squeeze. Live mode keeps every point.
   */
  const replayCutMs = replayFrameT ? Date.parse(replayFrameT) : null;
  const scorePoints = useMemo(() => {
    if (replayCutMs == null) return oiPoints;
    return oiPoints.filter((p) => {
      const t = Date.parse(p.t);
      return Number.isFinite(t) && t <= replayCutMs;
    });
  }, [oiPoints, replayCutMs]);

  /**
   * Pre-move score: the positioning read that arms BEFORE the volume/OI blast.
   * On 2026-10-26 it would have armed at 13:13–13:16, 3–7 min before the 13:19
   * squeeze, while every price trigger was still quiet.
   */
  const preMove = useMemo(
    () =>
      scorePreMove({
        points: scorePoints,
        rows: tapeRows,
        pressure,
        regime: report?.regime ?? null,
      }),
    [scorePoints, tapeRows, pressure, report?.regime],
  );
  const [preMoveAlert, setPreMoveAlert] = useState<PreMoveScore | null>(null);
  const [livePreMoveHistory, setLivePreMoveHistory] = useState<PreMovePoint[]>([]);
  // Wall OI history for the squeeze radar: the panel polls ~10s, so keep 3 min
  // and compare the selected wall against its own print >=60s old.
  const [wallHistory, setWallHistory] = useState<WallSnapshot[]>([]);
  useEffect(() => {
    // Only live consumes this history (the radar hides wall delta in replay).
    // Skipping non-live also stops a state update per replay scrub.
    if (mode !== "live") return;
    if (!report) return;
    const t = Date.now();
    const walls = resolveWallBoard(report.wallsNear, report.walls);
    if (!walls) return;
    const snaps: WallSnapshot[] = [
      ...(walls.calls ?? []).map((w) => ({ t, side: "ce" as const, strike: w.strike, oi: w.oi })),
      ...(walls.puts ?? []).map((w) => ({ t, side: "pe" as const, strike: w.strike, oi: w.oi })),
    ];
    setWallHistory((h) => [...h.filter((s) => t - s.t < 180_000), ...snaps].slice(-60));
  }, [report, mode]);
  const armedStreakRef = useRef(0);
  const lastPreMoveAlertRef = useRef(0);
  useEffect(() => {
    if (mode !== "live") return;
    if (preMove.state !== "armed") {
      armedStreakRef.current = 0;
      return;
    }
    armedStreakRef.current += 1;
    // Two consecutive 10 s reads = the setup is holding, not a single print.
    if (armedStreakRef.current !== 2) return;
    if (Date.now() - lastPreMoveAlertRef.current < 10 * 60_000) return;
    lastPreMoveAlertRef.current = Date.now();
    setPreMoveAlert(preMove);
    if (!alertsMuted()) {
      playAlertSound("alert");
      flashAlertTitle(`SETUP ARMING ${preMove.score}/${preMove.max} — ${preMove.reasons.slice(0, 3).join(" · ")}`);
    }
  }, [preMove]);

  // One history point per 10 s chain snapshot (appendPreMove dedupes by time).
  // Live only; replay derives its history from the playhead-filtered points.
  useEffect(() => {
    if (mode !== "live") return;
    const last = oiPoints[oiPoints.length - 1];
    if (!last) return;
    const t = Date.parse(last.t);
    if (!Number.isFinite(t)) return;
    setLivePreMoveHistory((h) => {
      // First load: seed the last 15 min from the 10 s window so the timeline
      // shows the arming sequence immediately, not after 15 min of polling.
      if (h.length === 0 && oiPoints.length >= 12) return seedPreMoveHistory(oiPoints);
      return appendPreMove(h, {
        t,
        score: preMove.score,
        spot: last.spot ?? null,
        comps: preMove.components.filter((c) => c.points > 0).map((c) => c.key),
      });
    });
  }, [mode, preMove, oiPoints]);

  const preMoveHistory = useMemo(() => {
    if (mode === "live") return livePreMoveHistory;
    // Only the last ~33 min before the playhead: seedPreMoveHistory is O(n²),
    // and a full day of 10s points would make every scrub expensive.
    return seedPreMoveHistory(scorePoints.slice(-200)).slice(-180);
  }, [mode, livePreMoveHistory, scorePoints]);

  // The arming banner is a prompt, not a permanent state: 3 minutes or dismiss.
  useEffect(() => {
    if (!preMoveAlert) return;
    const id = window.setTimeout(() => setPreMoveAlert(null), 180_000);
    return () => window.clearTimeout(id);
  }, [preMoveAlert]);

  // Session context per tape minute, computed ONCE per tape (single sort + one
  // EMA pass) instead of re-sorting the whole tape for every burst
  // (O(bursts × rows log rows) per render). Bursts then attach their trend by
  // minute lookup — the signal gate still runs on data available at each
  // burst's own minute (never the close). A burst whose minute is absent from
  // the tape falls back to the end-of-tape trend, exactly like the old
  // per-burst `sessionTrend` call (which scanned to the end on no match).
  // Keys are HH:MM (`burstTimeLabel`) so backend ISO timestamps and tape
  // HH:MM:SS rows meet on the same minute; the last row of a minute wins.
  const sessionContext = useMemo(() => {
    const rows = tapeRows;
    const asc = [...rows].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    const byMinute = new Map<string, "up" | "down" | null>();
    const spotByMinute = new Map<string, number>();
    const premByMinute = new Map<string, MinutePremium>();
    const alpha = 2 / (TREND_EMA_SPAN + 1);
    let ema: number | null = null;
    let last = 0;
    for (const r of asc) {
      if (!Number.isFinite(r.spot) || r.spot === 0) continue;
      ema = ema === null ? r.spot : alpha * r.spot + (1 - alpha) * ema;
      last = r.spot;
      const key = burstTimeLabel(r.t);
      byMinute.set(key, last > (ema as number) ? "up" : last < (ema as number) ? "down" : null);
      spotByMinute.set(key, r.spot);
      if (r.atm_ce_ltp != null || r.atm_pe_ltp != null || r.atm_strike != null) {
        premByMinute.set(key, {
          strike: r.atm_strike ?? null,
          ce: r.atm_ce_ltp ?? null,
          pe: r.atm_pe_ltp ?? null,
        });
      }
    }
    const end: "up" | "down" | null =
      ema === null ? null : last > ema ? "up" : last < ema ? "down" : null;
    return { byMinute, end, spotByMinute, premByMinute };
  }, [tapeRows]);

  const effectiveBursts = useMemo<OiBurst[]>(() => {
    const byId = new Map<string, OiBurst>();
    for (const b of detectedBursts) byId.set(b.id, b);
    for (const b of streamed) if (!byId.has(b.id)) byId.set(b.id, b);
    // Frame-bound the replay: at a 09:30 playhead a 15:04 burst does not
    // exist yet. Without this the trail seeded the whole session (60 bursts /
    // 7 critical) while the chart showed the morning.
    const merged = replayFrameLabel
      ? [...byId.values()].filter((b) => burstTimeLabel(b.t) <= replayFrameLabel)
      : [...byId.values()];
    if (sessionContext.byMinute.size === 0) return merged;
    // Attach per-minute context so the signal gate runs on data available at
    // each burst's own minute (never the close): session trend, 5-minute
    // trend (lets a covering burst through on a reversal), and the same-side
    // ATM premium change (the flow fallback for pre-restart bursts).
    return merged.map((b) => {
      const key = burstTimeLabel(b.t);
      const trend = b.trend ?? sessionContext.byMinute.get(key) ?? sessionContext.end;
      let trend5m = b.trend5m ?? null;
      if (trend5m === null) {
        const now = sessionContext.spotByMinute.get(key);
        const before = spotMinutesBefore(sessionContext.spotByMinute, key, 5);
        if (now !== undefined && before !== null && now !== before) {
          trend5m = now > before ? "up" : "down";
        }
      }
      let premChg = b.premChg ?? null;
      if (premChg === null) {
        premChg = premiumChangeBefore(sessionContext.premByMinute, key, b.side);
      }
      return {
        ...b,
        trend,
        ...(trend5m !== null ? { trend5m } : {}),
        ...(premChg !== null ? { premChg } : {}),
      };
    });
  }, [detectedBursts, streamed, sessionContext, replayFrameLabel]);
  /** Minute → burst side, for the tape's burst spine. Wall geometry and
   *  stale-data warnings are not OI bursts, so they never mark the spine. */
  const burstMap = useMemo(() => {
    const m = new Map<string, "call" | "put">();
    for (const b of effectiveBursts) {
      if (isNonTradeAlertType(b.type)) continue;
      m.set(b.t, b.side);
    }
    return m;
  }, [effectiveBursts]);

  // Slow-moving session detail (bursts, structure, volume, straddle, gamma) is
  // collapsed by default so the first screen is the decision surface. Nothing
  // unmounts — the chart/tables stay warm and re-measure on reveal.
  const [detailOpen, setDetailOpen] = useState(false);
  const toggleDetail = useCallback(() => setDetailOpen((v) => !v), []);
  // In replay the trail/banners must be seeded from the frame, not the day:
  // including the frame minute in the session key resets + reseeds them as the
  // playhead moves, so a 09:30 replay never lists a 15:04 unwind.
  const alertsSessionKey = replayFrameLabel
    ? `${symbol}:${contextKey}@${replayFrameLabel}`
    : `${symbol}:${contextKey}`;
  const { trail, toasts, banners, dismissToast, dismissBanner, clearTrail, pushToast } = useNiftyOiAlerts(
    effectiveBursts,
    report?.strikes ?? [],
    report?.spot ?? 0,
    tape != null,
    mode === "live",
    alertsSessionKey,
  );
  // Critical-only view for the OI-burst trail (defaults off).
  const [criticalOnly, setCriticalOnly] = useState(false);
  // Alert sound lives in localStorage; the toggle only flips the UI state.
  const [soundMuted, setSoundMuted] = useState(() => alertsMuted());
  // Spot-velocity alerts: the 1-second tape catches a 15-pt sprint that no
  // 1-minute OI column can see.
  const { blast, dismiss: dismissBlast } = useNiftyBlasts(booted && mode === "live" && symbol === "NIFTY");

  // Every pane gets its own expand target (chart already has one).
  const [oiExpand, setOiExpand] = useState(false);
  const [heatExpand, setHeatExpand] = useState(false);
  const [flowExpand, setFlowExpand] = useState(false);
  const [pressureExpand, setPressureExpand] = useState(false);
  const [heatMetric, setHeatMetric] = useState<"oi" | "volume" | "premium">("oi");
  const [flowChartExpand, setFlowChartExpand] = useState(false);
  const toggleCriticalOnly = useCallback(() => setCriticalOnly((v) => !v), []);
  const burstsRef = useRef<HTMLDivElement>(null);

  // Critical prominence: red badge count, critical-first trail order, and the
  // sticky-banner lookup from alert id back to its burst (side/unwind/spot).
  const criticalCount = useMemo(
    () => trail.filter((a) => a.severity === "critical").length,
    [trail],
  );
  const burstById = useMemo(() => {
    const m = new Map<string, OiBurst>();
    for (const b of effectiveBursts) m.set(b.id, b);
    return m;
  }, [effectiveBursts]);
  // Time order by default (the hook's trail is newest-first). "Critical" is a
  // FILTER, not a re-sort: a severity-first list hides the minute sequence,
  // which is the whole point of a burst log.
  const displayedTrail = useMemo(() => {
    const base = criticalOnly ? trail.filter((a) => a.severity === "critical") : trail;
    // Newest first, always. The trail arrives in merge order (REST seed +
    // streamed prepends), which is not strictly chronological.
    return [...base].sort((a, b) => b.ts - a.ts);
  }, [trail, criticalOnly]);
  // DESK fits 1080p: a single sticky banner (the newest). Any further
  // banners collapse into a `+N more` tail that opens the alerts modal.
  // RESEARCH keeps the hook's cap (up to 2).
  const visibleBanners = useMemo(
    () => (isDesk ? banners.slice(0, 1) : banners),
    [banners, isDesk],
  );
  const bannerOverflow = banners.length - visibleBanners.length;

  // REPLAY — walk the day's trail oldest→newest through the toast region so the
  // notification path is verifiable after hours (nothing new arrives when the
  // market is closed). 1s cadence; stops when the cursor runs out.
  const [replayCursor, setReplayCursor] = useState<number | null>(null);
  useEffect(() => {
    if (replayCursor === null) return;
    if (replayCursor < 0) {
      setReplayCursor(null);
      return;
    }
    const id = setTimeout(() => {
      const a = trail[replayCursor];
      if (a) pushToast(a);
      setReplayCursor(replayCursor - 1);
    }, 1000);
    return () => clearTimeout(id);
  }, [replayCursor, trail, pushToast]);

  // EOD minute replay — advances the playhead one recorded frame at a time.
  // The counter moves urgently so it tracks playback; the heavy
  // report/sensex swap runs in a transition so a slow paint never blocks
  // the next tick. The interval is torn down here on pause, when `replay`
  // is dropped (mode/date change) and on unmount. Reaching the last frame
  // auto-pauses.
  useEffect(() => {
    if (!replayPlaying || !replay) return;
    if (replayIndex >= replay.snapshots.length - 1) {
      setReplayPlaying(false);
      return;
    }
    const next = replayIndex + 1;
    const id = window.setInterval(() => {
      const frame = replay.snapshots[next];
      if (!frame) {
        setReplayPlaying(false);
        return;
      }
      setReplayIndex(next);
      // Never paint the meta-path stub; the playhead effect fetches it.
      if (frame.report !== REPLAY_STUB_REPORT) {
        startTransition(() => {
          setReport(frame.report);
          setSensex(frame.sensex ?? null);
        });
      }
    }, REPLAY_PLAY_MS);
    return () => window.clearInterval(id);
  }, [replayPlaying, replay, replayIndex]);

  // No "next update" in live mode — the socket pushes; EOD never updates.
  const nextUpdateAtMs: number | null = null;

  // Stale = the WS has been down for longer than STALE_AFTER_MS while the
  // market is open. Derived purely from the socket, never from a poll timer.
  const wsDownForMs = wsDownSinceMs === null ? 0 : nowMs - wsDownSinceMs;
  const isStale =
    mode === "live" &&
    !marketClosed &&
    !wsConnected &&
    wsDownSinceMs !== null &&
    wsDownForMs > STALE_AFTER_MS;
  const staleMins = Math.max(1, Math.floor(wsDownForMs / 60_000));

  // Hoisted so the GEX stat formats below can close over consts (keeps
  // TS narrowing inside the format callbacks). Spot-relative: a negative-gamma
  // strike below spot is fuel, never "support", and vice versa above spot.
  const gexSides = useMemo(
    () => (report?.gex ? gexSideLevels(report.gex, report.spot) : { below: null, above: null }),
    [report?.gex, report?.spot],
  );
  const gexTopSup = gexSides.below;
  const gexTopRes = gexSides.above;
  const gexSupCopy = gexSideCopy(gexTopSup, "below");
  const gexResCopy = gexSideCopy(gexTopRes, "above");
  // Regime from the cumulative sign at spot (same as the backend), so stored
  // payloads recorded before that fix cannot show "long" below the flip.
  const gexRegime = useMemo(
    () =>
      report?.gex
        ? gexRegimeAtSpot(report.gex, report.spot, report.gex.regime)
        : "flat",
    [report?.gex, report?.spot],
  );
  const gexFlip = useMemo(
    () => (report?.gex ? gexFlipAtSpot(report.gex, report.spot) : null),
    [report?.gex, report?.spot],
  );
  /**
   * The gamma block is an OI proxy when the backend had no option greeks.
   * `netTotal` is then a contract count (the old "+17M Cr" unit error), and
   * `zeroCross` is an OI artefact — neither may be shown as gamma.
   */
  const gexDegraded = useMemo(() => {
    if (!report?.gex) return false;
    if (report.gex.degraded === true) return true;
    const strikes = report.strikes ?? [];
    if (strikes.length === 0) return false;
    const hasGamma = (v: number | null | undefined) =>
      typeof v === "number" && Number.isFinite(v);
    return !strikes.some((s) => hasGamma(s.ce.gamma) || hasGamma(s.pe.gamma));
  }, [report]);
  // Only hand the profile/strip a gamma block that really contains gamma.
  const gexForDisplay = gexDegraded ? undefined : report?.gex;
  // Live greeks for the RESEARCH P&L attribution, derived from the chain legs
  // (delta/IV when the backend sent them; theta/vega stay null → those parts
  // read 0 and the residual absorbs them). Null without a report.
  const pnlGreeks = useMemo<NiftyPnlGreeks[] | null>(() => {
    if (!report) return null;
    const out: NiftyPnlGreeks[] = [];
    for (const s of report.strikes ?? []) {
      out.push({
        opt: "CE",
        strike: s.strike,
        ltp: s.ce.ltp,
        delta: s.ce.delta ?? null,
        iv: s.ce.iv ?? null,
        theta: null,
        vega: null,
      });
      out.push({
        opt: "PE",
        strike: s.strike,
        ltp: s.pe.ltp,
        delta: s.pe.delta ?? null,
        iv: s.pe.iv ?? null,
        theta: null,
        vega: null,
      });
    }
    return out;
  }, [report]);

  // Stable per-render callbacks / derived data for the memoised children.
  const scrollToBursts = useCallback(() => {
    setDetailOpen(true);
    requestAnimationFrame(() => {
      burstsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, []);
  const handleOpenSymbol = useCallback(() => {
    onOpenSymbol?.(symbol);
  }, [onOpenSymbol, symbol]);
  const expiryData = useMemo(
    () => [
      { value: "nearest", label: "Nearest expiry" },
      ...expiryOptions.map((d) => ({ value: d, label: d })),
    ],
    [expiryOptions],
  );
  /** NIFTY always has a recorder; another underlying only once its own
   *  history endpoint lists a recorded day. */
  const hasRecordedHistory = symbol === "NIFTY" || historyDates.length > 0;
  const handleIndexChange = useCallback((v: string) => {
    const next = v as "nifty" | "sensex";
    setSelectedIndex(next);
    if (next === "sensex") {
      setMode("live");
      setView("chart");
    }
  }, []);
  /** Switch the report underlying. Cancels the in-flight NIFTY load (otherwise
   *  the overlap guard would swallow the new request), forces Live and clears
   *  every block that belongs to the previous symbol. */
  const handleSymbolChange = useCallback((v: string | null) => {
    const next: ReportSymbol = v === "SENSEX" || v === "RELIANCE" ? v : "NIFTY";
    setSymbol(next);
    setMode("live");
    setDate("");
    // A NIFTY weekly expiry is not a stock's monthly listing — reset so the
    // next load asks for that underlying's own nearest expiry.
    setExpiry("nearest");
    // Replay frames are cached by minute; a different symbol must never read
    // the previous symbol's chain.
    replayFrameCacheRef.current.clear();
    // The legacy toggle is hidden for non-NIFTY; keep it on the full report so
    // switching back never lands on the old Sensex summary.
    setSelectedIndex("nifty");
    requestIdRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    loadingRef.current = false;
    setLoading(false);
    sensexControllerRef.current?.abort();
    sensexControllerRef.current = null;
    setReport(null);
    setTape(null);
    setBursts(null);
    setWallsOpen(false);
    setOiPoints([]);
    setHistoryDates([]);
    setStreamed([]);
    setSensex(null);
    setReplay(null);
    setReplayIndex(0);
    setReplayPlaying(false);
    baseIntradayRef.current = [];
    baseCandlesRef.current = [];
    setError(null);
  }, []);
  const handleModeChange = useCallback((v: string) => {
    // Any manual mode choice wins over the automatic close/open switching.
    autoEodRef.current = false;
    setMode(v as NiftyReportMode);
  }, []);
  const handleViewChange = useCallback((v: string) => {
    setView(v as "chart" | "depth");
  }, []);
  const handleExpiryChange = useCallback((v: string | null) => {
    setExpiry(v ?? "nearest");
  }, []);
  const handleReplayBreak = useCallback(
    (at: string) => {
      if (!replay) return;
      const target = at.slice(11, 19);
      const index = replay.snapshots.findIndex(
        (snapshot) => String(snapshot.t).slice(11, 19) >= target,
      );
      if (index < 0) return;
      setReplayPlaying(false);
      setReplayIndex(index);
    },
    [replay],
  );

  const handleReplayTrail = useCallback(() => {
    setReplayCursor(trail.length - 1);
  }, [trail.length]);
  const formatGexSup = useCallback(
    (s: number) => formatGexLevel(s, gexTopSup?.netGex ?? 0),
    [gexTopSup],
  );
  const formatGexRes = useCallback(
    (s: number) => formatGexLevel(s, gexTopRes?.netGex ?? 0),
    [gexTopRes],
  );

  // OI-burst alerts panel. In research mode it lives inside the session
  // detail as the full inline log; in desk mode it collapses to a compact
  // bar (title + newest 2 rows, ~72px) with an Open action that shows the
  // full log in a PanelModal — one definition, mounted in exactly one place.
  const burstsTitle = (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
      <span>
        OI bursts ({trail.length})
        {isDesk && criticalCount > 0 ? ` · critical ${criticalCount}` : ""}
      </span>
      {!isDesk && criticalCount > 0 && (
        <Box
          component="span"
          data-testid="nifty-oi-critical-badge"
          title={`${criticalCount} critical burst${criticalCount === 1 ? "" : "s"} — filtered first`}
          sx={{
            display: "inline-flex",
            alignItems: "center",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: palette.NEGATIVE,
            border: `1px solid ${palette.NEGATIVE}`,
            borderRadius: "3px",
            px: "4px",
            py: "1px",
            whiteSpace: "nowrap",
            animation: "nifty-critical-pulse 1.2s ease-in-out infinite",
            "@keyframes nifty-critical-pulse": {
              "0%": { opacity: 1 },
              "50%": { opacity: 0.4 },
              "100%": { opacity: 1 },
            },
          }}
        >
          CRITICAL {criticalCount}
        </Box>
      )}
    </Box>
  );
  const burstsActions = (
    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
      <Button
        data-testid="nifty-alert-sound-toggle"
        size="sm"
        variant="subtle"
        aria-pressed={!soundMuted}
        aria-label={soundMuted ? "Unmute critical alert sound" : "Mute critical alert sound"}
        title={
          soundMuted
            ? "Alert sounds off — click to enable the critical chirp"
            : "Alert sounds on — critical bursts chirp and flash the tab title"
        }
        onClick={() => {
          const next = !soundMuted;
          setSoundMuted(next);
          setAlertsMuted(next);
        }}
        sx={{ minWidth: 24, px: "4px", fontSize: 13, lineHeight: 1 }}
      >
        {soundMuted ? "🔕" : "🔔"}
      </Button>
      {criticalCount > 0 && (
        <Button
          data-testid="nifty-oi-critical-filter"
          size="sm"
          variant="subtle"
          aria-pressed={criticalOnly}
          onClick={toggleCriticalOnly}
        >
          Critical
        </Button>
      )}
      <Button
        data-testid="nifty-oi-replay-button"
        size="sm"
        variant="subtle"
        title="Replay the day's alerts as toasts (verification only)"
        disabled={replayCursor !== null || trail.length === 0}
        onClick={handleReplayTrail}
      >
        {replayCursor !== null ? "Testing…" : "Test alerts"}
      </Button>
      <Button size="sm" variant="subtle" onClick={clearTrail}>
        Clear
      </Button>
    </Box>
  );
  const burstsPanel =
    trail.length > 0 ? (
      <Box
        ref={burstsRef}
        data-testid="nifty-oi-bursts-wrap"
        data-critical={criticalCount > 0 ? "true" : undefined}
        sx={{ minWidth: 0, flexShrink: 0 }}
      >
        <CompactPanel
          flush
          title={burstsTitle}
          testId="nifty-oi-bursts-panel"
          action={burstsActions}
        >
          <MarketAlertLog
            alerts={displayedTrail}
            fill={false}
            height={oiBurstLogHeight(displayedTrail.length)}
            onOpen={scrollToBursts}
          />
        </CompactPanel>
      </Box>
    ) : null;

  // Desk ALERTS tab: the full log lives in the dock, not in a full-screen
  // modal. The critical banner opens this tab; the tab badge carries the count.
  const alertsDockContent = (
    <Box
      data-testid="nifty-oi-bursts-panel"
      sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, gap: 0.5 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 0.5, minWidth: 0 }}>
        <Box sx={{ minWidth: 0, fontSize: 9, fontWeight: 800, letterSpacing: 0.4 }}>{burstsTitle}</Box>
        {burstsActions}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <MarketAlertLog alerts={displayedTrail} fill onOpen={scrollToBursts} />
      </Box>
    </Box>
  );

  const flowDockContent = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, minWidth: 0 }}>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1, minWidth: 0 }}>
        <Box data-testid="nifty-pressure-wrap" sx={{ position: "relative", minWidth: 0 }}>
          <NiftyPressureLane series={pressure} height={110} showAxis />
          <Button
            data-testid="nifty-pressure-expand"
            size="sm"
            variant="subtle"
            aria-label="Expand option volume pressure"
            title="Expand option volume pressure"
            onClick={() => setPressureExpand(true)}
            sx={{ position: "absolute", top: -2, right: -2, minWidth: 20, px: "3px", lineHeight: 1, fontSize: 11, bgcolor: palette.TERM_HEADER, zIndex: 1 }}
          >
            ⤢
          </Button>
        </Box>
        <Box data-testid="nifty-flowchart-wrap" sx={{ position: "relative", minWidth: 0 }}>
          <NiftyFlowChart series={flowSeries} height={110} showAxis />
          <Button
            data-testid="nifty-flowchart-expand"
            size="sm"
            variant="subtle"
            aria-label="Expand cumulative flow"
            title="Expand cumulative flow + gamma regime"
            onClick={() => setFlowChartExpand(true)}
            sx={{ position: "absolute", top: -2, right: -2, minWidth: 20, px: "3px", py: 0, lineHeight: 1, fontSize: 11, bgcolor: palette.TERM_HEADER, zIndex: 2 }}
          >
            ⤢
          </Button>
        </Box>
      </Box>
      <Box data-testid="nifty-flowstrip-wrap" sx={{ position: "relative", minWidth: 0 }}>
        <NiftyFlowStrip rows={tapeRows} />
        <Button
          data-testid="nifty-flowstrip-expand"
          size="sm"
          variant="subtle"
          aria-label="Expand the flow strip"
          title="Expand the flow strip"
          onClick={() => setFlowExpand(true)}
          sx={{ position: "absolute", top: 0, right: 2, minWidth: 22, px: "4px", lineHeight: 1, fontSize: 12, bgcolor: palette.TERM_HEADER, zIndex: 1 }}
        >
          ⤢
        </Button>
      </Box>
    </Box>
  );

  const setupDockContent = report ? (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, minWidth: 0 }}>
      <SetupRadarStrip read={setup} preMove={preMove} />
      <NiftySqueezeRadar
        report={report}
        preMove={preMove}
        setup={setup}
        history={preMoveHistory}
        wallHistory={mode === "live" ? wallHistory : EMPTY_WALL_HISTORY}
        spotMove1m={spotMove1m}
      />
    </Box>
  ) : null;

  const marketDockContent = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, minWidth: 0 }}>
      {mode === "live" ? (
        <BreadthStrip data={breadth} />
      ) : (
        // Breadth is a live quote aggregate — the recorder never stored it per
        // minute, so an EOD playhead has no historical breadth. Saying so is
        // honest; rendering today's cache at 09:17 would be look-ahead.
        <Typography
          data-testid="nifty-breadth-live-only"
          sx={{ px: 1, py: 0.5, fontSize: 9, color: palette.TEXT_MUTED, letterSpacing: "0.04em" }}
        >
          BREADTH · live only
        </Typography>
      )}
      <Nifty10sStrip points={scorePoints} noise={report ? flowNoiseFor(report) : undefined} />
      {symbol === "NIFTY" && (
        <Box data-testid="nifty-intel-cell" sx={{ minWidth: 0, display: "flex", "& > *": { width: "100%", minWidth: 0 } }}>
          <NiftyIntelStrip
            date={mode === "eod" ? date || null : null}
            expiry={expiry === "nearest" ? null : expiry}
            eod={mode === "eod"}
          />
        </Box>
      )}
    </Box>
  );

  const flowNet = flowSeries.points.length > 0 ? flowSeries.points[flowSeries.points.length - 1].net : null;
  const flowSummary =
    flowNet == null
      ? "—"
      : `${flowNet >= 0 ? "call" : "put"} ${flowNet >= 0 ? "+" : "−"}${(Math.abs(flowNet) / 1e6).toFixed(2)}M`;
  const setupPassed = setup.gates.filter((gate) => gate.pass).length;
  const setupSummary = `${setupPassed}/${setup.gates.length} · ${preMove.state}`;
  const alertsSummary = `${trail.length}${criticalCount > 0 ? ` · ${criticalCount}C` : ""}`;
  const marketSummary = breadth ? `${breadth.up}/${breadth.rows.length}` : "—";
  const planOneLiner = planSummary ? (
            <Box
              data-testid="nifty-plan-oneliner"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                px: 1,
                minHeight: 20,
                border: `1px solid ${palette.TERM_BORDER}`,
                borderRadius: "4px",
                bgcolor: palette.TERM_HEADER,
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                flexShrink: 0,
                "& .MuiButton-root": {
                  minWidth: 18,
                  minHeight: 18,
                  height: 18,
                  py: 0,
                  px: 0.5,
                  fontSize: 10,
                  lineHeight: 1,
                },
              }}
            >
              <Box
                component="span"
                aria-hidden
                sx={{ width: 3, alignSelf: "stretch", my: 0.75, borderRadius: "1px", bgcolor: planTone, flexShrink: 0 }}
              />
              <Box
                data-testid="nifty-plan-headline"
                title={`${planSummary.action} · confidence ${planSummary.confidence}%`}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  fontFamily: palette.MONO,
                  color: planTone,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {planSummary.headline}
              </Box>
              <Box
                data-testid="nifty-plan-confidence"
                title="Weighted confidence behind the active side"
                sx={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: palette.TEXT_MUTED,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  opacity: 0.8,
                }}
              >
                {planSummary.confidence}%
              </Box>
              {tapeSpeed && tapeSpeed.ratio >= 1.5 ? (() => {
                const up = tapeSpeed.delta > 0;
                const side = planSummary.headline.startsWith("BEARISH")
                  ? "bear"
                  : planSummary.headline.startsWith("BULLISH")
                    ? "bull"
                    : null;
                const conflict = (side === "bear" && up) || (side === "bull" && !up);
                const tone = conflict
                  ? palette.WARNING
                  : up
                    ? palette.POSITIVE
                    : palette.NEGATIVE;
                return (
                  <Box
                    component="span"
                    data-testid="nifty-plan-tape"
                    data-conflict={conflict ? "true" : "false"}
                    title={`Last 5 min ${up ? "+" : ""}${Math.round(tapeSpeed.delta)} pts — ${tapeSpeed.ratio.toFixed(1)}× the median 5-min move${conflict ? " · this OPPOSES the plan side" : ""}`}
                    sx={{
                      flexShrink: 0,
                      px: "4px",
                      py: "1px",
                      border: `1px solid ${tone}`,
                      borderRadius: "3px",
                      color: tone,
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: "0.03em",
                      fontFamily: palette.MONO,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {conflict ? "⚠ " : ""}TAPE {up ? "↑" : "↓"} {tapeSpeed.ratio.toFixed(1)}×
                  </Box>
                );
              })() : null}
              <Button
                data-testid="nifty-plan-reasons-button"
                size="xs"
                variant="subtle"
                aria-label="Open the full two-sided desk plan"
                title="Open the full two-sided desk plan (E)"
                onClick={openPlanReasons}
              >
                ▸
              </Button>
            </Box>
  ) : null;

  const deskTabs: DeskDockTab[] = [
    { key: "flow", label: "FLOW", summary: flowSummary, content: flowDockContent },
    { key: "setup", label: "SETUP", summary: setupSummary, content: setupDockContent },
    { key: "alerts", label: "ALERTS", summary: alertsSummary, content: alertsDockContent, badge: criticalCount, height: 340 },
    { key: "market", label: "MARKET", summary: marketSummary, content: marketDockContent },
  ];

  const regime = report?.regime ?? null;
  // Spot-relative flip (the payload's own `zeroCross` is dropped when it
  // disagrees with the cumulative sign at spot). Degraded blocks have no flip.
  const gammaFlip = gexDegraded ? null : gexFlip;
  const flipDelta = report && gammaFlip != null ? report.spot - gammaFlip : null;
  // Near walls only: a far mega-wall is book structure, not an intraday level.
  const callWall = (report?.wallsNear?.calls ?? report?.walls?.calls)?.[0] ?? null;
  // Decision strip is explicitly the MAX-OI wall across the chain — a different
  // concept from the near action wall above (that one feeds the chart/pin).
  // Use the walls payload that feeds the card, not the report's separate
  // snapshot: at 12:42 the two feeds disagreed by one strike on a near-tie
  // (23,000 vs 23,600), so the strip said one max-OI wall while the card's
  // first row showed the other. Same source, same answer.
  const maxCallWall = (walls?.calls?.[0] ?? report?.walls?.calls?.[0]) ?? null;
  const maxPutWall = (walls?.puts?.[0] ?? report?.walls?.puts?.[0]) ?? null;
  const maxCallDistance =
    maxCallWall && report?.spot ? maxCallWall.strike - report.spot : null;
  const maxPutDistance =
    maxPutWall && report?.spot ? maxPutWall.strike - report.spot : null;
  // Stable prop identity: an inline `{ calls, puts }` object defeats
  // NiftyChartPanel's memo and rebuilds every mark line on each 1 Hz tick.
  const maxWallsProp = useMemo(
    () => (walls ? { calls: walls.calls, puts: walls.puts } : null),
    [walls],
  );
  // Pin read (desk playbook §2.16): a wall at spot + max pain on the far side
  // is expiry pinning, where a "break" is usually a sweep. Computed from the
  // near walls so a far mega-wall cannot fake the edge distance.
  const pin = useMemo(
    () =>
      metrics
        ? pinRisk({
            spot: report?.spot,
            maxPain: report?.maxPain,
            wallsNear: report?.wallsNear,
            walls: report?.walls,
            metrics,
          })
        : null,
    [report?.spot, report?.maxPain, report?.wallsNear, report?.walls, metrics],
  );
  // Pre-move tell (2026-10-23 13:30 → 13:37): price pinned under the call wall
  // while that wall's own call OI is being covered. The ceiling is being bought
  // back, so a break above it accelerates instead of capping (the +120 pt
  // squeeze). Shows as a chip beside PIN RISK; absent when the wall is being
  // defended (SB = writers adding).
  const squeezeFuel = useMemo(() => {
    if (pin?.level !== "HIGH" || !callWall) return null;
    const row = (report?.strikes ?? []).find(
      (s) => Math.round(Number(s.strike)) === Math.round(Number(callWall.strike)),
    );
    const sentiment = String(row?.ce?.sentiment ?? "").trim().toUpperCase();
    // Sentiment arrives as the full label ("Short Cover") from the chain and
    // as the compact code ("SC") on the badge — accept both.
    const covering =
      sentiment === "SC" ||
      sentiment === "SHORT COVER" ||
      sentiment === "LU" ||
      sentiment === "LONG UNWIND";
    if (!covering) return null;
    return { strike: Math.round(Number(callWall.strike)), sentiment };
  }, [pin?.level, callWall, report?.strikes]);
  // Replay frames carry candles but not always an `ohlc` block — derive the
  // day range from the bars so the Spot hint never reads "day 0–0". Prefer
  // the chart's `intraday` bars (present on live payloads) over `candles`.
  const dayRange = useMemo(() => {
    const bars = report?.intraday?.length ? report.intraday : (report?.candles ?? []);
    let low = report?.ohlc?.low ?? 0;
    let high = report?.ohlc?.high ?? 0;
    if ((!low || !high) && bars.length > 0) {
      low = Math.min(...bars.map((c) => c.low));
      high = Math.max(...bars.map((c) => c.high));
    }
    return low > 0 && high > 0 ? { low, high } : null;
  }, [report]);

  return (
    <Box
      data-testid="nifty-report-panel"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.25,
        p: 0.5,
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        bgcolor: palette.TERM_BG,
        // Fill the app shell below the in-main toolbar. Grow into spare space
        // AND shrink when the content exceeds the viewport: the chart row owns
        // the slack, so there is no dead band at 1080p and no overflow. The
        // old `flex: 1 0 auto` refused to shrink, so a tall chart pushed the
        // bursts panel 267px below the fold.
        flex: "1 1 auto",
        minHeight: 0,
        // Do NOT set `overflow-x: hidden` here — a lone axis forces the
        // other to `auto`, which silently turned the whole report into a
        // second scroll container (content appeared clipped/shifted relative
        // to the page scrollbar).
        // Numbers are the content on this page — align every column of digits.
        fontVariantNumeric: "tabular-nums",
        // --- Desk skin (report page only) --------------------------------
        // Panels keep a hairline frame + a filled header bar so sections read
        // as a grid; the body stays black (terminal surface) and the spacing
        // comes from the 8px page gap, never from 1px paddings.
        "& [data-compact]": {
          bgcolor: "transparent",
          border: `1px solid ${palette.TERM_BORDER} !important`,
          borderRadius: "4px !important",
          boxShadow: "none",
        },
        // Critical OI bursts present: the trail card gets a red frame so the
        // state reads even when the header badge scrolls out of view. Higher
        // specificity than the flat `[data-compact]` frame above, so it wins
        // despite both being `!important`.
        "& [data-testid='nifty-oi-bursts-wrap'][data-critical='true'] [data-compact]": {
          border: `1px solid ${palette.NEGATIVE} !important`,
        },
        "& [data-compact-header]": {
          minHeight: "22px",
          bgcolor: palette.TERM_HEADER,
          borderBottom: `1px solid ${palette.TERM_BORDER} !important`,
        },
        "& [data-compact-header] .MuiTypography-root": {
          fontSize: "10px !important",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: `${palette.TEXT_MUTED} !important`,
          fontWeight: 700,
          lineHeight: 1.2,
        },
        "& [data-compact-stat]": {
          bgcolor: "transparent !important",
          border: "none !important",
          borderRadius: "0 !important",
          boxShadow: "none !important",
        },
        "& [data-compact-stat] .MuiCardContent-root": {
          p: "0 !important",
          gap: "1px !important",
          alignItems: "flex-start !important",
          textAlign: "left !important",
        },
        "& [data-compact-stat] .MuiTypography-root": { textAlign: "left !important" },
        // Tables: dense but scannable — 10.5px mono numerals, 2/8 padding,
        // 23px rows so the chain reads like a terminal tape.
        "& .paper-tanstack-cell": {
          fontSize: "10.5px !important",
          fontFamily: `${palette.MONO} !important`,
          padding: "2px 8px !important",
          height: "23px !important",
          lineHeight: 1.2,
        },
        "& .paper-tanstack-cell .MuiTypography-root": {
          lineHeight: "1.05 !important",
        },
        "& .paper-tanstack-header-cell": {
          fontSize: "10px !important",
          letterSpacing: "0.05em",
        },
        // --- OI chain: terminal surface ----------------------------------
        // TanStackTable paints SURFACE/SURFACE_ALT by default, so force the
        // terminal tokens here instead of forking the shared table. Cells
        // stay transparent so the ATM row tint (inline style on <tr>) shows
        // through; no lighter card may sit inside this panel.
        "& [data-testid='nifty-oi-panel'] .paper-tanstack-container": {
          bgcolor: `${palette.TERM_BG} !important`,
          border: "none !important",
        },
        "& [data-testid='nifty-oi-panel'] .paper-tanstack-scroll": {
          bgcolor: `${palette.TERM_BG} !important`,
        },
        "& [data-testid='nifty-oi-panel'] .paper-tanstack-table": {
          bgcolor: `${palette.TERM_BG} !important`,
        },
        "& [data-testid='nifty-oi-panel'] .paper-tanstack-header-cell": {
          bgcolor: `${palette.TERM_HEADER} !important`,
          borderColor: `${palette.TERM_BORDER} !important`,
          color: `${palette.TEXT_MUTED} !important`,
        },
        "& [data-testid='nifty-oi-panel'] .paper-tanstack-cell": {
          bgcolor: "transparent !important",
          borderColor: `${palette.TERM_BORDER} !important`,
        },
        // Strike column pins when the table scrolls sideways. Inert at the
        // chain's real widths (the fixed tracks fit the panel, so no
        // h-scroll) — it only engages on narrow viewports. Cells stay
        // transparent so the ATM band still reads through the pinned cell.
        "& [data-testid='nifty-oi-panel'] [id='paper-tanstack-header-strike']": {
          position: "sticky",
          left: oiStrikeStickyLeft,
          zIndex: 3,
        },
        "& [data-testid='nifty-oi-panel'] [id^='paper-tanstack-cell-strike-']": {
          position: "sticky",
          left: oiStrikeStickyLeft,
          zIndex: 1,
        },
      }}
    >
      <CompactPanel padded={false}>
        {/* Single row: nowrap + horizontal scroll keeps every control on one
            ~26px line instead of wrapping to two rows at narrow widths. */}
        <Box
          data-testid="nifty-toolbar"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            px: 1,
            py: 0.25,
            minHeight: 26,
            flexWrap: "nowrap",
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            flexShrink: 0,
            overflowX: "auto",
            // 10px labels + 22px controls for every widget in the row.
            "& .MuiToggleButtonGroup-root": { height: 22, display: "flex" },
            "& .MuiToggleButton-root": {
              px: 0.75,
              py: 0,
              minWidth: 0,
              minHeight: 22,
              height: 22,
              boxSizing: "border-box",
              fontSize: 10,
              lineHeight: 1.1,
              fontWeight: 700,
              letterSpacing: "0.04em",
            },
            "& .MuiButton-root": {
              minHeight: 22,
              height: 22,
              py: 0,
              px: 0.75,
              fontSize: 10,
              lineHeight: 1.1,
            },
            "& .MuiInputBase-root": { height: 22, minHeight: 22, fontSize: 10 },
            "& .MuiSelect-select": { py: 0, fontSize: 10, lineHeight: "22px" },
            "& .MuiSvgIcon-root": { fontSize: 16 },
            "& [data-testid='nifty-updated-at']": { lineHeight: "20px" },
          }}
        >
          <Select
            data-testid="report-symbol-select"
            value={symbol}
            onChange={handleSymbolChange}
            data={SYMBOL_SELECT_DATA}
            size="xs"
            h={22}
            sx={SYMBOL_SELECT_SX}
          />
          {symbol === "NIFTY" && (
            <SegmentedControl
              data-testid="nifty-index-toggle"
              value={selectedIndex}
              onChange={handleIndexChange}
              data={INDEX_TOGGLE_DATA}
              size="xs"
            />
          )}
          {/* EOD/HISTORY: unhidden for any underlying that actually has a
              recorded day — the toggle would otherwise promise history that
              does not exist. */}
          {hasRecordedHistory && (
            <SegmentedControl
              data-testid="nifty-mode-toggle"
              value={mode}
              onChange={handleModeChange}
              data={MODE_TOGGLE_DATA}
              size="xs"
            />
          )}
          <SegmentedControl
            data-testid="nifty-view-toggle"
            value={view}
            onChange={handleViewChange}
            data={VIEW_TOGGLE_DATA}
            size="xs"
          />
          <SegmentedControl
            data-testid="nifty-desk-toggle"
            value={deskMode}
            onChange={handleDeskChange}
            data={DESK_TOGGLE_DATA}
            size="xs"
          />
          <Select
            data-testid="nifty-expiry-select"
            value={expiry}
            onChange={handleExpiryChange}
            data={expiryData}
            size="xs"
            h={22}
            sx={EXPIRY_SELECT_SX}
          />
          {mode === "eod" && (
            <TextInput
              data-testid="nifty-date-input"
              type="date"
              value={date}
              onChange={setDate}
              size="xs"
              w={110}
              h={22}
            />
          )}
          {/* The recorded tape/chain10s/replay is captured against the nearest
              expiry, so a non-nearest selection only changes the LIVE chain. */}
          {symbol !== "NIFTY" && expiry !== "nearest" && (
            <Box
              component="span"
              data-testid="nifty-generic-expiry-note"
              title="Recorded history (tape, OI stream, replay) is captured for the nearest expiry — the selected expiry applies to the live chain only."
              sx={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.04em",
                color: palette.TEXT_MUTED,
                border: `1px solid ${palette.TERM_BORDER}`,
                borderRadius: "3px",
                px: 0.5,
                whiteSpace: "nowrap",
              }}
            >
              history = nearest expiry
            </Box>
          )}
          <Box sx={{ flex: 1, minWidth: 8 }} />
          <SimDesk
            symbol={symbol}
            mode={mode}
            date={date}
            report={report}
            replay={replay}
            replayIndex={replayIndex}
          />
          <NiftyPositionsDrawer
            positions={paperPositions}
            strikes={report?.strikes}
            onRefresh={refreshPaperPositions}
          />
          <Button
            data-testid="nifty-refresh-button"
            size="xs"
            onClick={handleRefresh}
            disabled={loading || (mode === "eod" && !date)}
          >
            Refresh
          </Button>
          {mode === "live" && updatedAtMs !== null && (
            <NiftyUpdatedLabel
              marketClosed={marketClosed}
              sessionDate={report?.market?.session_date}
              updatedAtMs={updatedAtMs}
              isStale={isStale}
            />
          )}
          {mode === "live" && (
            <NiftyDataFreshness
              report={report}
              tape={tape}
              bursts={effectiveBursts}
              marketOpen={!marketClosed}
              sessionDate={report?.market?.session_date ?? tape?.date ?? report?.date}
            />
          )}
          {isStale && (
            <Box
              component="span"
              data-testid="nifty-stale-badge"
              sx={{
                display: "inline-block",
                border: "1px solid",
                borderColor: palette.WARNING,
                borderRadius: 999,
                px: 1,
                py: 0.25,
                whiteSpace: "nowrap",
              }}
            >
              <Text size="xs" fw={700} c="warning" span>
                STALE {staleMins}m
              </Text>
            </Box>
          )}
          <Button
            data-testid="nifty-snapshot-button"
            size="xs"
            variant="outline"
            onClick={() => void handleSnapshot()}
            disabled={
              snapshotting || loading || mode === "eod" || symbol !== "NIFTY"
            }
            title={
              symbol !== "NIFTY"
                ? "Snapshots are recorded for NIFTY only"
                : mode === "eod"
                  ? "Only available in Live mode — an EOD date is history, not a snapshot"
                  : "Capture the current option chain"
            }
          >
            Snapshot
          </Button>
          <NiftyDeskGuide />
        </Box>
        {/* EOD minute replay — scrub/play the day's recorded frames. Only
            rendered when a replay actually exists for the picked date; live
            mode (and days without recordings) never mount the bar. */}
        {mode === "eod" && replay !== null && replay.snapshots.length > 0 && (
          <NiftyReplayBar
            replay={replay}
            replayIndex={replayIndex}
            playing={replayPlaying}
            coverage={replayCoverage}
            reasons={replayReasons}
            holes={replayHoles}
            onScrub={scrubReplay}
            onTogglePlay={handleReplayPlayToggle}
          />
        )}
      </CompactPanel>

      {loading && !report && <InlineLoader data-testid="nifty-loading" />}

      {error && !loading && !report && (
        <ErrorAlert
          data-testid="nifty-error"
          title={`${symbol} report failed`}
          message={error}
          withRetry
          onRetry={handleRefresh}
        />
      )}

      {!loading && !error && !report && (
        <EmptyCompact
          data-testid="nifty-empty"
          title={`No ${symbol} data`}
          description={
            mode === "eod" && !date
              ? "Pick a date to load the EOD report."
              : `Refresh to load the latest ${symbol} option-chain report.`
          }
        />
      )}

      {report && (
        <>
          {selectedIndex === "nifty" || symbol !== "NIFTY" ? (
          <>
          {symbol === "NIFTY" && preMoveAlert ? (
            <Box
              role="alert"
              aria-live="polite"
              data-testid="nifty-premove-alert"
              data-flip-paused={currentFlip.flipped ? "1" : "0"}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                px: 1,
                minHeight: 28,
                flexShrink: 0,
                border: `1px solid ${palette.WARNING}`,
                borderLeft: `3px solid ${palette.WARNING}`,
                borderRadius: "4px",
                bgcolor: hexToRgba(palette.WARNING, 0.08),
                fontFamily: palette.MONO,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <Box component="span" sx={{ fontWeight: 800, fontSize: 12, color: palette.WARNING }}>
                {setupBannerHeadline(
                  currentFlip.flipped,
                  currentFlip.reason,
                  preMoveAlert.score,
                  preMoveAlert.max,
                )}
              </Box>
              <Box component="span" sx={{ fontSize: 10, color: palette.TEXT_MUTED }}>
                {currentFlip.flipped
                  ? "5m leg disagrees with the 15m/session read — waiting for alignment"
                  : preMoveAlert.components
                      .map((c) => `${c.points > 0 ? "+" : ""}${c.points} ${c.label}`)
                      .join(" · ")}
              </Box>
              <Box
                component="span"
                role="button"
                aria-label="Dismiss setup arming"
                onClick={() => setPreMoveAlert(null)}
                sx={{ ml: "auto", cursor: "pointer", color: palette.TEXT_MUTED, "&:hover": { color: palette.TEXT } }}
              >
                ×
              </Box>
            </Box>
          ) : null}
          {symbol === "NIFTY" && blast ? (
            <Box
              role="alert"
              aria-live="assertive"
              data-testid="nifty-blast"
              data-kind={blast.kind}
              data-bias={blast.bias}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                px: 1,
                minHeight: 28,
                flexShrink: 0,
                border: `1px solid ${blast.bias === "bull" ? palette.POSITIVE : blast.bias === "bear" ? palette.NEGATIVE : palette.WARNING}`,
                borderLeft: `3px solid ${blast.bias === "bull" ? palette.POSITIVE : blast.bias === "bear" ? palette.NEGATIVE : palette.WARNING}`,
                borderRadius: "4px",
                bgcolor: hexToRgba(
                  blast.bias === "bull" ? palette.POSITIVE : blast.bias === "bear" ? palette.NEGATIVE : palette.WARNING,
                  0.08,
                ),
                fontFamily: palette.MONO,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <Box
                component="span"
                data-testid="nifty-blast-label"
                sx={{
                  fontWeight: 800,
                  fontSize: 12,
                  letterSpacing: "0.02em",
                  color: blast.bias === "bull" ? palette.POSITIVE : blast.bias === "bear" ? palette.NEGATIVE : palette.WARNING,
                }}
              >
                ⚡ {blast.label}
              </Box>
              <Box component="span" sx={{ fontSize: 10, color: palette.TEXT_MUTED }}>
                {blast.detail} ·{" "}
                {formatReportClock(Date.parse(blast.t))}
              </Box>
              <Box
                component="span"
                role="button"
                aria-label="Dismiss blast"
                onClick={dismissBlast}
                sx={{ ml: "auto", cursor: "pointer", color: palette.TEXT_MUTED, "&:hover": { color: palette.TEXT } }}
              >
                ×
              </Box>
            </Box>
          ) : null}
          {/* Sticky critical OI-unwind banners — above the verdict strip so a
              session-defining unwind can never hide in the trail card. Newest
              first, capped by the hook; X or the 5-minute timer dismisses. */}
          {visibleBanners.length > 0 && (
            <Box
              data-testid="nifty-critical-banners"
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 0.5,
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                flexShrink: 0,
              }}
            >
              {visibleBanners.map((a) => {
                const bullish = a.title.includes("BUY CE");
                const accent = bullish ? palette.POSITIVE : palette.NEGATIVE;
                return (
                  <Box
                    key={a.id}
                    role="alert"
                    aria-live="assertive"
                    aria-atomic="true"
                    aria-label={`Critical OI unwind — ${a.title}`}
                    data-testid="nifty-critical-banner"
                    data-severity="critical"
                    onClick={isDesk ? openAlertsDock : scrollToBursts}
                    title={`${a.title} — ${a.detail}`}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                      px: 1,
                      minHeight: 28,
                      border: `1px solid ${accent}`,
                      borderLeft: `3px solid ${accent}`,
                      borderRadius: "4px",
                      bgcolor: hexToRgba(accent, 0.08),
                      cursor: "pointer",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <Box
                      component="span"
                      data-testid="nifty-critical-banner-time"
                      sx={{
                        color: palette.TEXT_MUTED,
                        fontSize: 10,
                        fontWeight: 700,
                        fontFamily: palette.MONO,
                        flexShrink: 0,
                      }}
                      title={`Fired ${new Date(a.ts).toLocaleString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" })}`}
                    >
                      {new Date(a.ts).toLocaleTimeString("en-IN", {
                        hour12: false,
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Kolkata",
                      })}
                    </Box>
                    <Box
                      component="span"
                      data-testid="nifty-critical-banner-text"
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: "0.02em",
                        fontFamily: palette.MONO,
                        color: accent,
                      }}
                    >
                      {criticalBannerText(burstById.get(a.id), a)}
                      {isDesk && bannerOverflow > 0 ? ` +${bannerOverflow} more` : ""}
                    </Box>
                    {/* A burst alert is an ENTRY instruction ("BUY PE …"). When
                        the frame is pinned (playbook §2.16) that instruction is
                        the exact trade that sweeps, so say so on the banner
                        instead of leaving the read to the stat strip. */}
                    {pin?.level === "HIGH" ? (
                      <Box
                        component="span"
                        data-testid="nifty-critical-banner-pin"
                        title={pin.detail}
                        sx={{
                          flexShrink: 0,
                          px: 0.5,
                          py: "1px",
                          border: `1px solid ${palette.WARNING}`,
                          borderRadius: "3px",
                          bgcolor: hexToRgba(palette.WARNING, 0.14),
                          color: palette.WARNING,
                          fontSize: 9.5,
                          fontWeight: 800,
                          letterSpacing: "0.04em",
                          fontFamily: palette.MONO,
                          whiteSpace: "nowrap",
                        }}
                      >
                        ⚠ PIN — SWEEP RISK
                      </Box>
                    ) : null}
                    <IconButton
                      size="small"
                      aria-label="Dismiss critical banner"
                      data-testid="nifty-critical-banner-dismiss"
                      onClick={(e) => {
                        e.stopPropagation();
                        dismissBanner(a.id);
                      }}
                      sx={{ p: "2px", color: palette.TEXT_MUTED, borderRadius: 0, "&:hover": { color: palette.TEXT } }}
                    >
                      <IconX size={13} />
                    </IconButton>
                  </Box>
                );
              })}
            </Box>
          )}
          {/* PLAN one-liner: the desk verdict in one row; the full two-sided
              plan opens in a modal. Rendered in both modes, directly under
              the critical banners. */}
          <Box
            data-testid="nifty-stat-strip"
            sx={{
              display: "flex",
              flexDirection: "column",
              border: `1px solid ${palette.TERM_BORDER}`,
              borderRadius: "4px",
              bgcolor: palette.TERM_HEADER,
              overflow: "hidden",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
            <Box
              sx={{
                display: "flex",
                flexWrap: { xs: "wrap", lg: "nowrap" },
                alignItems: "stretch",
                minWidth: 0,
                minHeight: 28,
              }}
            >
              <Box
                data-testid="nifty-decision-stats"
                sx={{
                  display: "flex",
                  flexWrap: "wrap",
                  flex: "1 1 auto",
                  minWidth: 0,
                }}
              >
                <DecisionCell
                  testId="nifty-stat-spot"
                  label="Spot"
                  value={<NiftySpotValue live={mode === "live"} fallback={report.spot} />}
                  valueSize={15}
                  hint={
                    dayRange
                      ? `day ${formatNumberIN(Math.round(dayRange.low))}–${formatNumberIN(Math.round(
                          dayRange.high,
                        ))}`
                      : "intraday range"
                  }
                  title="NIFTY 50 spot, with today's low–high range underneath."
                />
                <DecisionCell
                  testId="nifty-stat-regime"
                  label="Regime"
                  value={regime?.verdict ? resolveRegimeLabel(regime.verdict, regime) : "—"}
                  hint={regimeDetail(regime)}
                  accent={regimeAccent(regime?.verdict)}
                  title="Volatility regime: sell premium in a range (realised < implied), buy premium in expansion (realised > implied)."
                />
                <DecisionCell
                  testId="nifty-stat-flip"
                  label="γ flip"
                  value={
                    gexDegraded
                      ? "n/a"
                      : gammaFlip != null
                        ? formatInt(gammaFlip)
                        : "—"
                  }
                  hint={
                    gexDegraded
                      ? "no option greeks in this snapshot"
                      : flipDelta != null
                        ? `spot ${formatSignedPoints(flipDelta)}`
                        : "no zero-γ cross"
                  }
                  accent={palette.TERM_FLIP}
                  title="Gamma flip (GEX zero-γ): strike where cumulative dealer gamma crosses zero at spot. Above it dealers damp moves; below it they amplify. Hint is spot minus the flip."
                />
                <DecisionCell
                  testId="nifty-stat-call-wall"
                  label="Max-OI call"
                  value={maxCallWall ? formatInt(maxCallWall.strike) : "—"}
                  hint={
                    maxCallWall
                      ? `CE OI ${formatOiCr(maxCallWall.oi)}${
                          maxCallDistance != null && Number.isFinite(maxCallDistance)
                            ? ` · ${maxCallDistance > 0 ? "+" : ""}${Math.round(maxCallDistance)} pts`
                            : ""
                        }`
                      : "no call OI"
                  }
                  accent={palette.TERM_CE}
                  title="Heaviest OI across the chain (not the nearest strike). Max-OI call wall is the dealers' upside hedge; the distance from spot is shown next to the OI."
                />
                <DecisionCell
                  testId="nifty-stat-put-wall"
                  label="Max-OI put"
                  value={maxPutWall ? formatInt(maxPutWall.strike) : "—"}
                  hint={
                    maxPutWall
                      ? `PE OI ${formatOiCr(maxPutWall.oi)}${
                          maxPutDistance != null && Number.isFinite(maxPutDistance)
                            ? ` · ${maxPutDistance > 0 ? "+" : ""}${Math.round(maxPutDistance)} pts`
                            : ""
                        }`
                      : "no put OI"
                  }
                  accent={palette.TERM_PE}
                  title="Heaviest OI across the chain (not the nearest strike). Max-OI put wall is the dealers' downside hedge; the distance from spot is shown next to the OI."
                />
                {/* Pin risk (§2.16): the one read that says "a break here is a
                    sweep, not a trend". Sits beside the walls because it is
                    derived from them + max pain. */}
                <DecisionCell
                  testId="nifty-stat-pin"
                  label="Pin risk"
                  value={pin ? pin.level : "—"}
                  hint={pin ? pinHint(pin) : "spot / max pain missing"}
                  accent={
                    pin?.level === "HIGH"
                      ? palette.WARNING
                      : pin?.level === "MEDIUM"
                        ? palette.TEXT
                        : palette.TEXT_MUTED
                  }
                  title="Pin detection: a wall at spot AND max pain at least 100 pts on the far side means the market is being pinned into expiry. A break there is usually a sweep — sell the range, and only buy a break after two consecutive 1-min closes beyond the wall."
                />
                {/* The pre-move tell: a pinned market whose ceiling is being
                    covered is a squeeze setup, not a fade. */}
                {squeezeFuel ? (
                  <DecisionCell
                    testId="nifty-squeeze-fuel"
                    label="Squeeze"
                    value="FUEL ↑"
                    hint={`${squeezeFuel.strike} call wall is ${squeezeFuel.sentiment === "SC" ? "short-covering" : "unwinding"} — a break above it accelerates`}
                    accent={palette.WARNING}
                    title="Squeeze fuel: price is pinned under the call wall and that wall's call OI is being covered (SC/LU). Writers are buying back the ceiling, so a break above it is fuel, not a cap. Inverse of a defended wall (SB)."
                  />
                ) : null}
              </Box>
              <Box
                data-testid="nifty-context-stats"
                sx={{
                  display: "flex",
                  alignItems: "stretch",
                  flexShrink: 0,
                  marginLeft: "auto",
                }}
              >
                <ContextCell
                  testId="nifty-stat-pcr-oi"
                  label="PCR (OI)"
                  value={
                    <>
                      <AnimatedValue value={report.pcrOi} format={format2dp} />
                      <Sparkline
                        values={pcrSeries}
                        testId="nifty-pcr-spark"
                        color={palette.TERM_CE}
                      />
                    </>
                  }
                />
                <ContextCell
                  testId="nifty-stat-pcr-vol"
                  label="PCR (Vol)"
                  value={<AnimatedValue value={report.pcrVol} format={format2dp} />}
                />
                <ContextCell
                  testId="nifty-stat-max-pain"
                  label="Max pain"
                  value={
                    <>
                      <AnimatedValue value={report.maxPain} format={formatInt} />
                      <Sparkline
                        values={maxPainSeries}
                        testId="nifty-maxpain-spark"
                        color={palette.PRIMARY}
                      />
                    </>
                  }
                />
              </Box>
              {isDesk && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, flexShrink: 0, pl: 0.5 }}>
                  <DecisionChip
                    testId="nifty-chip-setup"
                    label="SETUP"
                    value={setupSummary}
                    onClick={() => setDeskDockTab("setup")}
                  />
                  <DecisionChip
                    testId="nifty-chip-intel"
                    label="INTEL"
                    value="FII/DII"
                    onClick={() => setDeskDockTab("market")}
                  />
                  <DecisionChip
                    testId="nifty-chip-gamma"
                    label="Γ"
                    value={
                      gexDegraded
                        ? "n/a"
                        : `${gexForDisplay?.regime === "short" ? "SHORT" : "LONG"} ${gammaFlip != null ? formatInt(gammaFlip) : "—"}`
                    }
                    onClick={() => setGammaOpen(true)}
                    tone={gexForDisplay?.regime === "short" ? palette.NEGATIVE : palette.POSITIVE}
                  />
                </Box>
              )}
            </Box>
            <Box
              data-testid="nifty-verdict-wrap"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                minWidth: 0,
                height: 24,
                overflow: "hidden",
              }}
            >
              <Box sx={{ flex: "1 1 0", minWidth: 0, display: "flex" }}>
                <NiftyVerdictStrip report={report} mode="context" />
              </Box>
              {/* The payload's `vix` block is India VIX for every underlying
                  (source: INDIA_VIX) — say so when it is not the NIFTY desk. */}
              {symbol !== "NIFTY" && (
                <Box
                  component="span"
                  data-testid="nifty-india-vix-label"
                  title="VIX source: INDIA_VIX — this is India VIX, not a US VIX."
                  sx={{
                    flexShrink: 0,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    color: palette.TEXT_MUTED,
                    border: `1px solid ${palette.TERM_BORDER}`,
                    borderRadius: "3px",
                    px: 0.5,
                    py: "1px",
                    whiteSpace: "nowrap",
                  }}
                >
                  INDIA VIX
                </Box>
              )}
              {isDesk && planOneLiner && (
                <Box sx={{ flex: "1.2 1 0", minWidth: 0, "& > *": { width: "100%", minWidth: 0 } }}>
                  {planOneLiner}
                </Box>
              )}
            </Box>
          </Box>

          {/* SESSION vs 15m/5m flow. The single session label could read
              CALL BUYING while the last 5m was a put build — the exact flip
              this row names, instead of contradicting the heatmap. */}
          <NiftyFlowWindows
            report={flowReport}
            lastFlip={lastFlip}
            showSessionValue={symbol === "NIFTY"}
          />

          {/* Index movers: compact top/bottom 3; EXPAND opens the full table.
              RELIANCE is a single stock, so it has no index movers. */}
          {(symbol === "NIFTY" || symbol === "SENSEX") && (
            <IndexMoversStrip
              index={symbol}
              onExpand={openMovers}
              liveOnly={mode === "eod" || report?.market?.is_open === false}
            />
          )}

          {/* Official Upstox intel (FII/DII, ΔOI, max pain, PCR, news) — a 24px
              strip under the context row; the drawer holds the strike/news
              detail. Both modes keep it: it is external truth beside our own
              chain metrics, not a desk-only luxury. The frame's session is
              passed through, so an EOD/replay frame reads ITS OWN FII/DII
              instead of silently mixing in today's. */}
          {/* ONE context rail instead of three stacked strips: desk plan ·
              official intel · dealer gamma. Same information, ~44px less
              chrome and two fewer border rows above the chart. */}
          {!isDesk && (
          <Box
            data-testid="nifty-context-rail"
            sx={{
              display: "flex",
              alignItems: "stretch",
              gap: "2px",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
            {planOneLiner && (
              <Box
                sx={{
                  flex: "38 1 0",
                  minWidth: 0,
                  display: "flex",
                  "& > *": { width: "100%", minWidth: 0 },
                }}
              >
                {planOneLiner}
              </Box>
            )}
            {symbol === "NIFTY" && (
              <Box
                data-testid="nifty-intel-cell"
                sx={{
                  flex: "34 1 0",
                  minWidth: 0,
                  display: "flex",
                  "& > *": { width: "100%", minWidth: 0 },
                }}
              >
                <NiftyIntelStrip
                  date={mode === "eod" ? date || null : null}
                  expiry={expiry === "nearest" ? null : expiry}
                  eod={mode === "eod"}
                />
              </Box>
            )}
            <Box
              data-testid="nifty-gamma-cell"
              sx={{
                flex: "28 1 0",
                minWidth: 0,
                display: "flex",
                "& > *": { width: "100%", minWidth: 0 },
              }}
            >
              <NiftyGammaStrip
                gex={gexForDisplay}
                positioning={report.positioning}
                spot={report.spot}
              />
            </Box>
          </Box>

          )}

          {/* Pre-move radar: five gates + score. Reads the same tape as the
              flow strip, so it costs no request. ARMED = prepare, TRIGGER =
              the wall is actually being covered. The squeeze radar adds the
              "how near" proximity gauge and a labelled score history. */}
          {!isDesk && <SetupRadarStrip read={setup} preMove={preMove} />}
          {!isDesk && (
            <NiftySqueezeRadar
              report={report}
              preMove={preMove}
              setup={setup}
              history={preMoveHistory}
              wallHistory={mode === "live" ? wallHistory : EMPTY_WALL_HISTORY}
              spotMove1m={spotMove1m}
              walls={walls}
            />
          )}

          {/* Nearest call/put wall erosion: OI, volume, premium flow, fuel
              score and time-to-break. The card below keeps the full table. */}
          <NiftyWallErosionBoard
            walls={walls}
            symbol={symbol}
            asOf={mode === "eod" ? replay?.snapshots?.[replayIndex]?.t ?? null : null}
          />

          {/* Wall erosion / 0-DTE pin state: backend-computed, all walls in
              one place, expandable to the full erosion matrix. */}
          <NiftyWallsCard
            walls={walls}
            onExpand={openWalls}
            emptyText={mode === "eod" ? "No tape at this replay time." : "Waiting for walls data."}
            levels={symbol === "NIFTY" ? <LevelsInPlayContent report={report} sensex={sensex} /> : undefined}
          />
          <NiftyWallsExpanded
            open={wallsOpen}
            walls={walls}
            onClose={closeWalls}
            onReplayBreak={mode === "eod" && replay ? handleReplayBreak : undefined}
          />
          {(symbol === "NIFTY" || symbol === "SENSEX") && (
            <IndexMoversModal
              open={moversOpen}
              onClose={closeMovers}
              index={symbol}
            />
          )}

          {/* Full two-sided plan inline in research mode only; desk mode
              keeps the one-liner above and opens this same component in a
              modal so the first screen fits 1080p. */}
          {!isDesk && <NiftyDeskPlan report={report} />}

          {/* Levels for NIFTY live inside the WALLS card above (levels prop).
              Sensex levels live on the SENSEX tab (`sensex-focus-panel`). */}

          {/* Live OI-burst toasts — normal flow, never fixed. A fixed stack sat
              on top of the FLOW strip and the OI-bursts log at short viewports
              (the toast column covered ~62px of live content). In flow the page
              scrolls instead, the Dismiss buttons stay reachable, and the stack
              still renders above the alert log in document order. */}
          {toasts.length > 0 && (
            <Box
              data-testid="nifty-oi-toasts"
              sx={{
                width: "100%",
                maxWidth: 620,
                minWidth: 0,
                alignSelf: "flex-end",
                flexShrink: 0,
              }}
            >
              <MarketAlertStack
                alerts={toasts}
                max={OI_ALERT_TOAST_MAX}
                onDismiss={dismissToast}
                onOpen={scrollToBursts}
              />
            </Box>
          )}

        <Box
          data-testid="nifty-main-row"
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              // The chain is a fixed-column table whose tracks are a hard
              // floor. DESK shows five tracks (396px) so its rail only needs
              // ~420px; RESEARCH keeps the seven-track chain at 624px. Every
              // pixel left over goes to the chart.
              lg: isDesk
                ? "minmax(0, 1fr) minmax(0, 420px)"
                : "minmax(0, 1fr) minmax(0, 624px)",
            },
            gridTemplateRows: "minmax(0, 1fr)",
            gap: 0,
            alignItems: "stretch",
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            // Absorb all spare viewport height: the chart (and its paired
            // OI column) is the elastic row; everything below keeps its
            // compact height so the bursts footer sits on the screen edge.
            flex: "1 1 auto",
            minHeight: 300,
            // DESK caps the upper row so the FLOW band below owns the slack.
            // Fill mode caps the chart body at 300px (300 + 48 chrome = 348);
            // S/M/L/XL raise the row to the chosen preset + chrome.
            ...(isDesk && chartSize !== "fill" ? { maxHeight: chartRowHeight } : {}),
            overflow: "hidden",
          }}
        >
          <NiftyChartPanel
            report={report}
            bursts={detectedBursts}
            tape={tape}
            spotPoints={oiPoints}
            flipAt={flipAt}
            maxWalls={maxWallsProp}
            mode={mode}
            view={view}
            symbol={symbol}
            asOf={mode === "eod" ? replay?.snapshots[replayIndex]?.t : undefined}
            timeframe={chartTf}
            onTimeframeChange={handleChartTf}
            onSizeChange={handleChartSize}
            onExpand={openChartFull}
            fillContainer={isDesk && chartSize === "fill"}
          />

          {/* Right rail: one surface, two tabs. The chain owns the full height
              by default; the heatmap takes the same space on demand instead of
              permanently stealing 175px from the chain. */}
          <Box
            data-testid="nifty-side-col"
            sx={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}
          >
            {isDesk && (
              <Box
                data-testid="nifty-side-tabs"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.25,
                  height: 20,
                  minHeight: 20,
                  px: 0.25,
                  bgcolor: palette.TERM_HEADER,
                  borderBottom: `1px solid ${palette.TERM_BORDER}`,
                }}
              >
                <Button
                  data-testid="nifty-side-tab-chain"
                  size="sm"
                  variant={sideTab === "chain" ? "filled" : "subtle"}
                  aria-pressed={sideTab === "chain"}
                  onClick={() => setSideTab("chain")}
                  sx={{ height: 18, minWidth: 0, px: 0.6, py: 0, fontSize: 8, fontWeight: 800, letterSpacing: 0.4 }}
                >
                  CHAIN
                </Button>
                <Button
                  data-testid="nifty-side-tab-heatmap"
                  size="sm"
                  variant={sideTab === "heatmap" ? "filled" : "subtle"}
                  aria-pressed={sideTab === "heatmap"}
                  onClick={() => setSideTab("heatmap")}
                  sx={{ height: 18, minWidth: 0, px: 0.6, py: 0, fontSize: 8, fontWeight: 800, letterSpacing: 0.4 }}
                >
                  HEATMAP
                </Button>
              </Box>
            )}

            {(!isDesk || sideTab === "chain") && (
              <Box sx={{ flex: "1 1 auto", minHeight: 0, minWidth: 0, display: "flex", "& > *": { flex: 1, minWidth: 0, minHeight: 0 } }}>
                <NiftyOiChain
                  strikes={visibleStrikes}
                  columns={oiColumns}
                  getRowStyle={getOiRowStyle}
                  getRowTestId={getOiRowTestId}
                  panelTestId="nifty-oi-panel"
                  tableTestId="nifty-oi-table"
                  wrapTestId="nifty-oi-wrap"
                  wrapRef={oiWrapRef}
                  onExpand={openOiExpand}
                />
              </Box>
            )}

            {isDesk && sideTab === "heatmap" && (
              <Box
                data-testid="nifty-chart-side-heatmap"
                sx={{
                  position: "relative",
                  flex: "1 1 auto",
                  minHeight: 0,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <Box
                  data-testid="nifty-heatmap-metric-toggle"
                  sx={{ display: "flex", gap: "2px", alignItems: "center", height: 18, flexShrink: 0, px: 0.25, mb: "1px" }}
                >
                  {(["oi", "volume", "premium"] as const).map((m) => (
                    <Button
                      key={m}
                      data-testid={`nifty-heatmap-metric-${m}`}
                      size="sm"
                      variant={heatMetric === m ? "filled" : "subtle"}
                      aria-pressed={heatMetric === m}
                      title={m === "oi" ? "Colour by OI change" : m === "volume" ? "Colour by traded volume" : "Colour by premium change"}
                      onClick={() => setHeatMetric(m)}
                      sx={{ minWidth: 26, px: "3px", py: 0, fontSize: 8.5, lineHeight: 1.4 }}
                    >
                      {m === "oi" ? "OI" : m === "volume" ? "VOL" : "PREM"}
                    </Button>
                  ))}
                  <Typography sx={{ ml: "auto", mr: 2.5, fontSize: 7.5, color: palette.TEXT_MUTED }}>
                    OI change
                  </Typography>
                </Box>
                <Box
                  data-testid="nifty-heatmap-wrap"
                  sx={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex" }}
                >
                  <NiftyOiHeatmap
                    rows={tapeRows}
                    bucketMin={1}
                    widthPts={metrics?.heatmapWidthPts ?? 250}
                    viewBoxHeight={240}
                    metric={heatMetric}
                    startTime={intradayStart}
                    flipAt={flipAt}
                  />
                </Box>
                <Button
                  data-testid="nifty-heatmap-expand"
                  size="sm"
                  variant="subtle"
                  aria-label="Expand the OI heatmap"
                  title="Expand the OI heatmap"
                  onClick={() => setHeatExpand(true)}
                  sx={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    width: 22,
                    height: 18,
                    minWidth: 22,
                    px: 0,
                    py: 0,
                    lineHeight: "18px",
                    fontSize: 11,
                    bgcolor: palette.TERM_HEADER,
                    zIndex: 3,
                  }}
                >
                  ⤢
                </Button>
              </Box>
            )}
          </Box>
          </Box>

          {/* Desk dock: FLOW / SETUP / ALERTS / MARKET. The chart row keeps
              the full height; the dock tab bar is always visible and opens one
              bottom drawer at a time. */}
          {isDesk && (
            <DeskDock tabs={deskTabs} active={deskDockTab} onActiveChange={setDeskDockTab} />
          )}

          {!isDesk && (
          <Box
            data-testid="nifty-analytics-row"
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 2fr) minmax(0, 1fr)" },
              alignItems: "stretch",
              gap: 0,
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
            <Box sx={ANALYTICS_FILL_CELL_SX}>
              <NiftyDeltaPositioning
                positioning={report.positioning}
                spot={report.spot}
              />
            </Box>
            <Box sx={{ ...ANALYTICS_CELL_SX, position: "relative" }}>
              <NiftyGexProfile gex={gexForDisplay} spot={report.spot} />
              <IconButton
                data-testid="nifty-gex-expand"
                aria-label="Expand GEX profile"
                title="Expand"
                size="small"
                onClick={() => setGexOpen(true)}
                sx={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  p: "2px",
                  color: palette.TEXT_MUTED,
                  bgcolor: palette.TERM_HEADER,
                  "&:hover": { color: palette.TEXT },
                }}
              >
                <Text span size="xs" fw={700} style={{ fontSize: 12, lineHeight: 1 }}>
                  ⤢
                </Text>
              </IconButton>
            </Box>
          </Box>
          )}

          {/* Vol surface row: per-strike IV smile (left, ≤60%) beside the
              OI tick tape (right). The 3fr/2fr split keeps the smile's wings
              readable at 1280–1920px without squeezing the tape. */}
          {!isDesk && (
          <Box
            data-testid="nifty-iv-skew-row"
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "minmax(0, 1fr)",
                lg: "minmax(0, 3fr) minmax(0, 2fr)",
              },
              gap: 0,
              alignItems: "stretch",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
            <Box sx={{ minWidth: 0, minHeight: 0, position: "relative" }}>
              <NiftyIvSkew strikes={report.strikes} spot={report.spot} />
              <IconButton
                data-testid="nifty-ivskew-expand"
                aria-label="Expand IV skew"
                title="Expand"
                size="small"
                onClick={() => setIvOpen(true)}
                sx={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  p: "2px",
                  color: palette.TEXT_MUTED,
                  bgcolor: palette.TERM_HEADER,
                  "&:hover": { color: palette.TEXT },
                }}
              >
                <Text span size="xs" fw={700} style={{ fontSize: 12, lineHeight: 1 }}>
                  ⤢
                </Text>
              </IconButton>
            </Box>
          <CompactPanel flush title="OI · tick tape" testId="nifty-tape-panel" sx={{ minWidth: 0, background: palette.TERM_BG, borderColor: palette.TERM_BORDER }}>
            {tape && tapeRows.length > 0 ? (
              <NiftyTapeTable
                rows={tapeRows}
                tape={tape}
                live={mode === "live"}
                bursts={burstMap}
                updatedAtMs={mode === "live" ? updatedAtMs : null}
                nextUpdateAtMs={nextUpdateAtMs}
              />
            ) : (
              <Text data-testid="nifty-tape-empty" size="sm" c="dimmed">
                Tape starts recording at next market open.
              </Text>
            )}
          </CompactPanel>
          </Box>
          )}

          {/* RESEARCH FLOW row: wall migration beside participant flow.
              Additive — the IV skew / GEX / delta panels above are untouched. */}
          {!isDesk && (
          <Box
            data-testid="nifty-flow-row"
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "repeat(2, minmax(0, 1fr))" },
              gap: 0,
              alignItems: "start",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <NiftyWallMigration rows={tapeRows} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <NiftyParticipantFlow rows={tapeRows} />
            </Box>
          </Box>
          )}

          {/* RESEARCH VOL row: volume profile beside P&L attribution. The P&L
              reads the LIVE paper book, so it is hidden in EOD — a replay
              frame has no matching book/fills (and labelling stale live P&L
              as "this frame" would be a lie). */}
          {!isDesk && (
          <Box
            data-testid="nifty-vol-row"
            sx={{
              display: "grid",
              gridTemplateColumns:
                mode === "live"
                  ? { xs: "minmax(0, 1fr)", lg: "repeat(2, minmax(0, 1fr))" }
                  : "minmax(0, 1fr)",
              gap: 0,
              alignItems: "start",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <NiftyVolumeProfile rows={tapeRows} spot={report.spot} />
            </Box>
            {mode === "live" && (
              <Box sx={{ minWidth: 0 }}>
                <NiftyPnlAttribution
                  positions={pnlPositions}
                  greeks={pnlGreeks}
                  spot={report.spot}
                />
              </Box>
            )}
          </Box>
          )}

          {/* Progressive disclosure: the decision surface above is enough to
              trade; the slower session forensics live here. Nothing unmounts,
              so opening the section is instant and charts keep their state. */}
          {!isDesk && (
          <Box
            data-testid="nifty-detail"
            sx={{
              border: `1px solid ${palette.TERM_BORDER}`,
              borderRadius: "4px",
              bgcolor: palette.TERM_HEADER,
              overflow: "hidden",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
            <Button
              data-testid="nifty-detail-toggle"
              variant="subtle"
              size="sm"
              aria-expanded={detailOpen}
              aria-controls="nifty-detail-body"
              onClick={toggleDetail}
              sx={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                px: 1.5,
                py: 0.5,
                borderRadius: 0,
                textTransform: "none",
              }}
            >
              <Box
                component="span"
                sx={{ display: "flex", alignItems: "baseline", gap: 1, minWidth: 0 }}
              >
                <Box
                  component="span"
                  sx={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: palette.TEXT,
                    whiteSpace: "nowrap",
                  }}
                >
                  Session detail
                </Box>
                <Box
                  component="span"
                  sx={{
                    fontSize: 10,
                    color: palette.TEXT_MUTED,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  Session forensics · OI bursts, structure, volume, levels, straddle, gamma, flow, P&amp;L
                </Box>
              </Box>
              <Box
                component="span"
                sx={{ fontSize: 11, fontWeight: 700, color: palette.TEXT_MUTED, flexShrink: 0 }}
              >
                {detailOpen ? "Hide" : "Show"}
              </Box>
            </Button>

            <Box
              id="nifty-detail-body"
              data-testid="nifty-detail-body"
              sx={{
                display: detailOpen ? "flex" : "none",
                flexDirection: "column",
                gap: 0.5,
                p: 0.5,
                borderTop: `1px solid ${palette.TERM_BORDER}`,
                minWidth: 0,
              }}
            >
              <Box
                data-testid="nifty-gamma-iv-row"
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 2fr) minmax(0, 1fr)" },
                  alignItems: "start",
                  gap: 0,
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: 0,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <NiftyIvStraddle
                    rows={tapeRows}
                    candles={report.candles}
                    regime={report.regime}
                    reference={report.reference}
                  />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <NiftyGammaTime
                    rows={tapeRows}
                    gex={gexForDisplay}
                    spot={report.spot}
                    walls={report.walls}
                    degraded={gexDegraded}
                  />
                </Box>
              </Box>

              <Box
                data-testid="nifty-signals-grid"
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "minmax(0, 1fr)",
                    lg: "repeat(2, minmax(0, 1fr))",
                  },
                  alignItems: "start",
                  gap: 0,
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: 0,
                }}
              >
                <CompactPanel
                  flush
                  padded={false}
                  testId="nifty-unusual-panel-wrap"
                  sx={{ minWidth: 0, background: UNUSUAL_TERM_BG, borderColor: UNUSUAL_TERM_BORDER }}
                >
                  <NiftyUnusualVolume
                    strikes={report.strikes}
                    spot={report.spot}
                    sx={UNUSUAL_VOLUME_SX}
                    updatedAtMs={mode === "live" ? updatedAtMs : null}
                    nextUpdateAtMs={nextUpdateAtMs}
                  />
                </CompactPanel>

                {(trail.length > 0 || report.structure != null) && (
                <Box
                  data-testid="nifty-signals-row"
                  sx={{
                    display: { xs: "flex", lg: "contents" },
                    flexWrap: "wrap",
                    alignItems: "stretch",
                    gap: 0.5,
                    minWidth: 0,
                  }}
                >
                  {burstsPanel}

                  <NiftyStructureShifts structure={report.structure} />
                </Box>
                )}

                {report.gex ? (
                <CompactPanel flush title="GEX levels" testId="nifty-gex-panel" sx={{ minWidth: 0 }}>
                  <Box data-testid="nifty-gex-row">
                    <CompactStatGrid>
                      <CompactStat
                        dense
                        data-testid="nifty-gex-net"
                        label="Net GEX"
                        value={
                          gexDegraded ? (
                            "γ n/a"
                          ) : (
                            <AnimatedValue value={report.gex.netTotal} format={formatGexTotalValue} />
                          )
                        }
                      />
                      <CompactStat
                        dense
                        data-testid="nifty-gex-regime"
                        label="Regime @ spot"
                        value={gexRegimeText(gexRegime)}
                      />
                      <CompactStat
                        dense
                        data-testid="nifty-gex-flip"
                        label="Gamma flip"
                        value={<AnimatedValue value={gexFlip} format={formatInt} />}
                      />
                      <CompactStat
                        dense
                        data-testid="nifty-gex-sup"
                        label={gexSupCopy.label}
                        value={
                          gexTopSup ? (
                            <AnimatedValue value={gexTopSup.strike} format={formatGexSup} />
                          ) : (
                            "—"
                          )
                        }
                      />
                      <CompactStat
                        dense
                        data-testid="nifty-gex-res"
                        label={gexResCopy.label}
                        value={
                          gexTopRes ? (
                            <AnimatedValue value={gexTopRes.strike} format={formatGexRes} />
                          ) : (
                            "—"
                          )
                        }
                      />
                    </CompactStatGrid>
                    <Text data-testid="nifty-gex-verdict" size="sm" c="dimmed">
                      {gexRegimeText(gexRegime)}
                      {levels
                        ? ` — max-pain pull ${levels.painPull.dir} (${levels.painPull.pct >= 0 ? "+" : ""}${levels.painPull.pct.toFixed(2)}%). ${levels.pcrVerdict}.`
                        : "."}
                      {levels?.resistance[0] && levels?.support[0]
                        ? ` Gap above ${formatNumberIN(levels.resistance[0].strike)} squeezes call writers; acceptance below ${formatNumberIN(levels.support[0].strike)} opens the next put wall.`
                        : null}
                    </Text>
                  </Box>
                </CompactPanel>
                ) : (
                <CompactPanel flush title="Next-session levels" testId="nifty-tomorrow-panel" sx={{ minWidth: 0 }}>
                  {levels && (
                  <Box data-testid="nifty-levels-row">
                    <CompactStatGrid>
                      {levels.resistance.map((r, i) => (
                        <CompactStat
                          dense
                          key={`r-${r.strike}`}
                          data-testid={`nifty-level-r${i + 1}`}
                          label={i === 0 ? "Resistance R1" : "Resistance R2"}
                          value={`${formatNumberIN(r.strike)} (${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(2)}%)`}
                        />
                      ))}
                      <CompactStat
                        dense
                        data-testid="nifty-level-pain"
                        label={`Max-pain pull ${levels.painPull.dir}`}
                        value={`${formatNumberIN(report.maxPain)} (${levels.painPull.pct >= 0 ? "+" : ""}${levels.painPull.pct.toFixed(2)}%)`}
                      />
                      {levels.support.map((s, i) => (
                        <CompactStat
                          dense
                          key={`s-${s.strike}`}
                          data-testid={`nifty-level-s${i + 1}`}
                          label={i === 0 ? "Support S1" : "Support S2"}
                          value={`${formatNumberIN(s.strike)} (${s.pct.toFixed(2)}%)`}
                        />
                      ))}
                    </CompactStatGrid>
                    <Text data-testid="nifty-levels-verdict" size="sm" c="dimmed">
                      {levels.pcrVerdict}. Gap above{" "}
                      {levels.resistance[0]?.strike != null
                        ? formatNumberIN(levels.resistance[0].strike)
                        : "—"}{" "}
                      squeezes call writers; acceptance below{" "}
                      {levels.support[0]?.strike != null
                        ? formatNumberIN(levels.support[0].strike)
                        : "—"}{" "}
                      opens the next put wall.
                    </Text>
                  </Box>
                  )}
                </CompactPanel>
                )}
              </Box>
            </Box>
          </Box>
          )}

          {onOpenSymbol && symbol !== "SENSEX" && (
            <Button
              data-testid="nifty-open-symbol"
              size="sm"
              variant="subtle"
              onClick={handleOpenSymbol}
            >
              Open {symbol} chart
            </Button>
          )}

          {/* Desk modals — all share the PanelModal shell; content is the
              same live-data component as inline, so nothing refetches. */}
          <PanelModal
            open={planOpen}
            title="Desk plan — reasons"
            onClose={() => setPlanOpen(false)}
            variant="drawer"
          >
            <Box data-testid="nifty-plan-modal">
              <NiftyDeskPlan report={report} />
            </Box>
          </PanelModal>

          <PanelModal
            open={gammaOpen}
            title="Dealer gamma & positioning"
            onClose={() => setGammaOpen(false)}
            variant="drawer"
          >
            <Box
              data-testid="nifty-gamma-cell"
              sx={{
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: 0.5,
                "& > *": { width: "100%", minWidth: 0 },
                "& [data-compact]": { bgcolor: "transparent", border: "none !important", borderRadius: "0 !important", boxShadow: "none" },
                "& [data-compact-header]": { minHeight: "20px", bgcolor: palette.TERM_HEADER, borderBottom: `1px solid ${palette.TERM_BORDER} !important`, px: 0.5 },
                "& [data-compact-header] .MuiTypography-root": { fontSize: "9px !important", textTransform: "uppercase", letterSpacing: "0.06em", color: `${palette.TEXT_MUTED} !important`, fontWeight: 700, lineHeight: 1.2 },
                "& [data-compact] .MuiCardContent-root": { p: "4px !important" },
                "& .MuiTypography-h4, & .MuiTypography-h5, & .MuiTypography-h6": { fontSize: "10px !important", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: palette.TEXT_MUTED },
              }}
            >
              <NiftyGammaStrip gex={gexForDisplay} positioning={report.positioning} spot={report.spot} />
              <NiftyGexProfile gex={gexForDisplay} spot={report.spot} />
              <NiftyDeltaPositioning positioning={report.positioning} spot={report.spot} />
            </Box>
          </PanelModal>


          <PanelModal
            open={chartFull}
            title={
              <Box
                data-testid="nifty-chart-fullscreen-titlebar"
                sx={{ display: "flex", alignItems: "center", gap: 0.5, width: "100%", minWidth: 0 }}
              >
                <Box
                  component="span"
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    color: palette.TEXT_MUTED,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {symbol} CHART — FULLSCREEN
                </Box>
                {(["1m", "5m", "15m"] as const).map((tf) => (
                  <Button
                    key={tf}
                    data-testid={`nifty-chart-fullscreen-tf-${tf}`}
                    size="sm"
                    variant={chartTf === tf ? "filled" : "subtle"}
                    aria-pressed={chartTf === tf}
                    onClick={() => handleChartTf(tf)}
                    sx={{ minWidth: 34, px: "6px", py: 0, fontSize: 10, lineHeight: 1.6 }}
                  >
                    {tf}
                  </Button>
                ))}
              </Box>
            }
            onClose={() => setChartFull(false)}
          >
            <Box
              data-testid="nifty-chart-fullscreen-body"
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 0.5,
                minHeight: 0,
                height: "100%",
              }}
            >
              {/* Full width: the expanded chart is the reason the modal opens.
                  The chain has its own expand button now, so it no longer
                  steals 40% of the fullscreen. */}
              <Box
                data-testid="nifty-chart-fullscreen-chart"
                sx={{
                  flex: "1 1 auto",
                  minHeight: 0,
                  minWidth: 0,
                  width: "100%",
                  display: "flex",
                  "& > *": { flex: 1, minWidth: 0, minHeight: 0 },
                }}
              >
                <NiftyChartPanel
                  report={report}
                  bursts={detectedBursts}
                  tape={tape}
                  spotPoints={oiPoints}
                  flipAt={flipAt}
                  maxWalls={maxWallsProp}
                  mode={mode}
                  view={view}
                  symbol={symbol}
                  asOf={mode === "eod" ? replay?.snapshots[replayIndex]?.t : undefined}
                  timeframe={chartTf}
                  onTimeframeChange={handleChartTf}
                  fillContainer
                />
              </Box>
            </Box>
          </PanelModal>

          <PanelModal
            open={oiExpand}
            variant="drawer"
            title="Option chain — expanded"
            onClose={() => setOiExpand(false)}
          >
            <Box
              data-testid="nifty-oi-expanded-body"
              sx={{ height: "78vh", display: "flex", minHeight: 0 }}
            >
              <NiftyOiChain
                strikes={visibleStrikes}
                columns={oiColumns}
                getRowStyle={getOiRowStyle}
                getRowTestId={getOiRowTestId}
                panelTestId="nifty-oi-expanded"
                tableTestId="nifty-oi-expanded-table"
                wrapTestId="nifty-oi-expanded-wrap"
                wrapRef={oiExpandedWrapRef}
              />
            </Box>
          </PanelModal>

          <PanelModal
            open={heatExpand}
            variant="drawer"
            title={rangeTitle("OI HEATMAP — EXPANDED", "nifty-heatmap-range")}
            onClose={() => setHeatExpand(false)}
          >
            <Box
              data-testid="nifty-heatmap-expanded-body"
              sx={{ height: "78vh", display: "flex", minHeight: 0 }}
            >
              <NiftyOiHeatmap
                rows={tapeRows}
                bucketMin={expandRange}
                widthPts={metrics?.heatmapWidthPts ?? 250}
                viewBoxHeight={380}
                metric={heatMetric}
                startTime={intradayStart}
                flipAt={flipAt}
              />
            </Box>
          </PanelModal>

          <PanelModal
            open={flowExpand}
            variant="drawer"
            title="Flow strip — expanded"
            onClose={() => setFlowExpand(false)}
            autoHeight
          >
            <Box data-testid="nifty-flow-expanded-body" sx={{ width: "100%", minWidth: 0 }}>
              <NiftyFlowStrip rows={tapeRows} />
            </Box>
          </PanelModal>

          <PanelModal
            open={pressureExpand}
            variant="drawer"
            title={rangeTitle("OPTION VOLUME PRESSURE — EXPANDED", "nifty-pressure-range")}
            onClose={() => setPressureExpand(false)}
            autoHeight
          >
            <Box
              data-testid="nifty-pressure-expanded-body"
              sx={{ display: "flex", flexDirection: "column", gap: 1, minHeight: 0 }}
            >
              <Box
                data-testid="nifty-pressure-expanded-stats"
                sx={{ display: "flex", gap: 2, flexWrap: "wrap", fontSize: 10, color: palette.TEXT_MUTED }}
              >
                <span>median {formatNumberIN(Math.round(pressureRange.median))}</span>
                <span>peak {pressureRange.maxRatio.toFixed(1)}×</span>
                <span>{pressureRange.bursts} minutes ≥2×</span>
                <span>last {pressureRange.lastRatio.toFixed(1)}×</span>
                <span>last 3-min {pressureRange.last3Ratio.toFixed(1)}×</span>
              </Box>
              <Box sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>
                <NiftyPressureLane series={pressureRange} height={420} showAxis />
              </Box>
            </Box>
          </PanelModal>

          <PanelModal
            open={flowChartExpand}
            variant="drawer"
            title={rangeTitle("CUMULATIVE FLOW + GAMMA — EXPANDED", "nifty-flow-range")}
            onClose={() => setFlowChartExpand(false)}
            autoHeight
          >
            <Box
              data-testid="nifty-flowchart-expanded-body"
              sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}
            >
              <Box
                data-testid="nifty-flowchart-expanded-stats"
                sx={{ display: "flex", gap: 2, flexWrap: "wrap", fontSize: 10, color: palette.TEXT_MUTED }}
              >
                <span>
                  flow{" "}
                  {flowRange.points.length
                    ? `${(flowRange.points[flowRange.points.length - 1].net / 1e6).toFixed(1)}M`
                    : "—"}
                </span>
                <span>{flowRange.flips.length} regime flips</span>
                <span>{Math.round(flowRange.shortShare * 100)}% short book Γ</span>
                <span>{flowRange.points.length} buckets</span>
              </Box>
              <NiftyFlowChart series={flowRange} height={420} showAxis />
            </Box>
          </PanelModal>

          <PanelModal
            open={ivOpen}
            title="IV skew — expanded"
            onClose={() => setIvOpen(false)}
          >
            <Box data-testid="nifty-ivskew-modal">
              <NiftyIvSkew strikes={report.strikes} spot={report.spot} />
            </Box>
          </PanelModal>

          <PanelModal
            open={gexOpen}
            title="GEX profile — expanded"
            onClose={() => setGexOpen(false)}
          >
            <Box data-testid="nifty-gex-modal">
              <NiftyGexProfile gex={gexForDisplay} spot={report.spot} />
            </Box>
          </PanelModal>

          <PanelModal
            open={visualsOpen}
            title="Visuals grid"
            onClose={() => setVisualsOpen(false)}
          >
            <Text data-testid="nifty-visuals-stub" size="sm" c="dimmed">
              Visuals grid coming soon — press V to toggle this stub.
            </Text>
          </PanelModal>
          </>
          ) : (
            <>
            <LevelsInPlay report={report} sensex={sensex} />
            <CompactPanel title="Sensex levels" testId="sensex-focus-panel" sx={{ minWidth: 0, flexShrink: 0 }}>
              {sensex ? (
                <>
                  <CompactStatGrid>
                    <CompactStat
                      dense
                      data-testid="sensex-focus-spot"
                      label="Spot"
                      value={sensex.spot.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                    />
                    <CompactStat
                      dense
                      data-testid="sensex-focus-support"
                      label="Support zone"
                      value={formatNumberIN(sensex.walls?.puts[0]?.strike) ?? "—"}
                    />
                    <CompactStat
                      dense
                      data-testid="sensex-focus-resistance"
                      label="Resistance zone"
                      value={formatNumberIN(sensex.walls?.calls[0]?.strike) ?? "—"}
                    />
                    <CompactStat
                      dense
                      data-testid="sensex-focus-max-pain"
                      label="Max pain zone"
                      value={sensex.maxPain > 0 ? formatNumberIN(sensex.maxPain) : "—"}
                    />
                    <CompactStat
                      dense
                      data-testid="sensex-focus-pcr"
                      label="PCR (OI)"
                      value={sensex.pcrOi.toFixed(2)}
                    />
                  </CompactStatGrid>
                  <Text size="sm" c="dimmed">
                    Expiry {sensex.expiry || "—"}. Sensex option-chain levels are live; switch back to NIFTY for the full chain report.
                  </Text>
                </>
              ) : (
                sensexLoading ? (
                  <InlineLoader data-testid="sensex-focus-loading" />
                ) : (
                  <Text data-testid="sensex-focus-error" size="sm" c="dimmed">
                    {sensexError || "Sensex data is currently unavailable."} Use Refresh to try again.
                  </Text>
                )
              )}
            </CompactPanel>
            </>
          )}
        </>
      )}
    </Box>
  );
}
