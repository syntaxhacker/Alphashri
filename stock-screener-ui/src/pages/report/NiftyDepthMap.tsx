import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import Box from "@mui/material/Box";
import ReactECharts from "echarts-for-react";
import { ChartErrorBoundary } from "@/components/common/ChartErrorBoundary";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { CompactStat, CompactStatGrid } from "@/components/common/compact";
import { EmptyCompact } from "@/components/common/states";
import type { NiftyReport } from "@/types/niftyReport";
import { sortByField } from "@/utils/ui-helpers";
import { formatReportNum, formatReportOiCr } from "./reportFormat";

/**
 * Depth-map view for the Nifty report (futures footprint + GEX layout reference).
 *
 * Honest data mapping — we have NO tick/footprint/GEX feed:
 * - Candles: 15m Nifty from the report (`report.candles`).
 * - Depth bars: per-strike CE OI (red, left) / PE OI (green, right) from
 *   `report.strikes` (the GEX-bar equivalent), diverging from a zero center
 *   so each strike row shows one CE bar + one PE bar.
 * - "OI POC" = strike with the highest total (ce + pe) OI. It is NOT a
 *   volume POC — the label says exactly `OI POC`.
 *
 * Visual rules (screenshot-driven):
 * - Candle y-range comes from candle low/high ±0.15% padding ONLY — never
 *   from bar extents. Bars outside the range clip; that is intended so the
 *   candles keep ~68% of the width readable.
 * - The depth grid is a horizontal-bar chart: xAxis (grid 1) is a value axis
 *   for OI magnitude, yAxis (grid 1) is a category axis of strikes. ECharts
 *   bar series on two VALUE axes render as thin vertical lines spanning the
 *   full height — never do that; the category axis is what makes bars
 *   horizontal at their strike rows (CE negative/left, PE positive/right,
 *   explicit `encode: { x: 0, y: 1 }`).
 * - Level tags dedupe within 25pts (Spot > MP > CW/PW > OI-POC > Hi/Lo) and
 *   render as labeled lines on the candle grid (the only remaining price
 *   value axis — a category axis cannot place arbitrary price levels).
 * - X-axis labels are IST wall-clock HH:MM via explicit Asia/Kolkata
 *   formatting (host TZ independent). Candles without a parseable `time`
 *   are dropped from BOTH the series and the axis data so labels never go
 *   blank/misaligned (index coupling must be preserved).
 */

export const DEPTH_WINDOW = 750;

/** ±750 window at 50pt steps can hold at most 31 rows — cap enforced. */
export const DEPTH_MAX_ROWS = 31;

/** Level-tag dedupe radius in points (same rule as the report panel). */
const LEVEL_DEDUPE_PTS = 25;

/** Candle-only y-range padding on each side. */
const CANDLE_PAD_PCT = 0.0015;

interface DepthRow {
  strike: number;
  ceOi: number;
  peOi: number;
}

interface DayStats {
  hi: number | null;
  lo: number | null;
  changePct: number | null;
  last: number | null;
}

