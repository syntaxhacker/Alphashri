import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { TradingViewChart } from "@/components/chart/TradingViewChart";
import { NiftyDepthMap } from "./NiftyDepthMap";
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
import { detectOiBursts, sessionTrend } from "./niftyOiBursts";
import { useNiftyBurstStream } from "@/hooks/useNiftyBurstStream";
import { useNiftyReportStream } from "@/hooks/useNiftyReportStream";
import type { OiBurst } from "./niftyOiBursts";
import { TanStackTable } from "@/components/common/TanStackTable";
import { AnimatedValue } from "@/components/common/AnimatedValue";
import { CompactPanel, CompactStat, CompactStatGrid } from "@/components/common/compact";
import { EmptyCompact, ErrorAlert, InlineLoader } from "@/components/common/states";
import type { ColumnDef } from "@tanstack/react-table";
import type { MarkLineData } from "@/utils/chart/types";
import type {
  NiftyBurst,
  NiftyGex,
  NiftyIntradayCandle,
  NiftyReport,
  NiftyReportMode,
  NiftySensex,
  NiftyStrike,
  NiftyTape,
} from "@/types/niftyReport";
import type { ReplayCandle } from "@/types/replay";
import { fetchLiveNifty, fetchLiveSensex, fetchNiftyByDate, fetchNiftyExpiries, fetchNiftyTape, fetchNiftyBursts, snapshotNifty } from "@/api/reportNifty";

export interface NiftyReportPanelProps {
  onOpenSymbol?: (s: string) => void;
}

export function buildMarkLines(report: NiftyReport, withGex = false): MarkLineData[] {
  const lines: MarkLineData[] = [];
  const used: number[] = [];
  const fresh = (s: number) => !used.some((u) => Math.abs(u - s) <= 25);

  // Call/put walls and max pain as horizontal price LINES. These were shaded
  // price zones previously; the bands were too heavy, so they are lines now.
  const topCalls = [...report.walls.calls].sort((a, b) => b.oi - a.oi).slice(0, 2);
  const topPuts = [...report.walls.puts].sort((a, b) => b.oi - a.oi).slice(0, 2);
  for (const w of topCalls) {
    lines.push({
      yAxis: w.strike,
      lineStyle: { color: palette.NEGATIVE, type: "dashed", width: 1 },
      label: { position: "insideEndTop", formatter: `CW ${w.strike}` },
    });
    used.push(w.strike);
  }
  for (const w of topPuts) {
    lines.push({
      yAxis: w.strike,
      lineStyle: { color: palette.POSITIVE, type: "dashed", width: 1 },
      label: { position: "insideEndTop", formatter: `PW ${w.strike}` },
    });
    used.push(w.strike);
  }
  if (Number.isFinite(report.maxPain) && report.maxPain > 0) {
    lines.push({
      yAxis: report.maxPain,
      lineStyle: { color: palette.PRIMARY, type: "solid", width: 2 },
      label: { position: "insideEndTop", formatter: `MP ${report.maxPain}` },
    });
    used.push(report.maxPain);
  }

  // Prior-session pivots: PP anchors the day (solid muted); resistance above
  // (dashed red) and support below (dashed green). Levels are computed by the
  // backend (`pivots` block, null-safe); nulls are skipped and anything that
  // lands within 25 pts of an already-drawn line is de-duped like GEX tags.
  const pivot = report.pivots;
  if (pivot) {
    const levels: [string, number | null, string, string][] = [
      ["PP", pivot.pp, palette.TEXT_MUTED, "solid"],
      ["R1", pivot.r1, palette.NEGATIVE, "dashed"],
      ["R2", pivot.r2, palette.NEGATIVE, "dashed"],
      ["S1", pivot.s1, palette.POSITIVE, "dashed"],
      ["S2", pivot.s2, palette.POSITIVE, "dashed"],
    ];
    for (const [code, value, color, lineType] of levels) {
      if (value === null || !Number.isFinite(value) || !fresh(value)) continue;
      lines.push({
        yAxis: value,
        lineStyle: { color, type: lineType, width: 1 },
        label: {
          position: "insideEndTop",
          formatter: `${code} ${Math.round(value).toLocaleString("en-IN")}`,
        },
      });
      used.push(value);
    }
  }

  // Optional live GEX overlay: flip + gamma support/resistance, skipping
  // strikes already drawn so the gutter never doubles up.
  if (!withGex || !report.gex) return lines;

  const g = report.gex;
  if (g) {
    if (g.zeroCross != null && fresh(g.zeroCross)) {
      lines.push({
        yAxis: g.zeroCross,
        lineStyle: { color: palette.WARNING, type: "dotted", width: 1 },
        label: { position: "insideEndTop", formatter: `FLIP ${g.zeroCross}` },
      });
      used.push(g.zeroCross);
    }
    for (const s of g.topPositive) {
      if (!fresh(s.strike)) continue;
      lines.push({
        yAxis: s.strike,
        lineStyle: { color: palette.POSITIVE, type: "solid", width: 1 },
        label: { position: "insideEndTop", formatter: `GSUP ${s.strike}` },
      });
      used.push(s.strike);
    }
    for (const s of g.topNegative) {
      if (!fresh(s.strike)) continue;
      lines.push({
        yAxis: s.strike,
        lineStyle: { color: palette.NEGATIVE, type: "solid", width: 1 },
        label: { position: "insideEndTop", formatter: `GRES ${s.strike}` },
      });
      used.push(s.strike);
    }
  }
  return lines;
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

/** One candle timestamp split into wall-clock parts. `offset` keeps the
 *  source's timezone suffix (e.g. "+05:30") so bucket timestamps stay on the
 *  same timezone semantics as the candles they were built from. */
interface CandleClock {
  day: string;
  hh: number;
  mm: number;
  offset: string;
}

function parseCandleClock(time: string): CandleClock | null {
  const m =
    /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})(?::\d{2})?(Z|[+-]\d{2}:?\d{2})?/.exec(
      time,
    );
  if (!m) return null;
  return {
    day: m[1],
    hh: Number(m[2]),
    mm: Number(m[3]),
    offset: m[4] ?? "",
  };
}

