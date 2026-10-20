import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Box from "@mui/material/Box";
import {
  Button,
  SegmentedControl,
  Select,
  Text,
  TextInput,
  Timeline,
  TimelineItem,
} from "@/ui";
import * as palette from "@/ui/palette";
import {
  NiftyChartPanel,
  buildMarkLines as buildChartMarkLines,
  resampleCandles as resampleChartCandles,
  emaSeries as emaChartSeries,
} from "./NiftyChartPanel";
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
import { NiftyDeltaPositioning } from "./NiftyDeltaPositioning";
import { NiftyGexProfile } from "./NiftyGexProfile";
import { NiftyIvStraddle } from "./NiftyIvStraddle";
import { NiftyGammaTime } from "./NiftyGammaTime";
import { NiftyVerdictStrip } from "./NiftyVerdictStrip";
import { MarketAlertLog, MarketAlertStack } from "@/components/notifications/MarketAlertCard";
import { OI_ALERT_TOAST_MAX, useNiftyOiAlerts } from "./useNiftyOiAlerts";
import { detectOiBursts, TREND_EMA_SPAN } from "./niftyOiBursts";
import { useNiftyBurstStream } from "@/hooks/useNiftyBurstStream";
import { useNiftyReportStream } from "@/hooks/useNiftyReportStream";
import type { OiBurst } from "./niftyOiBursts";
import { TanStackTable } from "@/components/common/TanStackTable";
import { AnimatedValue } from "@/components/common/AnimatedValue";
import { CompactPanel, CompactStat, CompactStatGrid } from "@/components/common/compact";
import { EmptyCompact, ErrorAlert, InlineLoader } from "@/components/common/states";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  NiftyBurst,
  NiftyGex,
  NiftyReport,
  NiftyReportMode,
  NiftyReplay,
  NiftySensex,
  NiftyStrike,
  NiftyTape,
} from "@/types/niftyReport";
import { fetchLiveNifty, fetchLiveSensex, fetchNiftyByDate, fetchNiftyExpiries, fetchNiftyReplay, fetchNiftyReplayDates, fetchNiftyTape, fetchNiftyBursts, snapshotNifty } from "@/api/reportNifty";
import {
  computeReplayCoverage,
} from "./niftyReplayCoverage";
import { isMarketOpenIst } from "./marketClock";

export interface NiftyReportPanelProps {
  onOpenSymbol?: (s: string) => void;
}

/**
 * One cell of the two-line stat band: a muted label on top, a tabular value
 * below. Cells are separated by hairlines (no gaps, no per-cell boxes) so the
 * band reads as a single strip and every value sits on the same baseline.
 */
const STAT_BAND_CELL_SX = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: "2px",
  minWidth: 0,
  px: 1.5,
  py: 0.75,
  borderLeft: `1px solid ${palette.TERM_BORDER}`,
  "&:first-child": { borderLeft: "none" },
} as const;

const STAT_BAND_LABEL_STYLE: CSSProperties = {
  fontSize: 9,
  lineHeight: 1.3,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
};

const STAT_BAND_VALUE_STYLE: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.2,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

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