interface LevelLine {
  name: string;
  value: number;
  color: string;
  type: "dashed" | "solid" | "dotted";
  width: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtStrike(s: number): string {
  return formatReportNum(num(s));
}

/** Compact Indian OI labels: 2.50 Cr / 25.0L / 5.0k. */
export function formatOiCompact(v: number): string {
  return formatReportOiCr(v, {
    lakh: 1,
    space: false,
    thousands: true,
    grouped: false,
  });
}

/** Per-strike OI rows within ATM ±750, sorted ascending, capped at 31 rows. */
export function buildDepthRows(report: NiftyReport): DepthRow[] {
  const strikes = Array.isArray(report?.strikes) ? report.strikes : [];
  const spot = num(report?.spot);
  const inWindow = sortByField(
    strikes
      .filter((s) => s && Number.isFinite(Number(s.strike)) && Math.abs(Number(s.strike) - spot) <= DEPTH_WINDOW)
      .map((s) => ({
        strike: Number(s.strike),
        ceOi: num(s?.ce?.oi),
        peOi: num(s?.pe?.oi),
      })),
    "strike",
    "asc",
  );
  if (inWindow.length <= DEPTH_MAX_ROWS) return inWindow;
  // Irregular/dense chains: keep the rows closest to spot, restore ordering.
  return inWindow
    .slice()
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
    .slice(0, DEPTH_MAX_ROWS)
    .sort((a, b) => a.strike - b.strike);
}

/** Strike with the highest total (ce + pe) OI, over the full chain. Null-safe. */
export function findOiPoc(report: NiftyReport): number | null {
  const strikes = Array.isArray(report?.strikes) ? report.strikes : [];
  let best: number | null = null;
  let bestTotal = -Infinity;
  for (const s of strikes) {
    if (!s || !Number.isFinite(Number(s.strike))) continue;
    const total = num(s?.ce?.oi) + num(s?.pe?.oi);
    if (total > bestTotal) {
      bestTotal = total;
      best = Number(s.strike);
    }
  }
  return best;
}

/** Day hi/lo + last-vs-first-close change from report candles. Null-safe on empty. */
export function dayStats(report: NiftyReport): DayStats {
  const empty: DayStats = { hi: null, lo: null, changePct: null, last: null };
  const candles = Array.isArray(report?.candles) ? report.candles : [];
  const valid = candles.filter(
    (c) =>
      c &&
      Number.isFinite(Number(c.high)) &&
      Number.isFinite(Number(c.low)) &&
      Number.isFinite(Number(c.close)),
  );
  if (valid.length === 0) return empty;
  const hi = Math.max(...valid.map((c) => Number(c.high)));
  const lo = Math.min(...valid.map((c) => Number(c.low)));
  const first = Number(valid[0].close);
  const last = Number(valid[valid.length - 1].close);
  return {
    hi,
    lo,
    changePct: first !== 0 ? ((last - first) / first) * 100 : null,
    last,
  };
}

const istHm = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata",
});

/** IST wall-clock HH:MM for an epoch-ms value. Host-TZ independent. */
export function formatIstTimeMs(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  return istHm.format(new Date(ms));
}

/**
 * Candle `time` strings are IST wall-clock without an offset
 * ("2026-10-12T09:15:00"). Interpret them as Asia/Kolkata so the epoch is
 * correct regardless of host TZ; pass through values that already carry one.
 * Numeric input is tolerated (epoch ms, or epoch seconds below 1e12);
 * anything unparseable ("", "NaT", garbage) yields NaN so callers can drop
 * the candle instead of rendering a blank/misaligned time label.
 */
export function candleEpochMs(t: string | number): number {
  if (typeof t === "number") {
    if (!Number.isFinite(t)) return NaN;
    return t < 1e12 ? t * 1000 : t;
  }
  if (typeof t !== "string" || t.trim().length === 0) return NaN;
  const s = t.trim();
  if (/^nat$/i.test(s)) return NaN;
  const hasTz = /Z|[+-]\d{2}:?\d{2}$/.test(s);
  const iso = !hasTz && s.length === 19 ? `${s}+05:30` : s;
  return new Date(iso).getTime();
}

/**
 * Strikes that earn an outside-end bar label: top-3 by CE OI plus top-3 by
 * PE OI (union, so at most 6). Everything else stays unlabeled.
 */
export function topOiLabelStrikes(rows: DepthRow[]): number[] {
  const top3 = (pick: (r: DepthRow) => number): number[] =>
    rows
      .slice()
      .sort((a, b) => pick(b) - pick(a))
      .slice(0, 3)
      .map((r) => r.strike);
  return [...new Set([...top3((r) => r.ceOi), ...top3((r) => r.peOi)])];
}

/**
 * Level tags in placement-priority order (Spot > MP > CW/PW > OI-POC >
 * Hi/Lo), skipping any tag within 25pts of an already-placed one — the same
 * dedupe rule the report panel uses.
 */
