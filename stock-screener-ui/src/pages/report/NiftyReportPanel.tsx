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
import { NiftyUnusualVolume } from "./NiftyUnusualVolume";
import { MarketAlertLog, MarketAlertStack } from "@/components/notifications/MarketAlertCard";
import { OI_ALERT_TOAST_MAX, useNiftyOiAlerts } from "./useNiftyOiAlerts";
import { detectOiBursts } from "./niftyOiBursts";
import type { OiBurst } from "./niftyOiBursts";
import { TanStackTable } from "@/components/common/TanStackTable";
import { CompactPanel, CompactStat, CompactStatGrid } from "@/components/common/compact";
import { EmptyCompact, ErrorAlert, InlineLoader } from "@/components/common/states";
import type { ColumnDef } from "@tanstack/react-table";
import type { MarkLineData } from "@/utils/chart/types";
import type {
  NiftyGex,
  NiftyReport,
  NiftyReportMode,
  NiftyStrike,
  NiftyTape,
} from "@/types/niftyReport";
import { fetchLiveNifty, fetchNiftyByDate, fetchNiftyExpiries, fetchNiftyTape, fetchNiftyBursts, snapshotNifty } from "@/api/reportNifty";

export interface NiftyReportPanelProps {
  onOpenSymbol?: (s: string) => void;
}