/**
 * Resample candles into `minutes` bars for the Nifty chart timeframe toggle.
 * Buckets key on `floor(minutesSinceMidnight / minutes)` per calendar day —
 * the candle's own wall clock, never UTC math — so NSE's 09:15 open stays
 * bucket-aligned for both 5m and 15m. OHLCV folds first-open / max-high /
 * min-low / last-close / summed-volume per bucket. 1m returns the input
 * element-for-element (intraday candles may lack `volume`, which the chart
 * treats as 0; resampled buckets always carry a summed volume). Candles whose
 * timestamp cannot be parsed are skipped — they have no bucket to join.
 */
export function resampleCandles(
  candles: (NiftyIntradayCandle | ReplayCandle)[],
  minutes: number,
): ReplayCandle[] {
  // Normalize once: intraday candles may lack `volume` (the chart treats it
  // as 0); resampled buckets always carry a summed volume.
  const src: ReplayCandle[] = candles.map((c): ReplayCandle =>
    "volume" in c ? c : { ...c, volume: 0 },
  );
  if (minutes <= 1) return src;
  const out: ReplayCandle[] = [];
  let curDay = "";
  let curBucket = -1;
  let cur: ReplayCandle | null = null;
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  for (const c of src) {
    const clock = parseCandleClock(c.time);
    if (!clock) continue;
    const bucket = Math.floor((clock.hh * 60 + clock.mm) / minutes);
    if (cur && curDay === clock.day && curBucket === bucket) {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    } else {
      flush();
      const start = bucket * minutes;
      const hh = String(Math.floor(start / 60)).padStart(2, "0");
      const mm = String(start % 60).padStart(2, "0");
      curDay = clock.day;
      curBucket = bucket;
      cur = {
        time: `${clock.day}T${hh}:${mm}:00${clock.offset}`,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      };
    }
  }
  flush();
  return out;
}