export function levelLines(report: NiftyReport, stats: DayStats, poc: number | null): LevelLine[] {
  const ordered: LevelLine[] = [];
  if (Number.isFinite(Number(report?.spot)) && Number(report.spot) > 0) {
    ordered.push({ name: `Spot ${fmtStrike(Number(report.spot))}`, value: Number(report.spot), color: palette.TEXT, type: "solid", width: 1 });
  }
  if (Number.isFinite(Number(report?.maxPain)) && Number(report.maxPain) > 0) {
    ordered.push({ name: `MP ${fmtStrike(Number(report.maxPain))}`, value: Number(report.maxPain), color: palette.PRIMARY, type: "solid", width: 2 });
  }
  const calls = [...(report?.walls?.calls ?? [])].sort((a, b) => num(b?.oi) - num(a?.oi)).slice(0, 2);
  const puts = [...(report?.walls?.puts ?? [])].sort((a, b) => num(b?.oi) - num(a?.oi)).slice(0, 2);
  for (const w of calls) {
    if (!Number.isFinite(Number(w?.strike))) continue;
    ordered.push({ name: `CW ${fmtStrike(Number(w.strike))}`, value: Number(w.strike), color: palette.NEGATIVE, type: "dashed", width: 1 });
  }
  for (const w of puts) {
    if (!Number.isFinite(Number(w?.strike))) continue;
    ordered.push({ name: `PW ${fmtStrike(Number(w.strike))}`, value: Number(w.strike), color: palette.POSITIVE, type: "dashed", width: 1 });
  }
  if (poc != null && Number.isFinite(poc)) {
    ordered.push({ name: `OI POC ${fmtStrike(poc)}`, value: poc, color: palette.WARNING, type: "solid", width: 2 });
  }
  if (stats.hi != null) {
    ordered.push({ name: `Hi ${fmtStrike(stats.hi)}`, value: stats.hi, color: palette.TEXT_MUTED, type: "dotted", width: 1 });
  }
  if (stats.lo != null) {
    ordered.push({ name: `Lo ${fmtStrike(stats.lo)}`, value: stats.lo, color: palette.TEXT_MUTED, type: "dotted", width: 1 });
  }
  const used: number[] = [];
  const out: LevelLine[] = [];
  for (const line of ordered) {
    if (!used.every((u) => Math.abs(u - line.value) > LEVEL_DEDUPE_PTS)) continue;
    used.push(line.value);
    out.push(line);
  }
  return out;
}

/**
 * Full ECharts option: candlestick grid (left ~68%) + horizontal OI
 * depth-bar grid (right ~30%, visible gap between). The candle y-range is
 * candle-derived; the depth grid uses a strike category axis so every
 * strike row carries one CE bar (left) + one PE bar (right). Level tags
 * render as labeled lines on the candle grid. Plus CE/PE dominance
 * markers.
 */
