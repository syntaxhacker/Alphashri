import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
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
  NiftyChartPanel,
  CHART_HEIGHTS,
  CHART_ROW_CHROME,
  FILL_MAX_HEIGHT,
  buildMarkLines as buildChartMarkLines,
  resampleCandles as resampleChartCandles,
  emaSeries as emaChartSeries,
} from "./NiftyChartPanel";
import type { ChartSize, ChartTimeframe } from "./NiftyChartPanel";
import {
  NiftyReplayBar,
  buildReplaySegments,
  countReplayHoles,
  replayTimeLabel as replayTimeLabelBar,
  toReplayReasons,
} from "./NiftyReplayBar";
import type { ReplayReason } from "./NiftyReplayBar";
import { NiftyUpdatedLabel } from "./NiftyUpdatedLabel";
import { NiftyTapeTable } from "./NiftyTapeTable";
import { NiftyUnusualVolume, UNUSUAL_TERM_BG, UNUSUAL_TERM_BORDER } from "./NiftyUnusualVolume";
import { NiftyStructureShifts } from "./NiftyStructureShifts";
import { NiftyOiHeatmap } from "./NiftyOiHeatmap";
import { NiftyFlowStrip } from "./NiftyFlowStrip";
import { NiftyIntelStrip } from "./NiftyIntelStrip";
import { NiftyGammaStrip } from "./NiftyGammaStrip";
import { NiftyPositionsDrawer } from "./NiftyPositionsDrawer";
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
import { NiftyDeskPlan } from "./NiftyDeskPlan";
import { buildDeskPlan } from "./deskPlan";
import { summarizeDeskPlan } from "./deskPlanSummary";
import type { PlanInput } from "./deskPlanSummary";
import { PanelModal } from "@/components/common/PanelModal";
import { useDeskHotkeys } from "@/hooks/useDeskHotkeys";
import type { DeskChartTimeframe } from "@/hooks/useDeskHotkeys";
import { MarketAlertLog, MarketAlertStack } from "@/components/notifications/MarketAlertCard";
import { OI_ALERT_TOAST_MAX, useNiftyOiAlerts } from "./useNiftyOiAlerts";
import { detectOiBursts, TREND_EMA_SPAN, sortAlertsCriticalFirst, criticalBannerText, burstTimeLabel, spotMinutesBefore, premiumChangeBefore } from "./niftyOiBursts";
import type { MinutePremium } from "./niftyOiBursts";
import { useNiftyBurstStream } from "@/hooks/useNiftyBurstStream";
import { useNiftyReportStream } from "@/hooks/useNiftyReportStream";
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
  NiftySensex,
  NiftyStrike,
  NiftyTape,
} from "@/types/niftyReport";
import { fetchLiveNifty, fetchLiveSensex, fetchNiftyByDate, fetchNiftyExpiries, fetchNiftyReplay, fetchNiftyReplayDates, fetchNiftyTape, fetchNiftyBursts, snapshotNifty } from "@/api/reportNifty";
import { fetchPositions } from "@/api/paperTrading";
import type { PaperPosition } from "@/types/paperTrading";
import {
  computeReplayCoverage,
} from "./niftyReplayCoverage";
import { isMarketOpenIst } from "./marketClock";

export interface NiftyReportPanelProps {
  onOpenSymbol?: (s: string) => void;
}

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
  gap: "1px",
  minWidth: { xs: 92, md: 104 },
  px: 1,
  py: 0.25,
  borderLeft: `1px solid ${palette.TERM_BORDER}`,
  "&:first-of-type": { borderLeft: "none" },
} as const;

const DECISION_LABEL_STYLE: CSSProperties = {
  fontSize: 9,
  lineHeight: 1.25,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const DECISION_VALUE_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1.15,
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
  gap: "1px",
  minWidth: 64,
  px: 1,
  py: 0.25,
  borderLeft: `1px solid ${palette.TERM_BORDER}`,
} as const;

const CONTEXT_LABEL_STYLE: CSSProperties = {
  fontSize: 9,
  lineHeight: 1.25,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
};