/**
 * EMA(period) over `closes`, aligned index-wise. Seeded with the mean of the
 * first `period` closes, then recursive; points before the seed are `null`.
 * Pure, so the panel recomputes it on the displayed (resampled) candles and
 * the overlays always match the charted timeframe.
 */
export function emaSeries(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null);
  if (period < 1 || closes.length < period) return out;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

/** What the chart level tags mean. GEX tags exist in live mode only. */
export function LevelLegend({ live }: { live: boolean }) {
  const items: { code: string; color: string; meaning: string; zone?: boolean }[] = [
    { code: "CW", color: palette.NEGATIVE, meaning: "top call-OI wall · resistance", zone: true },
    { code: "PW", color: palette.POSITIVE, meaning: "top put-OI wall · support", zone: true },
    { code: "MP", color: palette.PRIMARY, meaning: "max pain · expiry magnet", zone: true },
  ];
  if (live) {
    items.push(
      { code: "FLIP", color: palette.WARNING, meaning: "gamma flip · dealers switch sides here" },
      { code: "GSUP", color: palette.POSITIVE, meaning: "gamma support · pin magnet" },
      { code: "GRES", color: palette.NEGATIVE, meaning: "gamma resistance · breakout fuel" },
    );
  }
  return (
    // Single dense wrapped row: tight gaps + minimal top pad so the legend
    // costs one ~16px row instead of two. Fonts/symbols untouched.
    <Box
      data-testid="nifty-level-legend"
      sx={{ display: "flex", flexWrap: "wrap", columnGap: 1, rowGap: 0.5, pt: 0.5 }}
    >
      {items.map((it) => (
        <Box
          key={it.code}
          sx={{ display: "flex", alignItems: "center", gap: 1, whiteSpace: "nowrap" }}
        >
          <Box
            sx={{
              width: it.zone ? 12 : 8,
              height: it.zone ? 8 : 8,
              borderRadius: it.zone ? 1 : "50%",
              backgroundColor: it.zone ? hexToRgba(it.color, 0.18) : it.color,
              border: it.zone ? `1px solid ${it.color}` : "none",
              flexShrink: 0,
            }}
          />
          <Text size="xs" fw={700} span>
            {it.code}
          </Text>
          <Text size="xs" c="dimmed" span>
            {it.meaning}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function sentimentBadge(sentiment: string, side: "ce" | "pe") {
  const code = sentiment.trim().toUpperCase();
  const label = SENTIMENT_NAMES[code] ?? sentiment;
  // Same buildup code means opposite things per side:
  // calls rise on buying (LB/SC bullish), puts rise on fear (LB bearish).
  const bullish =
    side === "ce" ? code === "LB" || code === "SC" : code === "SB" || code === "SC";
  const tone = code === "NEUTRAL" || !SENTIMENT_NAMES[code] ? palette.TEXT_MUTED : bullish ? palette.POSITIVE : palette.NEGATIVE;
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        border: "1px solid",
        borderColor: tone,
        borderRadius: 999,
        px: 1,
        py: 0.25,
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "middle",
      }}
    >
      <Text size="xs" fw={600} c={tone} span truncate>
        {label}
      </Text>
    </Box>
  );
}

/** Numeric cell with tabular figures + ellipsis so 1440px needs no h-scroll. */
function tabularCell(value: string, tone?: "success" | "error") {
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
      <Text size="xs" span c={tone ?? "default"} fw={tone ? 600 : 400}>
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

function signedTone(v: number): "success" | "error" | undefined {
  if (v > 0) return "success";
  if (v < 0) return "error";
  return undefined;
}

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

/** Chart height presets (px) for the "Nifty chart" panel size control. */
export const CHART_HEIGHTS = { s: 180, m: 320, l: 520, xl: 760 } as const;
export type ChartSize = keyof typeof CHART_HEIGHTS;

/** Chart timeframe presets and their bar size in minutes. The `intraday`
    feed is 1-minute; 5m/15m are resampled client-side (see `resampleCandles`). */
export type ChartTimeframe = "1m" | "5m" | "15m";
export const CHART_TF_MINUTES: Record<ChartTimeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
};
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
    size: 84,
    meta: { align: "right" },
    cell: (info) => {
      const v = Number(info.getValue());
      return tabularCell(v.toFixed(2), signedTone(v));
    },
  },
  {
    header: "CE OI Chg",
    accessorKey: "ce.oiChange",
    accessorFn: (row) => row.ce.oiChange,
    size: 110,
    meta: { align: "right" },
    cell: (info) => {
      const v = Number(info.getValue());
      return tabularCell(v.toLocaleString("en-IN"), signedTone(v));
    },
  },
  {
    header: "CE Signal",
    accessorKey: "ce.sentiment",
    accessorFn: (row) => row.ce.sentiment,
    size: 112,
    meta: { align: "center" },
    cell: (info) => sentimentBadge(String(info.getValue() ?? ""), "ce"),
  },
  {
    header: "Strike",
    accessorKey: "strike",
    size: 88,
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
            gap: 1,
            overflow: "hidden",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <Text size="xs" span fw={700}>
            {strike.toLocaleString("en-IN")}
          </Text>
          {isAtm && (
            <Box
              component="span"
              data-testid="nifty-strike-atm-badge"
              sx={{
                display: "inline-block",
                border: "1px solid",
                borderColor: palette.WARNING,
                borderRadius: 999,
                px: 1,
                py: 0.25,
                whiteSpace: "nowrap",
                verticalAlign: "middle",
              }}
            >
              <Text size="xs" fw={600} c="warning" span>
                ATM
              </Text>
            </Box>
          )}
        </Box>
      );
    },
  },
  {
    header: "PE Signal",
    accessorKey: "pe.sentiment",
    accessorFn: (row) => row.pe.sentiment,
    size: 112,
    meta: { align: "center" },
    cell: (info) => sentimentBadge(String(info.getValue() ?? ""), "pe"),
  },
  {
    header: "PE OI Chg",
    accessorKey: "pe.oiChange",
    accessorFn: (row) => row.pe.oiChange,
    size: 110,
    meta: { align: "right" },
    cell: (info) => {
      const v = Number(info.getValue());
      return tabularCell(v.toLocaleString("en-IN"), signedTone(v));
    },
  },
  {
    header: "PE Chg%",
    accessorKey: "pe.priceChange",
    accessorFn: (row) => row.pe.priceChange,
    size: 84,
    meta: { align: "right" },
    cell: (info) => {
      const v = Number(info.getValue());
      return tabularCell(v.toFixed(2), signedTone(v));
    },
  },
  ];
}