/** One inline `LABEL value` pair of the secondary Sensex ticker strip. */
function SensexCell({ testId, label, value }: { testId: string; label: string; value: string }) {
  return (
    <Box data-testid={testId} sx={{ display: "flex", alignItems: "baseline", gap: 1, minWidth: 0 }}>
      <Text span size="xs" c="dimmed" tt="uppercase" style={{ fontSize: 9, letterSpacing: "0.07em", lineHeight: 1.2 }}>
        {label}
      </Text>
      <Text span size="sm" fw={700} style={{ fontSize: 12, lineHeight: 1.2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {value}
      </Text>
    </Box>
  );
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
 * Buildup chip. The hue here *is* the direction (green = bullish, red =
 * bearish), which is why the numbers around it stay in leg hue. Rendered as a
 * tinted label with a colour tick instead of an outlined capsule: 60 of those
 * capsules turn the chain into a wall of pills and read as decoration.
 */
function sentimentBadge(sentiment: string, side: "ce" | "pe") {
  const code = sentiment.trim().toUpperCase();
  const label = SENTIMENT_NAMES[code] ?? sentiment;
  // Same buildup code means opposite things per side:
  // calls rise on buying (LB/SC bullish), puts rise on fear (LB bearish).
  const bullish =
    side === "ce" ? code === "LB" || code === "SC" : code === "SB" || code === "SC";
  const known = Boolean(SENTIMENT_NAMES[code]);
  const tone = known ? (bullish ? palette.POSITIVE : palette.NEGATIVE) : palette.TEXT_MUTED;
  if (!known) {
    return (
      <Text size="xs" span truncate c="dimmed">
        {label}
      </Text>
    );
  }
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
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
      <Text size="xs" fw={600} span truncate sx={{ color: tone }}>
        {label}
      </Text>
    </Box>
  );
}

/**
 * Numeric cell with tabular figures + ellipsis so 1440px needs no h-scroll.
 *
 * `color` is the **leg hue** (CE blue / PE orange), never a signed tone: in a
 * chain the column already says which side it is, and a green/red wash across
 * every number buries the one thing that is really directional (the signal and
 * the net flow). Sign stays in the numeral.
 */
function tabularCell(value: string, color?: string) {
  return (
    <Box
      component="span"
      sx={{
        display: "block",
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Text size="xs" span fw={500} sx={color ? { color } : undefined}>
        {value}
      </Text>
    </Box>
  );
}

const SENTIMENT_NAMES: Record<string, string> = {
  LB: "Long Buildup",
  SB: "Short Buildup",
  SC: "Short Cover",
  LU: "Long Unwind",
};

/** GEX regime line shown in LIVE mode. */
export function gexRegimeText(regime: NiftyGex["regime"]): string {
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

export function getNiftyOiColumns(atmStrike: number | null): ColumnDef<NiftyStrike>[] {
  return [
  {
    header: "CE Chg%",
    accessorKey: "ce.priceChange",
    accessorFn: (row) => row.ce.priceChange,
    size: 66,
    meta: { align: "right" },
    cell: (info) => {
      const v = Number(info.getValue());
      return tabularCell(v.toFixed(2), palette.TERM_CE);
    },
  },
  {
    header: "CE OI Chg",
    accessorKey: "ce.oiChange",
    accessorFn: (row) => row.ce.oiChange,
    size: 88,
    meta: { align: "right" },
    cell: (info) => {
      const v = Number(info.getValue());
      return tabularCell(v.toLocaleString("en-IN"), palette.TERM_CE);
    },
  },
  {
    header: "CE Signal",
    accessorKey: "ce.sentiment",
    accessorFn: (row) => row.ce.sentiment,
    size: 114,
    meta: { align: "center" },
    cell: (info) => sentimentBadge(String(info.getValue() ?? ""), "ce"),
  },
  {
    header: "Strike",
    accessorKey: "strike",
    size: 62,
    meta: { align: "right" },
    cell: (info) => {
      const strike = Number(info.getValue());
      const isAtm = atmStrike !== null && strike === atmStrike;
      return (
        <Box
          component="span"
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            overflow: "hidden",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {/* No inline "ATM" capsule: at the chain's real width the number
              plus a capsule overflows the 50px strike column and clips the
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
    size: 114,
    meta: { align: "center" },
    cell: (info) => sentimentBadge(String(info.getValue() ?? ""), "pe"),
  },
  {
    header: "PE OI Chg",
    accessorKey: "pe.oiChange",
    accessorFn: (row) => row.pe.oiChange,
    size: 88,
    meta: { align: "right" },
    cell: (info) => {
      const v = Number(info.getValue());
      return tabularCell(v.toLocaleString("en-IN"), palette.TERM_PE);
    },
  },
  {
    header: "PE Chg%",
    accessorKey: "pe.priceChange",
    accessorFn: (row) => row.pe.priceChange,
    size: 66,
    meta: { align: "right" },
    cell: (info) => {
      const v = Number(info.getValue());
      return tabularCell(v.toFixed(2), palette.TERM_PE);
    },
  },
  ];
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

/** Hoisted `sx` objects — inline literals here would defeat `React.memo` on
 *  the receiving child (e.g. `NiftyUnusualVolume sx={{ minWidth: 0 }}`). */
const EXPIRY_SELECT_SX = { width: 220, flex: "0 0 auto", minWidth: 0 };
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
  const [view, setView] = useState<"chart" | "depth">("chart");
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
      const [data, tapeData, burstData] = await Promise.all([
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
      ]);
      if (requestId !== requestIdRef.current) return;
      setReport(data);
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
        // EOD replay — after the snapshot paints, load the recorded minute
        // frames for the same date. Absence (404 / empty tape) is not an
        // error: replay state stays null and the snapshot stays on screen.
        const replayRequest = requestId;
        void fetchNiftyReplay(date, controller.signal)
          .then((replayData) => {
            if (replayRequest !== requestIdRef.current || controller.signal.aborted) return;
            if (replayData && replayData.snapshots.length > 0) {
              setReplay(replayData);
              setReplayIndex(0);
              setReplayPlaying(false);
              const first = replayData.snapshots[0];
              setReport(first.report);
              setSensex(first.sensex ?? null);
            } else {
              setReplay(null);
              setReplayIndex(0);
              setReplayPlaying(false);
            }
          })
          .catch(() => {
            if (replayRequest === requestIdRef.current) setReplay(null);
          });
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
    setSnapshotting(true);
    setError(null);
    try {
      const data = await snapshotNifty(
        mode === "eod" ? date || undefined : undefined,
        expiry === "nearest" ? undefined : expiry,
      );
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Snapshot failed");
    } finally {
      setSnapshotting(false);
    }
  }, [mode, date, expiry]);

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

  const oiColumns = useMemo(() => getNiftyOiColumns(atmStrike), [atmStrike]);

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

  // Session trend per tape minute, computed ONCE per tape (single sort + one
  // EMA pass) instead of re-sorting the whole tape for every burst
  // (O(bursts × rows log rows) per render). Bursts then attach their trend by
  // minute lookup — the signal gate still runs on data available at each
  // burst's own minute (never the close). A burst whose minute is absent from
  // the tape falls back to the end-of-tape trend, exactly like the old
  // per-burst `sessionTrend` call (which scanned to the end on no match).
  const sessionTrends = useMemo(() => {
    const rows = tape?.rows ?? [];
    const asc = [...rows].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    const byMinute = new Map<string, "up" | "down" | null>();
    const alpha = 2 / (TREND_EMA_SPAN + 1);
    let ema: number | null = null;
    let last = 0;
    for (const r of asc) {
      if (!Number.isFinite(r.spot) || r.spot === 0) continue;
      ema = ema === null ? r.spot : alpha * r.spot + (1 - alpha) * ema;
      last = r.spot;
      byMinute.set(r.t, last > (ema as number) ? "up" : last < (ema as number) ? "down" : null);
    }
    const end: "up" | "down" | null =
      ema === null ? null : last > ema ? "up" : last < ema ? "down" : null;
    return { byMinute, end };
  }, [tape]);

  const effectiveBursts = useMemo<OiBurst[]>(() => {
    const byId = new Map<string, OiBurst>();
    for (const b of detectedBursts) byId.set(b.id, b);
    for (const b of streamed) if (!byId.has(b.id)) byId.set(b.id, b);
    const merged = [...byId.values()];
    if (sessionTrends.byMinute.size === 0) return merged;
    // Attach the session trend at each burst's own minute so the signal gate
    // runs on data available at that time (never the close).
    return merged.map((b) => ({
      ...b,
      trend: b.trend ?? sessionTrends.byMinute.get(b.t) ?? sessionTrends.end,
    }));
  }, [detectedBursts, streamed, sessionTrends]);
  /** Minute → burst side, for the tape's burst spine. */
  const burstMap = useMemo(() => {
    const m = new Map<string, "call" | "put">();
    for (const b of effectiveBursts) m.set(b.t, b.side);
    return m;
  }, [effectiveBursts]);
  const { trail, toasts, dismissToast, clearTrail, pushToast } = useNiftyOiAlerts(
    effectiveBursts,
    report?.strikes ?? [],
    report?.spot ?? 0,
    tape != null,
    mode === "live",
    contextKey,
  );
  const burstsRef = useRef<HTMLDivElement>(null);

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
  // TS narrowing inside the format callbacks).
  const gexTopSup = report?.gex?.topPositive[0] ?? null;
  const gexTopRes = report?.gex?.topNegative[0] ?? null;

  // Stable per-render callbacks / derived data for the memoised children.
  const scrollToBursts = useCallback(() => {
    burstsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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

  return (
    <Box
      data-testid="nifty-report-panel"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        p: 1,
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        bgcolor: palette.TERM_BG,
        // Never shrink below content: the page scrolls in #app-main, not in
        // this panel. Do NOT set `overflow-x: hidden` here — a lone axis
        // forces the other to `auto`, which silently turned the whole report
        // into a second scroll container (content appeared clipped/shifted
        // relative to the page scrollbar).
        flexShrink: 0,
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
        "& [data-compact-header]": {
          minHeight: "28px",
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
        // Tables: dense but scannable — 10px numerals, 2/8 padding.
        "& .paper-tanstack-cell": {
          fontSize: "10px !important",
          padding: "2px 8px !important",
        },
        "& .paper-tanstack-header-cell": {
          fontSize: "9px !important",
          letterSpacing: "0.05em",
        },
      }}
    >
      <CompactPanel>
        {/* Single row: nowrap + horizontal scroll keeps every control on one
            ~32px line instead of wrapping to two rows at narrow widths. */}
        <Box
          data-testid="nifty-toolbar"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flexWrap: "nowrap",
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            flexShrink: 0,
            overflowX: "auto",
          }}
        >
          <SegmentedControl
            data-testid="nifty-index-toggle"
            value={selectedIndex}
            onChange={handleIndexChange}
            data={INDEX_TOGGLE_DATA}
            size="sm"
          />
          <SegmentedControl
            data-testid="nifty-mode-toggle"
            value={mode}
            onChange={handleModeChange}
            data={MODE_TOGGLE_DATA}
            size="sm"
          />
          <SegmentedControl
            data-testid="nifty-view-toggle"
            value={view}
            onChange={handleViewChange}
            data={VIEW_TOGGLE_DATA}
            size="sm"
          />
          <Select
            data-testid="nifty-expiry-select"
            value={expiry}
            onChange={handleExpiryChange}
            data={expiryData}
            size="sm"
            sx={EXPIRY_SELECT_SX}
          />
          {mode === "eod" && (
            <TextInput
              data-testid="nifty-date-input"
              type="date"
              value={date}
              onChange={setDate}
              size="sm"
              w={160}
            />
          )}
          <Box sx={{ flex: 1, minWidth: 8 }} />
          <Button
            data-testid="nifty-refresh-button"
            size="sm"
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
            size="sm"
            variant="outline"
            onClick={() => void handleSnapshot()}
            disabled={
              snapshotting || loading || (mode === "eod" && !date)
            }
          >
            Snapshot
          </Button>
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
          <Box
            data-testid="nifty-stat-strip"
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "repeat(2, minmax(0, 1fr))",
                md: "repeat(8, minmax(0, 1fr))",
              },
              alignItems: "stretch",
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
            <Box data-testid="nifty-stat-spot" sx={STAT_BAND_CELL_SX}>
              <Text span size="xs" fw={700} c="dimmed" tt="uppercase" style={STAT_BAND_LABEL_STYLE}>
                Spot
              </Text>
              <Text span size="sm" fw={700} style={STAT_BAND_VALUE_STYLE}>
                <NiftySpotValue tickSpot={wsTick?.spot} fallback={report.spot} />
              </Text>
            </Box>
            <Box data-testid="nifty-stat-pcr-oi" sx={STAT_BAND_CELL_SX}>
              <Text span size="xs" fw={700} c="dimmed" tt="uppercase" style={STAT_BAND_LABEL_STYLE}>
                PCR (OI)
              </Text>
              <Text span size="sm" fw={700} style={STAT_BAND_VALUE_STYLE}>
                <AnimatedValue value={report.pcrOi} format={format2dp} />
              </Text>
            </Box>
            <Box data-testid="nifty-stat-pcr-vol" sx={STAT_BAND_CELL_SX}>
              <Text span size="xs" fw={700} c="dimmed" tt="uppercase" style={STAT_BAND_LABEL_STYLE}>
                PCR (Vol)
              </Text>
              <Text span size="sm" fw={700} style={STAT_BAND_VALUE_STYLE}>
                <AnimatedValue value={report.pcrVol} format={format2dp} />
              </Text>
            </Box>
            <Box data-testid="nifty-stat-max-pain" sx={STAT_BAND_CELL_SX}>
              <Text span size="xs" fw={700} c="dimmed" tt="uppercase" style={STAT_BAND_LABEL_STYLE}>
                Max Pain
              </Text>
              <Text span size="sm" fw={700} style={STAT_BAND_VALUE_STYLE}>
                <AnimatedValue value={report.maxPain} format={formatInt} />
              </Text>
            </Box>
            <NiftyVerdictStrip report={report} />
          </Box>

          {sensex && (
            <Box
              data-testid="nifty-sensex-panel"
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "repeat(2, minmax(0, 1fr))",
                  md: "auto repeat(5, auto) 1fr",
                },
                alignItems: "center",
                columnGap: 3,
                px: 1.5,
                minHeight: 30,
                border: `1px solid ${palette.TERM_BORDER}`,
                borderRadius: "4px",
                bgcolor: palette.TERM_HEADER,
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                flexShrink: 0,
              }}
            >
              <Text span size="xs" fw={700} style={{ fontSize: 10, letterSpacing: "0.08em", lineHeight: 1.2 }}>
                SENSEX
              </Text>
              <SensexCell
                testId="sensex-stat-spot"
                label="Spot"
                value={sensex.spot.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              />
              <SensexCell
                testId="sensex-stat-support"
                label="Support"
                value={sensex.walls.puts[0]?.strike.toLocaleString("en-IN") ?? "—"}
              />
              <SensexCell
                testId="sensex-stat-resistance"
                label="Resistance"
                value={sensex.walls.calls[0]?.strike.toLocaleString("en-IN") ?? "—"}
              />
              <SensexCell
                testId="sensex-stat-max-pain"
                label="Max Pain"
                value={sensex.maxPain > 0 ? sensex.maxPain.toLocaleString("en-IN") : "—"}
              />
              <SensexCell testId="sensex-stat-pcr-oi" label="PCR (OI)" value={sensex.pcrOi.toFixed(2)} />
              <Text
                span
                size="xs"
                c="dimmed"
                style={{ fontSize: 9, lineHeight: 1.2, textAlign: "right", whiteSpace: "nowrap" }}
              >
                EXP {sensex.expiry || "—"} · walls from live chain
              </Text>
            </Box>
          )}

          <Box
            data-testid="nifty-main-row"
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "minmax(0, 1fr)",
                // The chain is a seven-column fixed table whose tracks are a
                // hard floor (table-layout cannot shrink below them), so a
                // plain `1fr` overflowed into a horizontal scrollbar as soon
                // as the panel dipped under ~614px — which is most screens at
                // 100% zoom. Cap the chain instead and give every remaining
                // pixel to the chart.
                lg:
                  report.timeline.length > 0
                    ? "minmax(0, 1fr) minmax(0, 280px) minmax(0, 624px)"
                    : "minmax(0, 1fr) minmax(0, 624px)",
              },
              gap: 1,
              alignItems: "stretch",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
          <NiftyChartPanel report={report} mode={mode} view={view} />

          {report.timeline.length > 0 && (
            <CompactPanel flush title="Session timeline" testId="nifty-timeline-panel" sx={{ minWidth: 0, flexShrink: 0 }}>
              {/* Inner cap: long sessions scroll here so the main row never
                  grows with the event count. Inside the panel, never a direct
                  page-column child. */}
              <Box data-testid="nifty-timeline-scroll" style={{ maxHeight: 150, overflowY: "auto" }}>
              <Timeline data-testid="nifty-timeline" active={report.timeline.length - 1}>
                {report.timeline.map((event, idx) => (
                  <TimelineItem
                    key={`${event.time}-${idx}`}
                    data-testid={`nifty-timeline-item-${idx}`}
                    title={`${event.time} — ${event.title}`}
                  >
                    <Text size="xs" c="dimmed" lh={1.4}>
                      {event.detail}
                    </Text>
                  </TimelineItem>
                ))}
              </Timeline>
              </Box>
            </CompactPanel>
          )}

          <CompactPanel
            flush
            scrollable
            title="Option-chain OI (±750 ATM)"
            testId="nifty-oi-panel"
            sx={{
              minWidth: 0,
              minHeight: 0,
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
              ref={oiWrapRef}
              data-testid="nifty-oi-wrap"
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
              dataTestId="nifty-oi-table"
              emptyMessage="No strikes for this expiry"
              fillContainer
              style={{ minWidth: 0 }}
              getRowStyle={getOiRowStyle}
              getRowTestId={getOiRowTestId}
            />
            </Box>
          </CompactPanel>
          </Box>

          <Box
            data-testid="nifty-analytics-row"
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 2fr) minmax(0, 1fr)" },
              alignItems: "stretch",
              gap: 1,
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
            <Box sx={ANALYTICS_CELL_SX}>
              <NiftyGexProfile gex={report.gex} spot={report.spot} />
            </Box>
          </Box>

          <Box
            data-testid="nifty-tape-duo"
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 2fr) minmax(0, 1fr)" },
              alignItems: "stretch",
              gap: 1,
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
          <CompactPanel flush title="OI · tick tape" testId="nifty-tape-panel" sx={{ minWidth: 0, background: palette.TERM_BG, borderColor: palette.TERM_BORDER }}>
            {tape && tape.rows.length > 0 ? (
              <NiftyTapeTable
                rows={tape.rows}
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

          {/* Same CompactPanel chrome as the tape beside it. Previously a bare
              Box with borderRadius:8, which MUI multiplies by
              theme.shape.borderRadius (8) -> a 64px radius. */}
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
          </Box>

          <Box
            data-testid="nifty-gamma-iv-row"
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1fr) minmax(0, 1fr)" },
              alignItems: "start",
              gap: 1,
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <NiftyIvStraddle tape={tape} candles={report.candles} regime={report.regime} reference={report.reference} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <NiftyGammaTime tape={tape} gex={report.gex} spot={report.spot} />
            </Box>
          </Box>

          {/* Signals grid only mounts its burst/structure wrapper when there is
              content for it (trail alerts or a structure payload). The old
              always-mounted wrapper was empty most of the session — an empty
              flex item at h=0 that still cost grid gap. `flexShrink: 0` holds
              natural height as a direct child of the page column (no
              `overflow` here — that would drop min-height:auto and collapse). */}
          <Box
            data-testid="nifty-signals-grid"
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "minmax(0, 1fr)",
                lg: trail.length > 0
                  ? "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)"
                  : "minmax(0, 1fr) minmax(0, 1fr)",
              },
              alignItems: "start",
              gap: 1,
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
          {(trail.length > 0 || report.structure != null) && (
          <Box
            data-testid="nifty-signals-row"
            sx={{
              display: { xs: "flex", lg: "contents" },
              flexWrap: "wrap",
              alignItems: "stretch",
              gap: 1,
              minWidth: 0,
              flexShrink: 0,
            }}
          >
            {trail.length > 0 && (
              <Box
                ref={burstsRef}
                data-testid="nifty-oi-bursts-wrap"
                sx={{ minWidth: 0 }}
              >
                <CompactPanel
                  flush
                  title={`OI bursts (${trail.length})`}
                  testId="nifty-oi-bursts-panel"
                  action={
                    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                      <Button
                        data-testid="nifty-oi-replay-button"
                        size="sm"
                        variant="subtle"
                        disabled={replayCursor !== null || trail.length === 0}
                        onClick={handleReplayTrail}
                      >
                        {replayCursor !== null ? "Replaying…" : "Replay"}
                      </Button>
                      <Button size="sm" variant="subtle" onClick={clearTrail}>
                        Clear
                      </Button>
                    </Box>
                  }
                >
                  <MarketAlertLog
                    alerts={trail}
                    fill={false}
                    height={oiBurstLogHeight(trail.length)}
                    onOpen={scrollToBursts}
                  />
                </CompactPanel>
              </Box>
            )}

            <NiftyStructureShifts structure={report.structure} />
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

          {mode === "live" && report.gex ? (
          <CompactPanel flush title="GEX levels" testId="nifty-gex-panel">
            <Box data-testid="nifty-gex-row">
              <CompactStatGrid>
                <CompactStat
                  dense
                  data-testid="nifty-gex-net"
                  label="Net GEX"
                  value={
                    <AnimatedValue value={report.gex.netTotal} format={formatGexTotalValue} />
                  }
                />
                <CompactStat
                  dense
                  data-testid="nifty-gex-regime"
                  label="Regime"
                  value={gexRegimeText(report.gex.regime)}
                />
                <CompactStat
                  dense
                  data-testid="nifty-gex-flip"
                  label="Gamma flip"
                  value={
                    <AnimatedValue value={report.gex.zeroCross} format={formatInt} />
                  }
                />
                <CompactStat
                  dense
                  data-testid="nifty-gex-sup"
                  label="Top support"
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
                  label="Top resistance"
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
                {gexRegimeText(report.gex.regime)}
                {levels
                  ? ` — max-pain pull ${levels.painPull.dir} (${levels.painPull.pct >= 0 ? "+" : ""}${levels.painPull.pct.toFixed(2)}%). ${levels.pcrVerdict}.`
                  : "."}
              </Text>
            </Box>
          </CompactPanel>
          ) : (
          <CompactPanel flush title="Tomorrow's levels" testId="nifty-tomorrow-panel">
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