const CONTEXT_VALUE_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1.2,
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
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("en-IN")} pts`;
}

/** Open interest in contracts, compact (`2.69 Cr`, `18.4 L`). */
function formatOiCr(oi: number | null | undefined): string {
  if (oi == null || !Number.isFinite(oi) || oi <= 0) return "—";
  if (oi >= 1e7) return `${(oi / 1e7).toFixed(2)} Cr`;
  if (oi >= 1e5) return `${(oi / 1e5).toFixed(1)} L`;
  return oi.toLocaleString("en-IN");
}

/** Single implementation lives in the memoised chart panel — re-exported
 *  here so existing imports keep working. */
export const buildMarkLines = buildChartMarkLines;


/** Overnight levels derived from the live chain — no static copy. */
export function buildOvernightLevels(report: NiftyReport): {
  resistance: { strike: number; pct: number }[];
  support: { strike: number; pct: number }[];
  painPull: { dir: string; pct: number };
  pcrVerdict: string;
} {
  const pct = (s: number) =>
    report.spot > 0 ? ((s - report.spot) / report.spot) * 100 : 0;
  const resistance = [...report.walls.calls]
    .map((w) => w.strike)
    .filter((s) => s > report.spot)
    .sort((a, b) => a - b)
    .slice(0, 2)
    .map((strike) => ({ strike, pct: pct(strike) }));
  const support = [...report.walls.puts]
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
  const pcrVerdict =
    report.pcrOi < 0.7
      ? `Bearish (PCR-OI ${report.pcrOi.toFixed(2)} — call writers in control)`
      : report.pcrOi > 1.0
        ? `Bullish (PCR-OI ${report.pcrOi.toFixed(2)} — put writers in control)`
        : `Neutral (PCR-OI ${report.pcrOi.toFixed(2)})`;
  return { resistance, support, painPull, pcrVerdict };
}

/** Single implementations live in the memoised chart panel — re-exported
 *  here so existing imports keep working. */
export const resampleCandles = resampleChartCandles;
export const emaSeries = emaChartSeries;


export { LevelLegend, CHART_HEIGHTS, CHART_TF_MINUTES } from "./NiftyChartPanel";
export type { ChartSize, ChartTimeframe } from "./NiftyChartPanel";


/**
 * Compact buildup badge. The code *is* the content (`LB`/`SB`/`SC`/`LU`) with
 * the full label on the tooltip — 60 full "Long Buildup" pills turned both
 * signal columns into a wall of text at the chain's real width. The hue still
 * carries direction (green = bullish for that side, red = bearish) via the
 * same tick + coloured-text language. Unknown labels render raw (dimmed) so
 * legacy payloads (`Bullish`/`Bearish`) never blank the column.
 */
function sentimentBadge(sentiment: string, side: "ce" | "pe") {
  const code = sentiment.trim().toUpperCase();
  const label = SENTIMENT_NAMES[code] ?? sentiment.trim();
  // Same buildup code means opposite things per side:
  // calls rise on buying (LB/SC bullish), puts rise on fear (LB bearish).
  const bullish =
    side === "ce" ? code === "LB" || code === "SC" : code === "SB" || code === "SC";
  const known = Boolean(SENTIMENT_NAMES[code]);
  const tone = known ? (bullish ? palette.POSITIVE : palette.NEGATIVE) : palette.TEXT_MUTED;
  const short = known ? code : label || "—";
  return (
    <Box
      component="span"
      title={label || sentiment}
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

/** Call-wall / put-wall tag: a 5px leg-hue dot + 9px code, before the numeral. */
function wallTag(code: "CW" | "PW", color: string) {
  return (
    <Box
      component="span"
      data-testid={code === "CW" ? "nifty-wall-cw" : "nifty-wall-pw"}
      title={code === "CW" ? "Call wall (top CE OI)" : "Put wall (top PE OI)"}
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
  const text = Number.isFinite(value) ? value.toLocaleString("en-IN") : "—";
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

const SENTIMENT_NAMES: Record<string, string> = {
  LB: "Long Buildup",
  SB: "Short Buildup",
  SC: "Short Cover",
  LU: "Long Unwind",
};

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
  return `${strike.toLocaleString("en-IN")} (${netGex >= 0 ? "+" : ""}${netGex.toFixed(2)} Cr)`;
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

import { paperToPnlLeg } from "./niftyPositions";

export { paperToPnlLeg };

/** Re-exported from the memoised replay bar (single implementation). */
export const replayTimeLabel = replayTimeLabelBar;


/** Build an rgba() string from a palette hex token — never hardcode the channels. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
          {isCW ? wallTag("CW", palette.TERM_CE) : null}
          {isPW ? wallTag("PW", palette.TERM_PE) : null}
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
            {strike.toLocaleString("en-IN")}
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
const UNUSUAL_VOLUME_SX = { minWidth: 0 };

/** Hoisted `AnimatedValue` formatters — inline arrows would be new closures. */
const formatInt = (v: number): string => v.toLocaleString("en-IN");
const format2dp = (v: number): string => v.toFixed(2);
const formatGexTotalValue = (v: number): string => formatGexTotal(v);

/** Live Spot stat, isolated so the ~1/second tick repaints only this value.
 *  Props are primitives, so the memo holds across unrelated parent renders. */
const NiftySpotValue = memo(function NiftySpotValue({
  tickSpot,
  fallback,
}: {
  tickSpot: number | undefined;
  fallback: number;
}) {
  return <AnimatedValue value={tickSpot ?? fallback} format={formatInt} />;
});

export function NiftyReportPanel({ onOpenSymbol }: NiftyReportPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState<"nifty" | "sensex">("nifty");
  const [mode, setMode] = useState<NiftyReportMode>("live");
  const [expiry, setExpiry] = useState<string>("nearest");
  const [expiryOptions, setExpiryOptions] = useState<string[]>([]);
  const [date, setDate] = useState<string>("");
  // Gate the first fetch until we know whether to open on Live or on the
  // newest recorded day (the bootstrap effect lives just above `load`).
  const [booted, setBooted] = useState(false);
  const wasOpenAtMount = useRef(isMarketOpenIst());
  const [report, setReport] = useState<NiftyReport | null>(null);
  const [sensex, setSensex] = useState<NiftySensex | null>(null);
  const [sensexLoading, setSensexLoading] = useState(false);
  const [sensexError, setSensexError] = useState<string | null>(null);
  const [tape, setTape] = useState<NiftyTape | null>(null);
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
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [chartFull, setChartFull] = useState(false);
  const [ivOpen, setIvOpen] = useState(false);
  const [gexOpen, setGexOpen] = useState(false);
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
  const openAlertsModal = useCallback(() => setAlertsOpen(true), []);
  const closeAlertsModal = useCallback(() => setAlertsOpen(false), []);
  const openChartFull = useCallback(() => setChartFull(true), []);
  const openVisuals = useCallback(() => setVisualsOpen(true), []);
  const closeTopModal = useCallback(() => {
    if (alertsOpen) setAlertsOpen(false);
    else if (visualsOpen) setVisualsOpen(false);
    else if (gexOpen) setGexOpen(false);
    else if (ivOpen) setIvOpen(false);
    else if (chartFull) setChartFull(false);
    else if (planOpen) setPlanOpen(false);
  }, [alertsOpen, visualsOpen, gexOpen, ivOpen, chartFull, planOpen]);
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
  // Scrub coalescing: slider input can fire far faster than the ~5,668-node
  // panel tree can repaint. Only the newest frame is kept; one rAF applies
  // it, so stale frames never land. The concrete frame (not the index) is
  // stored so a context switch cannot redirect it onto a new replay.
  const scrubRafRef = useRef<number | null>(null);
  const pendingScrubRef = useRef<{ report: NiftyReport; sensex: NiftySensex | null } | null>(null);

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

  // Closed-market default: open on the newest day that has a recording instead
  // of an empty Live screen. The dates endpoint only lists days with
  // snapshots, so a holiday/weekend resolves to the last real session.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (!isMarketOpenIst()) {
          const dates = await fetchNiftyReplayDates();
          if (alive && dates.length > 0) {
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
    const id = window.setInterval(() => {
      if (isMarketOpenIst()) return;
      wasOpenAtMount.current = false;
      void fetchNiftyReplayDates().then((dates) => {
        if (dates.length > 0) {
          setMode("eod");
          setDate(dates[0]);
        }
      });
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

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
      // EOD: fetch the recorded frames BEFORE painting the REST snapshot. The
      // snapshot is the 15:30 close; painting it first made a 09:30 replay
      // flash the closing chain for a frame before the first frame landed.
      const replayPromise =
        mode === "eod" && date
          ? fetchNiftyReplay(date, controller.signal).catch(() => null)
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
      const firstReplayFrame =
        replayData && replayData.snapshots.length > 0 ? replayData.snapshots[0] : null;
      setReport(firstReplayFrame ? firstReplayFrame.report : data);
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
        if (firstReplayFrame && replayData) {
          setReplay(replayData);
          setReplayIndex(0);
          setReplayPlaying(false);
          setSensex(firstReplayFrame.sensex ?? null);
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
  }, [mode, expiry, date]);

  useEffect(() => {
    let active = true;
    fetchNiftyExpiries()
      .then((list) => {
        if (active) setExpiryOptions(list.map((e) => e.date));
      })
      .catch(() => {
        /* non-fatal: picker falls back to nearest */
      });
    return () => {
      active = false;
    };
  }, []);

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
      // Replay belongs to one (mode, date) context only — dropping it also
      // tears down the playback interval via the play effect's cleanup.
      // Cancel any coalesced scrub frame so a stale frame from the old
      // context never lands on the new one.
      if (scrubRafRef.current !== null) {
        window.cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }
      pendingScrubRef.current = null;
      setReplay(null);
      setReplayIndex(0);
      setReplayPlaying(false);
      setError(null);
    }
  }, [contextKey]);

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
    },
    [],
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
  const { report: wsReport, tape: wsTape, sensex: wsSensex, tick: wsTick, connected: wsConnected } = useNiftyReportStream({
    expiry: expiry === "nearest" ? undefined : expiry,
    enabled: mode === "live",
  });

  // A pushed report replaces the REST state directly — no refetch needed.
  useEffect(() => {
    if (wsReport) {
      setReport(wsReport);
      setUpdatedAtMs(Date.now());
    }
  }, [wsReport]);

  // Pushed tape/sensex keep those blocks live after the initial REST load.
  // Nulls never arrive here (the hook keeps the last good value), so a
  // non-null push always replaces the REST state.
  useEffect(() => {
    if (wsTape) {
      setTape(wsTape);
      setUpdatedAtMs(Date.now());
    }
  }, [wsTape]);

  useEffect(() => {
    if (wsSensex) {
      setSensex(wsSensex);
      setSensexError(null);
      setUpdatedAtMs(Date.now());
    }
  }, [wsSensex]);

  // The ~1/second spot tick is consumed by the isolated header label (which
  // owns its own clock) and the Spot stat only — it deliberately never bumps
  // `updatedAtMs`, so the tick no longer re-renders the whole report tree
  // once per second just to move a clock label. `updatedAtMs` is fed by
  // report/tape frames only (~30-60s).

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
    if (mode === "eod") return;
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
  }, [mode, expiry]);

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
      const frame = replay.snapshots[clamped];
      if (!frame) return;
      setReplayPlaying(false);
      setReplayIndex(clamped);
      pendingScrubRef.current = { report: frame.report, sensex: frame.sensex ?? null };
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
      if (first) {
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

  /** Readability: full chain is noise — show the ATM window only. */
  const visibleStrikes = useMemo(
    () =>
      report
        ? report.strikes.filter((s) => Math.abs(s.strike - report.spot) <= 750)
        : [],
    [report],
  );

  /** Current-strike anchor: closest chain strike to spot. */
  const atmStrike = useMemo(
    () => (report ? findAtmStrike(report.strikes, report.spot) : null),
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
  // (inline + modal copy, same props, no refetch). One renderer keeps them
  // identical; distinct testids keep queries unambiguous.
  const modalOiWrapRef = useRef<HTMLDivElement>(null);
  const renderOiChain = (
    panelTestId: string,
    tableTestId: string,
    wrapTestId: string,
    wrapRef: RefObject<HTMLDivElement | null>,
  ) => (
    <CompactPanel
      flush
      scrollable
      title="Option-chain OI (±750 ATM)"
      testId={panelTestId}
      sx={{
        minWidth: 0,
        minHeight: 0,
        // Terminal surface like the tape panel — the table overrides
        // below keep every inner layer black/transparent.
        background: palette.TERM_BG,
        borderColor: palette.TERM_BORDER,
        // The chain must not size the row: without this the table's
        // natural height (all ~30 legs) sets the chart row to ~900px
        // and leaves the chart floating in a void. `size` containment
        // makes the panel take the row height from the chart instead,
        // and the table scrolls inside it. Desktop only — on xs the
        // grid is one column and the panel needs its own height.
        contain: { xs: "none", lg: "size" },
      }}
    >
      {/* The chain fills whatever height the chart row gives it and
          scrolls internally — no fixed 180px cap, so XL charts show
          ~30 strikes instead of the same 6 with a blank column. */}
      <Box
        ref={wrapRef}
        data-testid={wrapTestId}
        sx={{
          display: "flex",
          height: "100%",
          minWidth: 0,
          minHeight: 0,
        }}
      >
      {/* `minWidth: 0` overrides the shared 640px floor, which forced a
          sideways scrollbar and cut the PE columns off at the panel edge. */}
      <TanStackTable<NiftyStrike>
        data={visibleStrikes}
        columns={oiColumns}
        dataTestId={tableTestId}
        emptyMessage="No strikes for this expiry"
        fillContainer
        style={{ minWidth: 0 }}
        getRowStyle={getOiRowStyle}
        getRowTestId={getOiRowTestId}
      />
      </Box>
    </CompactPanel>
  );

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
  useNiftyBurstStream(onStreamEvent, mode === "live");

  // Base detection, memoised on `tape` identity so an unrelated parent render
  // never re-runs the detector.
  const detectedBursts = useMemo<OiBurst[]>(
    () => (bursts && bursts.length > 0 ? bursts : detectOiBursts(tape?.rows ?? [])),
    [bursts, tape],
  );

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
  /** Minute → burst side, for the tape's burst spine. */
  const burstMap = useMemo(() => {
    const m = new Map<string, "call" | "put">();
    for (const b of effectiveBursts) m.set(b.t, b.side);
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
    ? `${contextKey}@${replayFrameLabel}`
    : contextKey;
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
  const sortedTrail = useMemo(() => sortAlertsCriticalFirst(trail), [trail]);
  const displayedTrail = useMemo(
    () => (criticalOnly ? sortedTrail.filter((a) => a.severity === "critical") : sortedTrail),
    [sortedTrail, criticalOnly],
  );
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
      startTransition(() => {
        setReport(frame.report);
        setSensex(frame.sensex ?? null);
      });
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
    for (const s of report.strikes) {
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
    onOpenSymbol?.("NIFTY");
  }, [onOpenSymbol]);
  const expiryData = useMemo(
    () => [
      { value: "nearest", label: "Nearest expiry" },
      ...expiryOptions.map((d) => ({ value: d, label: d })),
    ],
    [expiryOptions],
  );
  const handleIndexChange = useCallback((v: string) => {
    const next = v as "nifty" | "sensex";
    setSelectedIndex(next);
    if (next === "sensex") {
      setMode("live");
      setView("chart");
    }
  }, []);
  const handleModeChange = useCallback((v: string) => {
    setMode(v as NiftyReportMode);
  }, []);
  const handleViewChange = useCallback((v: string) => {
    setView(v as "chart" | "depth");
  }, []);
  const handleExpiryChange = useCallback((v: string | null) => {
    setExpiry(v ?? "nearest");
  }, []);
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
      {isDesk ? (
        <Button
          data-testid="nifty-oi-bursts-open"
          size="sm"
          variant="subtle"
          title="Open the full OI-burst log"
          onClick={openAlertsModal}
        >
          Open
        </Button>
      ) : (
        <>
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
        </>
      )}
    </Box>
  );
  const burstsPanel =
    trail.length > 0 ? (
      <Box
        ref={burstsRef}
        data-testid="nifty-oi-bursts-wrap"
        data-critical={criticalCount > 0 ? "true" : undefined}
        sx={{ minWidth: 0 }}
      >
        <CompactPanel
          flush
          title={burstsTitle}
          testId="nifty-oi-bursts-panel"
          action={burstsActions}
        >
          {isDesk ? (
            <MarketAlertLog
              alerts={trail.slice(0, 2)}
              fill={false}
              height={48}
              onOpen={openAlertsModal}
            />
          ) : (
            <MarketAlertLog
              alerts={displayedTrail}
              fill={false}
              height={oiBurstLogHeight(displayedTrail.length)}
              onOpen={scrollToBursts}
            />
          )}
        </CompactPanel>
      </Box>
    ) : null;

  const regime = report?.regime ?? null;
  // Spot-relative flip (the payload's own `zeroCross` is dropped when it
  // disagrees with the cumulative sign at spot). Degraded blocks have no flip.
  const gammaFlip = gexDegraded ? null : gexFlip;
  const flipDelta = report && gammaFlip != null ? report.spot - gammaFlip : null;
  // Near walls only: a far mega-wall is book structure, not an intraday level.
  const callWall = (report?.wallsNear?.calls ?? report?.walls?.calls)?.[0] ?? null;
  const putWall = (report?.wallsNear?.puts ?? report?.walls?.puts)?.[0] ?? null;
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
        gap: 0.5,
        p: 1,
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        bgcolor: palette.TERM_BG,
        // Fill the app shell below the 56px toolbar. The chart row below is
        // the flex child that absorbs the slack, so the bursts/footer always
        // land on the viewport bottom instead of leaving a black band.
        flex: "1 1 auto",
        minHeight: "calc(100vh - 56px)",
        // Never shrink below content: the page scrolls in #app-main, not in
        // this panel. Do NOT set `overflow-x: hidden` here — a lone axis
        // forces the other to `auto`, which silently turned the whole report
        // into a second scroll container (content appeared clipped/shifted
        // relative to the page scrollbar).
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
        // Tables: dense but scannable — 10px mono numerals, 4/8 padding,
        // 26px rows so the chain reads like a terminal tape.
        "& .paper-tanstack-cell": {
          fontSize: "10px !important",
          fontFamily: `${palette.MONO} !important`,
          padding: "4px 8px !important",
          height: "25px !important",
          lineHeight: 1.1,
        },
        "& .paper-tanstack-cell .MuiTypography-root": {
          lineHeight: "1.05 !important",
        },
        "& .paper-tanstack-header-cell": {
          fontSize: "9px !important",
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
          <SegmentedControl
            data-testid="nifty-index-toggle"
            value={selectedIndex}
            onChange={handleIndexChange}
            data={INDEX_TOGGLE_DATA}
            size="xs"
          />
          <SegmentedControl
            data-testid="nifty-mode-toggle"
            value={mode}
            onChange={handleModeChange}
            data={MODE_TOGGLE_DATA}
            size="xs"
          />
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
          <Box sx={{ flex: 1, minWidth: 8 }} />
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
              tick={wsTick}
              marketClosed={marketClosed}
              sessionDate={report?.market?.session_date}
              updatedAtMs={updatedAtMs}
              isStale={isStale}
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
              snapshotting || loading || mode === "eod"
            }
            title={
              mode === "eod"
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
          title="Nifty report failed"
          message={error}
          withRetry
          onRetry={handleRefresh}
        />
      )}

      {!loading && !error && !report && (
        <EmptyCompact
          data-testid="nifty-empty"
          title="No Nifty data"
          description={
            mode === "eod" && !date
              ? "Pick a date to load the EOD report."
              : "Refresh to load the latest Nifty option-chain report."
          }
        />
      )}

      {report && (
        <>
          {selectedIndex === "nifty" ? (
          <>
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
                    onClick={isDesk ? openAlertsModal : scrollToBursts}
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
          {planSummary && (
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
          )}
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
                minHeight: 30,
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
                  value={<NiftySpotValue tickSpot={mode === "live" ? wsTick?.spot : undefined} fallback={report.spot} />}
                  valueSize={15}
                  hint={
                    dayRange
                      ? `day ${Math.round(dayRange.low).toLocaleString("en-IN")}–${Math.round(
                          dayRange.high,
                        ).toLocaleString("en-IN")}`
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
                  label="Call wall"
                  value={callWall ? formatInt(callWall.strike) : "—"}
                  hint={
                    callWall
                      ? `CE OI ${formatOiCr(callWall.oi)}${
                          typeof callWall.distance === "number"
                            ? ` · ${callWall.distance > 0 ? "+" : ""}${Math.round(callWall.distance)} pts`
                            : ""
                        }`
                      : "no call OI"
                  }
                  accent={palette.TERM_CE}
                  title="Call wall: the heaviest call open interest NEAR spot (within ±300 pts) — the dealers' upside hedge. The distance from spot is shown next to the OI."
                />
                <DecisionCell
                  testId="nifty-stat-put-wall"
                  label="Put wall"
                  value={putWall ? formatInt(putWall.strike) : "—"}
                  hint={
                    putWall
                      ? `PE OI ${formatOiCr(putWall.oi)}${
                          typeof putWall.distance === "number"
                            ? ` · ${putWall.distance > 0 ? "+" : ""}${Math.round(putWall.distance)} pts`
                            : ""
                        }`
                      : "no put OI"
                  }
                  accent={palette.TERM_PE}
                  title="Put wall: the heaviest put open interest NEAR spot (within ±300 pts) — the dealers' downside hedge. The distance from spot is shown next to the OI."
                />
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
                  value={<AnimatedValue value={report.pcrOi} format={format2dp} />}
                />
                <ContextCell
                  testId="nifty-stat-pcr-vol"
                  label="PCR (Vol)"
                  value={<AnimatedValue value={report.pcrVol} format={format2dp} />}
                />
                <ContextCell
                  testId="nifty-stat-max-pain"
                  label="Max pain"
                  value={<AnimatedValue value={report.maxPain} format={formatInt} />}
                />
              </Box>
            </Box>
            <NiftyVerdictStrip report={report} mode="context" />
          </Box>

          {/* Official Upstox intel (FII/DII, ΔOI, max pain, PCR, news) — a 24px
              strip under the context row; the drawer holds the strike/news
              detail. Both modes keep it: it is external truth beside our own
              chain metrics, not a desk-only luxury. The frame's session is
              passed through, so an EOD/replay frame reads ITS OWN FII/DII
              instead of silently mixing in today's. */}
          <NiftyIntelStrip
            date={mode === "eod" ? date || null : null}
            expiry={expiry === "nearest" ? null : expiry}
            eod={mode === "eod"}
          />

          {/* Dealer-gamma rail: the regime/flip/fuel/resistance read in one
              24px line (same height as INTEL). Opens the full gamma profile +
              delta positioning drawer. Both modes — it is the second half of
              the external/positioning context, not a desk-only luxury. */}
          <NiftyGammaStrip
            gex={gexForDisplay}
            positioning={report.positioning}
            spot={report.spot}
          />

          {/* Full two-sided plan inline in research mode only; desk mode
              keeps the one-liner above and opens this same component in a
              modal so the first screen fits 1080p. */}
          {!isDesk && <NiftyDeskPlan report={report} />}

          {/* No inline SENSEX row in NIFTY mode: Sensex levels live on the
              SENSEX tab (`sensex-focus-panel`) so the NIFTY desk keeps one
              compact block above the chart. */}

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
            minHeight: 320,
            // DESK caps the upper row so the FLOW band below owns the slack.
            // Fill mode caps the chart body at 300px (300 + 48 chrome = 348);
            // S/M/L/XL raise the row to the chosen preset + chrome.
            ...(isDesk ? { maxHeight: chartRowHeight } : {}),
            overflow: "hidden",
          }}
        >
          <NiftyChartPanel
            report={report}
            mode={mode}
            view={view}
            timeframe={chartTf}
            onTimeframeChange={handleChartTf}
            onSizeChange={handleChartSize}
            onExpand={openChartFull}
          />

          {renderOiChain("nifty-oi-panel", "nifty-oi-table", "nifty-oi-wrap", oiWrapRef)}
          </Box>

          {/* Desk FLOW band: the heatmap (full width, ~220px) plus the
              event strip (~36px) on the same tape rows, directly under the
              chart/OI row so the desk reads it inside one 1080p viewport.
              The OI-burst trail moved below this band. */}
          {isDesk && (
          <Box
            data-testid="nifty-flow-band"
            sx={{
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              // Take every pixel the capped chart row leaves behind: the
              // heatmap SVG grows into the extra height (no black void).
              flex: "1 1 auto",
              minHeight: 0,
              display: "flex",
            }}
          >
            <CompactPanel
              flush
              testId="nifty-flow-band-panel"
              sx={{
                minWidth: 0,
                minHeight: 0,
                flex: 1,
                display: "flex",
                flexDirection: "column",
                background: palette.TERM_BG,
                borderColor: palette.TERM_BORDER,
                "& .MuiCardContent-root": {
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                },
                "& .MuiCardContent-root > div": {
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                },
              }}
            >
              <Box
                data-testid="nifty-heatmap-wrap"
                sx={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex" }}
              >
                <NiftyOiHeatmap rows={tapeRows} />
              </Box>
              <Box
                data-testid="nifty-flowstrip-wrap"
                sx={{ minHeight: 28, minWidth: 0, flexShrink: 0 }}
              >
                <NiftyFlowStrip rows={tapeRows} />
              </Box>
            </CompactPanel>
          </Box>
          )}

          {/* Desk keeps alerts above the fold: the bursts panel renders below
              the FLOW band so the heatmap+strip win the first viewport. */}
          {isDesk && burstsPanel}

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
                        ? ` Gap above ${levels.resistance[0].strike.toLocaleString("en-IN")} squeezes call writers; acceptance below ${levels.support[0].strike.toLocaleString("en-IN")} opens the next put wall.`
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
                          value={`${r.strike.toLocaleString("en-IN")} (${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(2)}%)`}
                        />
                      ))}
                      <CompactStat
                        dense
                        data-testid="nifty-level-pain"
                        label={`Max-pain pull ${levels.painPull.dir}`}
                        value={`${report.maxPain.toLocaleString("en-IN")} (${levels.painPull.pct >= 0 ? "+" : ""}${levels.painPull.pct.toFixed(2)}%)`}
                      />
                      {levels.support.map((s, i) => (
                        <CompactStat
                          dense
                          key={`s-${s.strike}`}
                          data-testid={`nifty-level-s${i + 1}`}
                          label={i === 0 ? "Support S1" : "Support S2"}
                          value={`${s.strike.toLocaleString("en-IN")} (${s.pct.toFixed(2)}%)`}
                        />
                      ))}
                    </CompactStatGrid>
                    <Text data-testid="nifty-levels-verdict" size="sm" c="dimmed">
                      {levels.pcrVerdict}. Gap above{" "}
                      {levels.resistance[0]?.strike.toLocaleString("en-IN") ?? "—"}{" "}
                      squeezes call writers; acceptance below{" "}
                      {levels.support[0]?.strike.toLocaleString("en-IN") ?? "—"}{" "}
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

          {toasts.length > 0 && (
            <Box
              data-testid="nifty-oi-toasts"
              sx={{
                position: "fixed",
                right: 16,
                bottom: 88,
                zIndex: 1300,
                width: 620,
                maxWidth: "calc(100vw - 32px)",
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

          {onOpenSymbol && (
            <Button
              data-testid="nifty-open-symbol"
              size="sm"
              variant="subtle"
              onClick={handleOpenSymbol}
            >
              Open NIFTY chart
            </Button>
          )}

          {/* Desk modals — all share the PanelModal shell; content is the
              same live-data component as inline, so nothing refetches. */}
          <PanelModal
            open={planOpen}
            title="Desk plan — reasons"
            onClose={() => setPlanOpen(false)}
          >
            <Box data-testid="nifty-plan-modal">
              <NiftyDeskPlan report={report} />
            </Box>
          </PanelModal>

          <PanelModal
            open={alertsOpen}
            title={`OI bursts (${trail.length})`}
            onClose={closeAlertsModal}
          >
            <Box data-testid="nifty-alerts-modal" sx={{ minWidth: 0 }}>
              <Box sx={{ display: "flex", gap: 0.5, alignItems: "center", mb: 0.5 }}>
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
              <MarketAlertLog
                alerts={displayedTrail}
                fill={false}
                height={oiBurstLogHeight(displayedTrail.length)}
                onOpen={scrollToBursts}
              />
            </Box>
          </PanelModal>

          <PanelModal
            open={chartFull}
            title="Nifty chart — fullscreen"
            onClose={() => setChartFull(false)}
          >
            <Box
              data-testid="nifty-chart-fullscreen-body"
              sx={{
                display: "flex",
                flexDirection: { xs: "column", lg: "row" },
                gap: 0.5,
                alignItems: "stretch",
                minHeight: 0,
              }}
            >
              <Box sx={{ flex: { lg: "0 0 60%" }, minWidth: 0 }}>
                <NiftyChartPanel
                  report={report}
                  mode={mode}
                  view={view}
                  timeframe={chartTf}
                  onTimeframeChange={handleChartTf}
                  initialSize="l"
                />
              </Box>
              <Box sx={{ flex: { lg: "0 0 40%" }, minWidth: 0, minHeight: 0 }}>
                {renderOiChain(
                  "nifty-chart-fullscreen-oi",
                  "nifty-chart-fullscreen-oi-table",
                  "nifty-chart-fullscreen-oi-wrap",
                  modalOiWrapRef,
                )}
              </Box>
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
                      value={sensex.walls.puts[0]?.strike.toLocaleString("en-IN") ?? "—"}
                    />
                    <CompactStat
                      dense
                      data-testid="sensex-focus-resistance"
                      label="Resistance zone"
                      value={sensex.walls.calls[0]?.strike.toLocaleString("en-IN") ?? "—"}
                    />
                    <CompactStat
                      dense
                      data-testid="sensex-focus-max-pain"
                      label="Max pain zone"
                      value={sensex.maxPain > 0 ? sensex.maxPain.toLocaleString("en-IN") : "—"}
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
          )}
        </>
      )}
    </Box>
  );
}