export function buildDepthOption(report: NiftyReport): Record<string, unknown> {
  const rows = buildDepthRows(report);
  const stats = dayStats(report);
  const poc = findOiPoc(report);
  // Candles need BOTH valid OHLC and a parseable time: the candlestick
  // series is index-coupled to the category x-axis, so a NaN epoch would
  // render a blank time label (or shift every later label). Drop such
  // candles from both arrays together — never from just one.
  const candles = (Array.isArray(report?.candles) ? report.candles : []).filter(
    (c) =>
      c &&
      Number.isFinite(Number(c.open)) &&
      Number.isFinite(Number(c.close)) &&
      Number.isFinite(Number(c.high)) &&
      Number.isFinite(Number(c.low)) &&
      Number.isFinite(candleEpochMs(c.time)),
  );
  const lines = levelLines(report, stats, poc);

  const rowByStrike = new Map<number, DepthRow>(rows.map((r) => [r.strike, r]));
  const chgByStrike = new Map<number, number>(
    (Array.isArray(report?.strikes) ? report.strikes : [])
      .filter((s) => s && Number.isFinite(Number(s.strike)))
      .map((s) => [Number(s.strike), num(s?.ce?.oiChange) + num(s?.pe?.oiChange)]),
  );

  // Y-range from candle extremes ONLY — bar/tag extents never stretch it,
  // so out-of-range bars clip instead of crushing the candles.
  let yMin = 0;
  let yMax = 1;
  const candleVals: number[] = candles.flatMap((c) => [Number(c.high), Number(c.low)]);
  if (candleVals.length > 0) {
    const lo = Math.min(...candleVals);
    const hi = Math.max(...candleVals);
    if (hi > lo) {
      yMin = lo * (1 - CANDLE_PAD_PCT);
      yMax = hi * (1 + CANDLE_PAD_PCT);
    } else {
      yMin = lo - 50;
      yMax = hi + 50;
    }
  }

  const labelSet = new Set<number>(topOiLabelStrikes(rows));
  // Strike keys as STRINGS: ECharts ordinal scales match series values to
  // categories by string identity — numeric 2-D values ([oi, 22350]) silently
  // fail the lookup and render nothing (screenshot-verified). All consumers
  // Number() the key back before row lookup/labeling.
  const keyOf = (strike: number): string => String(strike);
  // Dominance markers sit on the depth grid: x = total strike OI (value
  // axis), y = strike (category axis) — explicit encode below.
  const ceDom = rows.filter((r) => r.ceOi > r.peOi).map((r) => [r.ceOi + r.peOi, keyOf(r.strike)]);
  const peDom = rows.filter((r) => r.peOi > r.ceOi).map((r) => [r.ceOi + r.peOi, keyOf(r.strike)]);

  const axisLabel = { color: palette.CHART_MUTED, fontSize: 10 };
  const strikeFmt = (v: string | number) => fmtStrike(Number(v));
  const istFmt = (v: unknown) => formatIstTimeMs(Number(v));
  // Labeled level lines live on the candle series (grid 0): it owns the
  // only price value axis left, and arbitrary levels (Spot/MP/Hi/Lo) cannot
  // be placed on the depth grid's strike category axis.
  const lineData = lines.map((l) => ({
    name: l.name,
    yAxis: l.value,
    lineStyle: { color: l.color, type: l.type, width: l.width },
    label: { color: l.color, position: "insideEndTop", formatter: l.name },
  }));

  return {
    backgroundColor: "transparent",
    animation: false,
    legend: { show: false },
    // The two grids no longer share a value axis (depth y is categorical),
    // so only the candle grid participates in pointer linking.
    axisPointer: { link: { yAxisIndex: [0] } },
    tooltip: {
      trigger: "item",
      backgroundColor: palette.TOOLTIP_BG,
      borderColor: palette.TOOLTIP_BORDER,
      textStyle: { color: palette.TOOLTIP_TEXT, fontSize: 12 },
      formatter: (p: unknown) => {
        const param = p as {
          seriesName?: string;
          name?: string;
          data?: unknown;
          value?: unknown;
        } | null;
        if (!param) return "";
        if (param.seriesName === "Nifty 15m" && Array.isArray(param.data)) {
          const [o, c, l, h] = param.data as number[];
          return `${param.name ?? ""}<br/>O ${o} H ${h} L ${l} C ${c}`;
        }
        if ((param.seriesName === "CE OI" || param.seriesName === "PE OI") && Array.isArray(param.value)) {
          const [, strike] = param.value as number[];
          const row = rowByStrike.get(Number(strike));
          if (!row) return "";
          const chg = chgByStrike.get(row.strike) ?? 0;
          const chgTxt = `${chg > 0 ? "+" : ""}${formatOiCompact(chg)}`;
          return (
            `${fmtStrike(row.strike)}<br/>` +
            `CE OI ${formatOiCompact(row.ceOi)}<br/>` +
            `PE OI ${formatOiCompact(row.peOi)}<br/>` +
            `Total ${formatOiCompact(row.ceOi + row.peOi)}<br/>` +
            `OI Chg ${chgTxt}`
          );
        }
        if ((param.seriesName === "CE over PE" || param.seriesName === "PE over CE") && Array.isArray(param.value)) {
          const [, strike] = param.value as number[];
          return `${fmtStrike(Number(strike))} — ${param.seriesName}`;
        }
        return "";
      },
    },
    grid: [
      { left: 56, right: "32%", top: 16, bottom: 48 },
      { left: "70%", right: 64, top: 16, bottom: 48 },
    ],
    xAxis: [
      {
        type: "category",
        gridIndex: 0,
        data: candles.map((c) => candleEpochMs(c.time)),
        axisLabel: { ...axisLabel, formatter: istFmt },
        axisLine: { lineStyle: { color: palette.AXIS_LINE } },
        axisTick: { show: false },
      },
      {
        // OI magnitude (value) axis: CE bars extend left (negative),
        // PE bars right (positive) from the zero center.
        type: "value",
        gridIndex: 1,
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        min: yMin,
        max: yMax,
        position: "left",
        axisLabel: { ...axisLabel, formatter: strikeFmt },
        axisLine: { lineStyle: { color: palette.AXIS_LINE } },
        splitLine: { lineStyle: { color: palette.CHART_SPLIT } },
      },
      {
        // Strike category axis: one row per strike, ascending bottom to
        // top so rows sit at their price levels. Keys are strings — see
        // keyOf above. This — not a second value axis — is what makes the
        // depth bars horizontal.
        type: "category",
        gridIndex: 1,
        data: rows.map((r) => keyOf(r.strike)),
        position: "right",
        axisLabel: { ...axisLabel, formatter: strikeFmt },
        axisLine: { lineStyle: { color: palette.AXIS_LINE } },
        axisTick: { show: false },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "Nifty 15m",
        type: "candlestick",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: candles.map((c) => [Number(c.open), Number(c.close), Number(c.low), Number(c.high)]),
        itemStyle: {
          color: palette.POSITIVE,
          color0: palette.NEGATIVE,
          borderColor: palette.POSITIVE,
          borderColor0: palette.NEGATIVE,
        },
        markLine: {
          symbol: "none",
          silent: true,
          label: { fontSize: 10, formatter: "{b}" },
          data: lineData,
        },
      },
      {
        // Horizontal diverging bars: dim 0 (OI, negative = left) maps to
        // the value x-axis, dim 1 (strike) to the category y-axis.
        name: "CE OI",
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 1,
        barCategoryGap: "45%",
        barMaxWidth: 16,
        encode: { x: 0, y: 1 },
        data: rows.map((r) => [-r.ceOi, keyOf(r.strike)]),
        itemStyle: { color: palette.NEGATIVE, borderRadius: [2, 0, 0, 2] },
      },
      {
        name: "PE OI",
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 1,
        barCategoryGap: "45%",
        barMaxWidth: 16,
        encode: { x: 0, y: 1 },
        data: rows.map((r) => [r.peOi, keyOf(r.strike)]),
        itemStyle: { color: palette.POSITIVE, borderRadius: [0, 2, 2, 0] },
        label: {
          show: true,
          position: "right",
          fontSize: 9,
          color: palette.CHART_MUTED,
          formatter: (p: { value?: unknown }) => {
            const strike = Array.isArray(p.value) ? Number((p.value as number[])[1]) : NaN;
            if (!labelSet.has(strike)) return "";
            const row = rowByStrike.get(strike);
            return row ? formatOiCompact(row.ceOi + row.peOi) : "";
          },
        },
      },
      {
        name: "CE over PE",
        type: "scatter",
        xAxisIndex: 1,
        yAxisIndex: 1,
        symbol: "diamond",
        symbolSize: 6,
        label: { show: false },
        z: 10,
        encode: { x: 0, y: 1 },
        data: ceDom,
        itemStyle: { color: palette.NEGATIVE },
      },
      {
        name: "PE over CE",
        type: "scatter",
        xAxisIndex: 1,
        yAxisIndex: 1,
        symbol: "circle",
        symbolSize: 6,
        label: { show: false },
        z: 10,
        encode: { x: 0, y: 1 },
        data: peDom,
        itemStyle: { color: palette.POSITIVE },
      },
    ],
  };
}