export function buildMarkLines(report: NiftyReport, withGex = false): MarkLineData[] {
  const lines: MarkLineData[] = [];
  const used: number[] = [];
  const fresh = (s: number) => !used.some((u) => Math.abs(u - s) <= 25);
  const topCalls = [...report.walls.calls]
    .sort((a, b) => b.oi - a.oi)
    .slice(0, 2);
  const topPuts = [...report.walls.puts]
    .sort((a, b) => b.oi - a.oi)
    .slice(0, 2);
  for (const wall of topCalls) {
    lines.push({
      yAxis: wall.strike,
      lineStyle: { color: palette.NEGATIVE, type: "dashed", width: 1 },
      label: { position: "insideEndTop", formatter: `CW ${wall.strike}` },
    });
    used.push(wall.strike);
  }
  for (const wall of topPuts) {
    lines.push({
      yAxis: wall.strike,
      lineStyle: { color: palette.POSITIVE, type: "dashed", width: 1 },
      label: { position: "insideEndTop", formatter: `PW ${wall.strike}` },
    });
    used.push(wall.strike);
  }
  if (Number.isFinite(report.maxPain) && report.maxPain > 0) {
    lines.push({
      yAxis: report.maxPain,
      lineStyle: { color: palette.PRIMARY, type: "solid", width: 2 },
      label: { position: "insideEndTop", formatter: `MP ${report.maxPain}` },
    });
    used.push(report.maxPain);
  }
  // Live GEX overlay: flip + gamma support/resistance, skipping strikes
  // already drawn as walls so the gutter never doubles up.
  if (withGex && report.gex) {
    const g = report.gex;
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

/** What the chart level tags mean. GEX tags exist in live mode only. */
export function LevelLegend({ live }: { live: boolean }) {
  const items: { code: string; color: string; meaning: string }[] = [
    { code: "CW", color: palette.NEGATIVE, meaning: "top call-OI wall · resistance" },
    { code: "PW", color: palette.POSITIVE, meaning: "top put-OI wall · support" },
    { code: "MP", color: palette.PRIMARY, meaning: "max pain · expiry magnet" },
  ];
  if (live) {
    items.push(
      { code: "FLIP", color: palette.WARNING, meaning: "gamma flip · dealers switch sides here" },
      { code: "GSUP", color: palette.POSITIVE, meaning: "gamma support · pin magnet" },
      { code: "GRES", color: palette.NEGATIVE, meaning: "gamma resistance · breakout fuel" },
    );
  }
  return (
    <Box
      data-testid="nifty-level-legend"
      sx={{ display: "flex", flexWrap: "wrap", gap: 2, pt: 1 }}
    >
      {items.map((it) => (
        <Box
          key={it.code}
          sx={{ display: "flex", alignItems: "center", gap: 1, whiteSpace: "nowrap" }}
        >
          <Box sx={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: it.color, flexShrink: 0 }} />
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

/** Live poll cadence; backend `/live` already caches for 60s. */
const LIVE_POLL_MS = 30_000;
/** Data older than this is shown with a stale badge instead of an error. */
const STALE_AFTER_MS = 90_000;

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
  const [mode, setMode] = useState<NiftyReportMode>("live");
  const [expiry, setExpiry] = useState<string>("nearest");
  const [expiryOptions, setExpiryOptions] = useState<string[]>([]);
  const [date, setDate] = useState<string>("");
  const [report, setReport] = useState<NiftyReport | null>(null);
  const [tape, setTape] = useState<NiftyTape | null>(null);
  /** Backend-detected bursts; null = endpoint unavailable → derive locally. */
  const [bursts, setBursts] = useState<OiBurst[] | null>(null);
  const [view, setView] = useState<"chart" | "depth">("chart");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshotting, setSnapshotting] = useState<boolean>(false);
  // Live auto-refresh bookkeeping: last-good timestamp, consecutive
  // failures (drives retry backoff), wall-clock for staleness display,
  // and a nonce so manual Refresh restarts the poll timer.
  const [updatedAtMs, setUpdatedAtMs] = useState<number | null>(null);
  const [failures, setFailures] = useState<number>(0);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [refreshKey, setRefreshKey] = useState<number>(0);
  // Overlap guard: skip a poll tick while a fetch is still in flight.
  const loadingRef = useRef<boolean>(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const [data, tapeData, burstData] = await Promise.all([
        mode === "live"
          ? fetchLiveNifty(expiry === "nearest" ? undefined : expiry)
          : fetchNiftyByDate(date),
        // Tape failures stay non-fatal: keep the last-good tape on screen.
        fetchNiftyTape(mode === "eod" ? date || undefined : undefined).catch(
          () => null,
        ),
        // Bursts are backend-derived (survive tab close); never fatal.
        fetchNiftyBursts(mode === "eod" ? date || undefined : undefined),
      ]);
      setReport(data);
      if (tapeData) setTape(tapeData);
      setBursts(burstData as OiBurst[]);
      setFailures(0);
      const now = Date.now();
      setUpdatedAtMs(now);
      setNowMs(now);
    } catch (e) {
      // Keep the last-good report on screen; the full error alert only
      // renders when there is no cached data (see below).
      setFailures((f) => f + 1);
      setNowMs(Date.now());
      setError(e instanceof Error ? e.message : "Failed to load Nifty report");
    } finally {
      loadingRef.current = false;
      setLoading(false);
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

  useEffect(() => {
    if (mode === "live" || (mode === "eod" && date)) {
      void load();
    }
  }, [mode, load, date]);

  // Context switch (mode/expiry/date): drop stale report + tape so the new
  // context loads clean — otherwise an EOD 404 hides behind cached live data
  // and the error/empty states never render.
  const contextKey = mode === "eod" ? `eod:${date}` : `live:${expiry}`;
  const prevContext = useRef(contextKey);
  useEffect(() => {
    if (prevContext.current !== contextKey) {
      prevContext.current = contextKey;
      setReport(null);
      setTape(null);
      setBursts(null);
      setError(null);
      setFailures(0);
    }
  }, [contextKey]);

  // Live auto-refresh: refetch on a 30s interval; on failure back off to
  // 15s/30s/60s (capped at 60s) until success. The interval resets whenever
  // mode/expiry/date/failure-count changes or Refresh is pressed, and is
  // cleared on unmount or when leaving live mode. Ticks are skipped while
  // the tab is hidden or a fetch is in flight — never piled up.
  useEffect(() => {
    if (mode !== "live") return;
    const delay =
      failures <= 0 ? LIVE_POLL_MS : failures === 1 ? 15_000 : failures === 2 ? 30_000 : 60_000;
    const id = setInterval(() => {
      setNowMs(Date.now());
      if (document.hidden) return;
      if (loadingRef.current) return;
      void load();
    }, delay);
    return () => clearInterval(id);
  }, [mode, expiry, date, failures, refreshKey, load]);

  // Track tab visibility so the clock (and staleness badge) refreshes when
  // the user returns; the poll loop above resumes on its own — no catch-up
  // burst.
  useEffect(() => {
    const onVisibility = () => {
      setNowMs(Date.now());
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
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

  // In-app OI-burst alerts. Bursts come from the backend when it has any
  // (they survive the tab being closed); an empty/absent backend answer falls
  // back to the local detector so the page never goes blind. Plain hook state.
  const effectiveBursts = useMemo<OiBurst[]>(
    () => (bursts && bursts.length > 0 ? bursts : detectOiBursts(tape?.rows ?? [])),
    [bursts, tape],
  );
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

  const staleAgeMs = updatedAtMs === null ? 0 : nowMs - updatedAtMs;
  const isStale = mode === "live" && updatedAtMs !== null && staleAgeMs > STALE_AFTER_MS;
  const staleMins = Math.max(1, Math.floor(staleAgeMs / 60_000));
  const updatedAtLabel =
    updatedAtMs === null
      ? ""
      : new Date(updatedAtMs).toLocaleTimeString("en-IN", {
          hour12: false,
          timeZone: "Asia/Kolkata",
        });

  return (
    <Box
      data-testid="nifty-report-panel"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        p: 2,
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        overflowX: "hidden",
      }}
    >
      <CompactPanel>
        <Box
          data-testid="nifty-toolbar"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexWrap: "nowrap",
            width: "100%",
            maxWidth: "100%",
            minWidth: 0,
            overflowX: "auto",
          }}
        >
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
            w={180}
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
              Updated {updatedAtLabel} · auto 30s
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
          <Box
            data-testid="nifty-stat-strip"
            sx={{ display: "flex", width: "100%", minWidth: 0 }}
          >
            <CompactStatGrid>
              <CompactStat
                data-testid="nifty-stat-spot"
                label="Spot"
                value={report.spot.toLocaleString("en-IN")}
              />
              <CompactStat
                data-testid="nifty-stat-pcr-oi"
                label="PCR (OI)"
                value={report.pcrOi.toFixed(2)}
              />
              <CompactStat
                data-testid="nifty-stat-pcr-vol"
                label="PCR (Vol)"
                value={report.pcrVol.toFixed(2)}
              />
              <CompactStat
                data-testid="nifty-stat-max-pain"
                label="Max Pain"
                value={report.maxPain.toLocaleString("en-IN")}
              />
            </CompactStatGrid>
          </Box>

          <Box
            data-testid="nifty-main-row"
            sx={{
              display: "flex",
              gap: 2,
              alignItems: "stretch",
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
              flexWrap: "wrap",
            }}
          >
          <CompactPanel title={view === "depth" ? "Nifty depth map" : "Nifty chart"} testId="nifty-chart-panel" sx={{ flex: "1 1 540px", minWidth: 0 }}>
            {view === "depth" ? (
              <NiftyDepthMap report={report} />
            ) : report.candles && report.candles.length > 0 ? (
              <Box
                data-testid="nifty-chart-wrap"
                sx={{
                  display: "flex",
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: 0,
                  minHeight: 360,
                  height: "min(58vh, 540px)",
                  overflow: "hidden",
                }}
              >
                <TradingViewChart
                  candles={report.candles}
                  markLines={markLines}
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
            <CompactPanel title="Session timeline" testId="nifty-timeline-panel">
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
            </CompactPanel>
          )}

          <CompactPanel title="Option-chain OI (±750 ATM)" testId="nifty-oi-panel" sx={{ flex: "1 1 420px", minWidth: 0 }}>
            <Box
              ref={oiWrapRef}
              sx={{
                display: "flex",
                minHeight: 360,
                height: "min(58vh, 540px)",
                minWidth: 0,
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
            data-testid="nifty-tape-duo"
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 2,
              width: "100%",
              maxWidth: "100%",
              minWidth: 0,
            }}
          >
          <CompactPanel title="OI · tick tape" testId="nifty-tape-panel" sx={{ flex: "1 1 620px", minWidth: 0, background: "#000000", borderColor: "#1A1A1A" }}>
            {tape && tape.rows.length > 0 ? (
              <NiftyTapeTable rows={tape.rows} tape={tape} live={mode === "live"} bursts={burstMap} />
            ) : (
              <Text data-testid="nifty-tape-empty" size="sm" c="dimmed">
                Tape starts recording at next market open.
              </Text>
            )}
          </CompactPanel>

          <Box sx={{ flex: "1 1 620px", minWidth: 0, background: "#000000", border: "1px solid #1A1A1A", borderRadius: 8, overflow: "hidden" }}>
            <NiftyUnusualVolume strikes={report.strikes} spot={report.spot} sx={{ flex: "1 1 620px", minWidth: 0 }} />
          </Box>
          </Box>

          {trail.length > 0 && (
            <Box ref={burstsRef} data-testid="nifty-oi-bursts-wrap">
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
                  height={Math.min(22 + trail.length * 20 + 18, 260)}
                  onOpen={() => burstsRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })}
                />
              </CompactPanel>
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
                  data-testid="nifty-gex-net"
                  label="Net GEX"
                  value={formatGexTotal(report.gex.netTotal)}
                />
                <CompactStat
                  data-testid="nifty-gex-regime"
                  label="Regime"
                  value={gexRegimeText(report.gex.regime)}
                />
                <CompactStat
                  data-testid="nifty-gex-flip"
                  label="Gamma flip"
                  value={
                    report.gex.zeroCross === null || report.gex.zeroCross === undefined
                      ? "—"
                      : report.gex.zeroCross.toLocaleString("en-IN")
                  }
                />
                <CompactStat
                  data-testid="nifty-gex-sup"
                  label="Top support"
                  value={
                    report.gex.topPositive[0]
                      ? formatGexLevel(
                          report.gex.topPositive[0].strike,
                          report.gex.topPositive[0].netGex,
                        )
                      : "—"
                  }
                />
                <CompactStat
                  data-testid="nifty-gex-res"
                  label="Top resistance"
                  value={
                    report.gex.topNegative[0]
                      ? formatGexLevel(
                          report.gex.topNegative[0].strike,
                          report.gex.topNegative[0].netGex,
                        )
                      : "—"
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
                    key={`r-${r.strike}`}
                    data-testid={`nifty-level-r${i + 1}`}
                    label={i === 0 ? "Resistance R1" : "Resistance R2"}
                    value={`${r.strike.toLocaleString("en-IN")} (${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(2)}%)`}
                  />
                ))}
                <CompactStat
                  data-testid="nifty-level-pain"
                  label={`Max-pain pull ${levels.painPull.dir}`}
                  value={`${report.maxPain.toLocaleString("en-IN")} (${levels.painPull.pct >= 0 ? "+" : ""}${levels.painPull.pct.toFixed(2)}%)`}
                />
                {levels.support.map((s, i) => (
                  <CompactStat
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
      )}
    </Box>
  );
}