export function NiftyReportPanel({ onOpenSymbol }: NiftyReportPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState<"nifty" | "sensex">("nifty");
  const [mode, setMode] = useState<NiftyReportMode>("live");
  const [expiry, setExpiry] = useState<string>("nearest");
  const [expiryOptions, setExpiryOptions] = useState<string[]>([]);
  const [date, setDate] = useState<string>("");
  const [report, setReport] = useState<NiftyReport | null>(null);
  const [sensex, setSensex] = useState<NiftySensex | null>(null);
  const [sensexLoading, setSensexLoading] = useState(false);
  const [sensexError, setSensexError] = useState<string | null>(null);
  const [tape, setTape] = useState<NiftyTape | null>(null);
  /** Backend-detected bursts; null = endpoint unavailable → derive locally. */
  const [bursts, setBursts] = useState<OiBurst[] | null>(null);
  const [view, setView] = useState<"chart" | "depth">("chart");
  const [chartSize, setChartSize] = useState<ChartSize>("s");
  /** Chart bar timeframe: 1m native; 5m/15m resampled client-side. */
  const [chartTf, setChartTf] = useState<ChartTimeframe>("1m");
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

  // Exchange session gate (from the `market` block). When closed, the
  // snapshot is labelled "Market closed" instead of "live".
  const marketClosed = report?.market?.is_open === false;
  const contextKey = mode === "eod" ? `eod:${date}` : `live:${expiry}`;
  const prevContext = useRef(contextKey);

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
    },
    [],
  );

  useEffect(() => {
    if (mode === "live" || (mode === "eod" && date)) {
      void load();
    }
  }, [mode, load, date]);

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

  // A pushed spot tick advances the "Updated" label so the header feels live
  // between report frames.
  useEffect(() => {
    if (wsTick) {
      setUpdatedAtMs(Date.now());
    }
  }, [wsTick]);

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

  const markLines = useMemo(
    () => (report ? buildMarkLines(report, mode === "live" && !!report.gex) : []),
    [report, mode],
  );

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
        ? {
            background: hexToRgba(palette.WARNING, 0.1),
            borderTop: `1px solid ${palette.WARNING}`,
            borderBottom: `1px solid ${palette.WARNING}`,
          }
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

  /** 1-minute intraday candles when present, else the 15-min EOD candles —
   *  each resampled to the selected timeframe (1m passes through). */
  const chartCandles = useMemo(
    () =>
      resampleCandles(
        report?.intraday && report.intraday.length > 0
          ? report.intraday
          : (report?.candles ?? []),
        CHART_TF_MINUTES[chartTf],
      ),
    [report, chartTf],
  );

  /** EMA9 (warning) + EMA20 (primary), recomputed on the displayed candles so
   *  the overlays always match the selected timeframe. The backend `emas`
   *  block is intentionally ignored here (it is fixed to the 1-minute grid). */
  const emaData = useMemo(() => {
    const closes = chartCandles.map((c) => c.close);
    return [
      { label: "EMA9", color: palette.WARNING, data: emaSeries(closes, 9) },
      { label: "EMA20", color: palette.PRIMARY, data: emaSeries(closes, 20) },
    ];
  }, [chartCandles]);

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

  const effectiveBursts = useMemo<OiBurst[]>(() => {
    const base = bursts && bursts.length > 0 ? bursts : detectOiBursts(tape?.rows ?? []);
    const byId = new Map<string, OiBurst>();
    for (const b of base) byId.set(b.id, b);
    for (const b of streamed) if (!byId.has(b.id)) byId.set(b.id, b);
    const rows = tape?.rows ?? [];
    const merged = [...byId.values()];
    if (rows.length === 0) return merged;
    // Attach the session trend at each burst's own minute so the signal gate
    // runs on data available at that time (never the close).
    return merged.map((b) => ({ ...b, trend: b.trend ?? sessionTrend(rows, b.t) ?? null }));
  }, [bursts, tape, streamed]);
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
  const updatedAtLabel =
    updatedAtMs === null
      ? ""
      : new Date(updatedAtMs).toLocaleTimeString("en-IN", {
          hour12: false,
          timeZone: "Asia/Kolkata",
        });

  // Hoisted so the GEX stat formats below can close over consts (keeps
  // TS narrowing inside the format callbacks).
  const gexTopSup = report?.gex?.topPositive[0] ?? null;
  const gexTopRes = report?.gex?.topNegative[0] ?? null;

  return (
    <Box
      data-testid="nifty-report-panel"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.25,
        p: 0.25,
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        bgcolor: palette.TERM_BG,
        // Never shrink below content: the page must scroll in #app-main rather
        // than squeeze rows (which clipped panels when the viewport was short).
        flexShrink: 0,
        overflowX: "hidden",
        // --- Dense / cardless skin (report page only) ---------------------
        // Panels drop their card chrome; headers become small uppercase
        // labels; every surface's padding shrinks. Scoped via data hooks on
        // CompactPanel/CompactStat so other pages keep their card look.
        "& [data-compact]": {
          bgcolor: "transparent",
          border: "none !important",
          borderRadius: "0 !important",
          boxShadow: "none",
        },
        "& [data-compact-header]": {
          p: "1px 4px !important",
          mb: "1px !important",
          borderBottom: `1px solid ${palette.TERM_BORDER} !important`,
        },
        "& [data-compact-header] .MuiTypography-root": {
          fontSize: "10px !important",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: `${palette.TEXT_MUTED} !important`,
          fontWeight: 700,
        },
        "& .MuiCardContent-root": {
          p: "2px 4px !important",
          "&:last-child": { pb: "2px !important" },
        },
        "& [data-compact-stat]": {
          bgcolor: "transparent !important",
          border: "none !important",
        },
        "& [data-compact-stat] .MuiCardContent-root": {
          p: "0px 3px !important",
          gap: "0px !important",
        },
        "& [data-compact-stat] .MuiTypography-root": { lineHeight: 1.05 },
        "& .MuiCardContent-root > div": { mb: "2px !important" },
        // Tables: smaller, tighter rows.
        "& .paper-tanstack-cell": {
          fontSize: "10px !important",
          padding: "0px 5px !important",
        },
        "& .paper-tanstack-header-cell": { fontSize: "9px !important" },
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
            onChange={(v) => {
              const next = v as "nifty" | "sensex";
              setSelectedIndex(next);
              if (next === "sensex") {
                setMode("live");
                setView("chart");
              }
            }}
            data={[
              { value: "nifty", label: "NIFTY" },
              { value: "sensex", label: "SENSEX" },
            ]}
            size="sm"
          />
          <SegmentedControl
            data-testid="nifty-mode-toggle"
            value={mode}
            onChange={(v) => setMode(v as NiftyReportMode)}
            data={[
              { value: "live", label: "Live" },
              { value: "eod", label: "EOD" },
            ]}
            size="sm"
          />
          <SegmentedControl
            data-testid="nifty-view-toggle"
            value={view}
            onChange={(v) => setView(v as "chart" | "depth")}
            data={[
              { value: "chart", label: "Chart" },
              { value: "depth", label: "Depth" },
            ]}
            size="sm"
          />
          <Select
            data-testid="nifty-expiry-select"
            value={expiry}
            onChange={(v) => setExpiry(v ?? "nearest")}
            data={[
              { value: "nearest", label: "Nearest expiry" },
              ...expiryOptions.map((d) => ({ value: d, label: d })),
            ]}
            size="sm"
            sx={{ width: 220, flex: "0 0 auto", minWidth: 0 }}
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
          <Button
            data-testid="nifty-refresh-button"
            size="sm"
            onClick={handleRefresh}
            disabled={loading || (mode === "eod" && !date)}
          >
            Refresh
          </Button>
          {mode === "live" && updatedAtMs !== null && (
            <Text
              data-testid="nifty-updated-at"
              size="xs"
              c={isStale ? "warning" : "dimmed"}
              span
            >
              {marketClosed
                ? `Market closed${report?.market?.session_date ? ` · last session ${report.market.session_date}` : ""}`
                : `Updated ${updatedAtLabel} · live (WS)`}
            </Text>
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
              gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "auto minmax(0, 1fr)" },
              gap: 0.5,
              alignItems: "stretch",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
            <CompactStatGrid>
              <CompactStat
                dense
                data-testid="nifty-stat-spot"
                label="Spot"
                value={
                  <AnimatedValue
                    value={wsTick?.spot ?? report.spot}
                    format={(v) => v.toLocaleString("en-IN")}
                  />
                }
              />
              <CompactStat
                dense
                data-testid="nifty-stat-pcr-oi"
                label="PCR (OI)"
                value={
                  <AnimatedValue
                    value={report.pcrOi}
                    format={(v) => v.toFixed(2)}
                  />
                }
              />
              <CompactStat
                dense
                data-testid="nifty-stat-pcr-vol"
                label="PCR (Vol)"
                value={
                  <AnimatedValue
                    value={report.pcrVol}
                    format={(v) => v.toFixed(2)}
                  />
                }
              />
              <CompactStat
                dense
                data-testid="nifty-stat-max-pain"
                label="Max Pain"
                value={
                  <AnimatedValue
                    value={report.maxPain}
                    format={(v) => v.toLocaleString("en-IN")}
                  />
                }
              />
            </CompactStatGrid>
            <NiftyVerdictStrip report={report} />
          </Box>

          {sensex && (
            <CompactPanel title="Sensex live" testId="nifty-sensex-panel" sx={{ minWidth: 0, flexShrink: 0 }}>
              <CompactStatGrid>
                <CompactStat
                  dense
                  data-testid="sensex-stat-spot"
                  label="Spot"
                  value={sensex.spot.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                />
                <CompactStat
                  dense
                  data-testid="sensex-stat-support"
                  label="Support"
                  value={sensex.walls.puts[0]?.strike.toLocaleString("en-IN") ?? "—"}
                />
                <CompactStat
                  dense
                  data-testid="sensex-stat-resistance"
                  label="Resistance"
                  value={sensex.walls.calls[0]?.strike.toLocaleString("en-IN") ?? "—"}
                />
                <CompactStat
                  dense
                  data-testid="sensex-stat-max-pain"
                  label="Max Pain"
                  value={sensex.maxPain > 0 ? sensex.maxPain.toLocaleString("en-IN") : "—"}
                />
                <CompactStat
                  dense
                  data-testid="sensex-stat-pcr-oi"
                  label="PCR (OI)"
                  value={sensex.pcrOi.toFixed(2)}
                />
              </CompactStatGrid>
              <Text size="xs" c="dimmed">
                Expiry {sensex.expiry || "—"} · levels are live option-chain walls.
              </Text>
            </CompactPanel>
          )}

          <Box
            data-testid="nifty-main-row"
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "minmax(0, 1fr)",
                lg:
                  report.timeline.length > 0
                    ? "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)"
                    : "minmax(0, 2fr) minmax(0, 1fr)",
              },
              gap: 1,
              alignItems: "stretch",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              flexShrink: 0,
            }}
          >
          <CompactPanel
            title={view === "depth" ? "Nifty depth map" : "Nifty chart"}
            testId="nifty-chart-panel"
            sx={{ minWidth: 0, flexShrink: 0 }}
            action={
              view === "chart" ? (
                <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                  <SegmentedControl
                    data-testid="nifty-tf-toggle"
                    value={chartTf}
                    onChange={(v) => setChartTf(v as ChartTimeframe)}
                    data={[
                      { value: "1m", label: "1m" },
                      { value: "5m", label: "5m" },
                      { value: "15m", label: "15m" },
                    ]}
                    size="sm"
                  />
                  <SegmentedControl
                    data-testid="nifty-chart-size"
                    value={chartSize}
                    onChange={(v) => setChartSize(v as ChartSize)}
                    data={[
                      { value: "s", label: "S" },
                      { value: "m", label: "M" },
                      { value: "l", label: "L" },
                      { value: "xl", label: "XL" },
                    ]}
                    size="sm"
                  />
                </Box>
              ) : undefined
            }
          >
            {view === "depth" ? (
              <NiftyDepthMap report={report} />
            ) : chartCandles && chartCandles.length > 0 ? (
              <Box
                data-testid="nifty-chart-wrap"
                style={{ height: CHART_HEIGHTS[chartSize] }}
                sx={{
                  display: "flex",
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: 0,
                  flexShrink: 0,
                  overflow: "hidden",
                }}
              >
                <TradingViewChart
                  candles={chartCandles}
                  markLines={markLines}
                  emaData={emaData}
                  height={CHART_HEIGHTS[chartSize]}
                />
              </Box>
            ) : (
              <EmptyCompact
                data-testid="nifty-chart-empty"
                title="No intraday candles"
                description="Showing option-chain levels only."
              />
            )}
            <LevelLegend live={mode === "live" && !!report.gex} />
          </CompactPanel>

          {report.timeline.length > 0 && (
            <CompactPanel title="Session timeline" testId="nifty-timeline-panel" sx={{ minWidth: 0, flexShrink: 0 }}>
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

          <CompactPanel title="Option-chain OI (±750 ATM)" testId="nifty-oi-panel" sx={{ minWidth: 0, flexShrink: 0 }}>
            {/* Fixed 180px body: the table fills it and scrolls internally
                (fillContainer). No min-height larger than content, no vh. */}
            <Box
              ref={oiWrapRef}
              data-testid="nifty-oi-wrap"
              style={{ height: 180 }}
              sx={{
                display: "flex",
                minWidth: 0,
                flexShrink: 0,
              }}
            >
            <TanStackTable<NiftyStrike>
              data={visibleStrikes}
              columns={oiColumns}
              dataTestId="nifty-oi-table"
              emptyMessage="No strikes for this expiry"
              fillContainer
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
            <Box sx={{ minWidth: 0 }}>
              <NiftyDeltaPositioning positioning={report.positioning} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
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
          <CompactPanel title="OI · tick tape" testId="nifty-tape-panel" sx={{ minWidth: 0, background: palette.TERM_BG, borderColor: palette.TERM_BORDER }}>
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
            padded={false}
            testId="nifty-unusual-panel-wrap"
            sx={{ minWidth: 0, background: UNUSUAL_TERM_BG, borderColor: UNUSUAL_TERM_BORDER }}
          >
            <NiftyUnusualVolume
              strikes={report.strikes}
              spot={report.spot}
              sx={{ minWidth: 0 }}
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
                  title={`OI bursts (${trail.length})`}
                  testId="nifty-oi-bursts-panel"
                  action={
                    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                      <Button
                        data-testid="nifty-oi-replay-button"
                        size="sm"
                        variant="subtle"
                        disabled={replayCursor !== null || trail.length === 0}
                        onClick={() => setReplayCursor(trail.length - 1)}
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
                    onOpen={() => burstsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })}
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
                onOpen={() => burstsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })}
              />
            </Box>
          )}

          {mode === "live" && report.gex ? (
          <CompactPanel title="GEX levels" testId="nifty-gex-panel">
            <Box data-testid="nifty-gex-row">
              <CompactStatGrid>
                <CompactStat
                  dense
                  data-testid="nifty-gex-net"
                  label="Net GEX"
                  value={
                    <AnimatedValue
                      value={report.gex.netTotal}
                      format={(v) => formatGexTotal(v)}
                    />
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
                    <AnimatedValue
                      value={report.gex.zeroCross}
                      format={(v) => v.toLocaleString("en-IN")}
                    />
                  }
                />
                <CompactStat
                  dense
                  data-testid="nifty-gex-sup"
                  label="Top support"
                  value={
                    gexTopSup ? (
                      <AnimatedValue
                        value={gexTopSup.strike}
                        format={(s) => formatGexLevel(s, gexTopSup.netGex)}
                      />
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
                      <AnimatedValue
                        value={gexTopRes.strike}
                        format={(s) => formatGexLevel(s, gexTopRes.netGex)}
                      />
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
          <CompactPanel title="Tomorrow's levels" testId="nifty-tomorrow-panel">
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
              onClick={() => onOpenSymbol("NIFTY")}
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