/** Hoisted ECharts chrome — stable identity so the chart never gets new literals. */
const DEPTH_CHART_STYLE = { height: "100%", width: "100%" } as const;
const DEPTH_CHART_OPTS = { renderer: "canvas" } as const;

const LegendChip = memo(function LegendChip({
  testId,
  color,
  label,
  value,
  valueColor,
}: {
  testId: string;
  color: string;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <Box
      data-testid={testId}
      sx={{ display: "flex", alignItems: "center", gap: 1, fontVariantNumeric: "tabular-nums" }}
    >
      <Box sx={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: color, flexShrink: 0 }} />
      <Text size="xs" c="dimmed" span>
        {label}
      </Text>
      <Text size="xs" fw={700} span c={valueColor ?? "default"}>
        {value}
      </Text>
    </Box>
  );
});
LegendChip.displayName = "LegendChip";

/** Minimal ECharts instance surface this panel drives. */
interface DepthChartHandle {
  resize: () => void;
  setOption: (option: object) => void;
}

interface NiftyDepthMapProps {
  report: NiftyReport;
  /**
   * Visibility gate (default true). When false the component renders only
   * its container: no `setOption`, no `resize`, no other ECharts work.
   * Flipping back to true runs `resize()` + `setOption(latest)` so the
   * chart catches up to anything skipped while hidden.
   */
  active?: boolean;
}

function NiftyDepthMapInner({ report, active = true }: NiftyDepthMapProps) {
  const rows = useMemo(() => buildDepthRows(report), [report]);
  const stats = useMemo(() => dayStats(report), [report]);
  const poc = useMemo(() => findOiPoc(report), [report]);
  const option = useMemo(() => buildDepthOption(report), [report]);

  const chartRef = useRef<ReactECharts | null>(null);
  const instanceRef = useRef<DepthChartHandle | null>(null);

  const handleChartReady = useCallback((instance: DepthChartHandle) => {
    instanceRef.current = instance;
  }, []);

  // Single driver for ECharts updates. The library's automatic setOption is
  // disabled via `shouldSetOption` below, so while `active` is false this
  // effect provably skips all ECharts work; on (re)activation it resizes
  // (the hidden container was zero-size) and pushes the latest option.
  // The instance may be null on the very first run (async init) — first
  // mount is covered by the library's initial setOption, and onChartReady
  // stashes the instance for every later run.
  useEffect(() => {
    if (!active) return;
    const instance =
      instanceRef.current ??
      (chartRef.current?.getEchartsInstance?.() as unknown as
        | DepthChartHandle
        | undefined) ??
      null;
    if (!instance) return;
    instance.resize();
    instance.setOption(option);
  }, [active, option]);

  const legend = useMemo(() => {
    const ceDom = rows.filter((r) => r.ceOi > r.peOi).length;
    const peDom = rows.filter((r) => r.peOi > r.ceOi).length;
    const totalOi = rows.reduce((s, r) => s + r.ceOi + r.peOi, 0);
    const chgByStrike = new Map<number, number>(
      (Array.isArray(report?.strikes) ? report.strikes : [])
        .filter((s) => s && Number.isFinite(Number(s.strike)))
        .map((s) => [Number(s.strike), num(s?.ce?.oiChange) + num(s?.pe?.oiChange)]),
    );
    const netChg = rows.reduce((s, r) => s + (chgByStrike.get(r.strike) ?? 0), 0);
    return { ceDom, peDom, totalOi, netChg };
  }, [rows, report]);

  const changeTone =
    stats.changePct == null ? "default" : stats.changePct > 0 ? palette.POSITIVE : stats.changePct < 0 ? palette.NEGATIVE : "default";
  const changeText =
    stats.changePct == null
      ? "—"
      : `${stats.changePct > 0 ? "+" : ""}${stats.changePct.toFixed(2)}%`;
  const netChgTone = legend.netChg > 0 ? palette.POSITIVE : legend.netChg < 0 ? palette.NEGATIVE : palette.TEXT_MUTED;
  const netChgText = `${legend.netChg > 0 ? "+" : ""}${formatOiCompact(legend.netChg)}`;

  return (
    <Box
      data-testid="nifty-depthmap"
      sx={{ display: "flex", flexDirection: "column", gap: 2, width: "100%", minWidth: 0 }}
    >
      <Box data-testid="nifty-depth-stats" sx={{ display: "flex", width: "100%", minWidth: 0 }}>
        <CompactStatGrid>
          <CompactStat
            data-testid="nifty-depth-stat-last"
            label="Last"
            value={fmtStrike(num(report?.spot))}
          />
          <CompactStat
            data-testid="nifty-depth-stat-hilo"
            label="Hi / Lo"
            valueSize="md"
            value={stats.hi == null || stats.lo == null ? "—" : `${fmtStrike(stats.hi)} / ${fmtStrike(stats.lo)}`}
          />
          <CompactStat
            data-testid="nifty-depth-stat-chg"
            label="Change"
            tone={changeTone}
            value={changeText}
          />
          <CompactStat
            data-testid="nifty-depth-stat-pcr"
            label="PCR-OI"
            value={Number.isFinite(Number(report?.pcrOi)) ? Number(report.pcrOi).toFixed(2) : "—"}
          />
          <CompactStat
            data-testid="nifty-depth-stat-maxpain"
            label="Max Pain"
            value={Number(report?.maxPain) > 0 ? fmtStrike(Number(report.maxPain)) : "—"}
          />
        </CompactStatGrid>
      </Box>

      <Box
        data-testid="nifty-depth-legend"
        sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, px: 1 }}
      >
        <LegendChip testId="nifty-depth-legend-ce-dom" color={palette.NEGATIVE} label="CE over PE" value={String(legend.ceDom)} />
        <LegendChip testId="nifty-depth-legend-pe-dom" color={palette.POSITIVE} label="PE over CE" value={String(legend.peDom)} />
        <LegendChip testId="nifty-depth-legend-total" color={palette.TEXT} label="Total OI" value={formatOiCompact(legend.totalOi)} />
        <LegendChip testId="nifty-depth-legend-poc" color={palette.WARNING} label="OI POC" value={poc != null ? fmtStrike(poc) : "—"} />
        <LegendChip testId="nifty-depth-legend-chg" color={palette.TEXT_MUTED} label="OI Chg" value={netChgText} valueColor={netChgTone} />
      </Box>

      <Box
        data-testid="nifty-depth-chart"
        sx={{ width: "100%", minWidth: 0, minHeight: 380, height: "min(62vh, 600px)" }}
      >
        {rows.length === 0 ? (
          <EmptyCompact
            data-testid="nifty-depth-empty"
            title="No strikes in window"
            description="No option-chain strikes near spot for this expiry."
          />
        ) : (
          <ChartErrorBoundary label="Depth map">
            <ReactECharts
              ref={chartRef}
              option={option}
              style={DEPTH_CHART_STYLE}
              opts={DEPTH_CHART_OPTS}
              onChartReady={handleChartReady}
              shouldSetOption={() => false}
            />
          </ChartErrorBoundary>
        )}
      </Box>

      <Text data-testid="nifty-depth-note" size="xs" c="dimmed">
        Strike OI from the chain snapshot — no tick footprint or GEX feed.
      </Text>
    </Box>
  );
}

/** Memoised leaf panel — `report` keeps identity between unrelated parent renders. */
export const NiftyDepthMap = memo(NiftyDepthMapInner);
NiftyDepthMap.displayName = "NiftyDepthMap";
