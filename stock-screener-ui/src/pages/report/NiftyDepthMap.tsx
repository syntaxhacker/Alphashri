import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Box, Text } from "@/ui";
import { DepthChart } from "./DepthChart";
import { ChartErrorBoundary } from "@/components/common/ChartErrorBoundary";
import * as palette from "@/ui/palette";
import { CompactStat, CompactStatGrid } from "@/components/common/compact";
import { EmptyCompact } from "@/components/common/states";
import type { NiftyReport } from "@/types/niftyReport";
import { sortByField } from "@/utils/ui-helpers";
import { formatReportNum, formatReportOiCr } from "./reportFormat";
import { wallCode, wallSide } from "./niftyChartMath";

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
  width: string;
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
  const spot = num(report?.spot);
  const ordered: LevelLine[] = [];
  if (Number.isFinite(spot) && spot > 0) {
    ordered.push({ name: `Spot ${fmtStrike(spot)}`, value: spot, color: palette.TEXT, type: "solid", "width": "1px" });
  }
  if (Number.isFinite(Number(report?.maxPain)) && Number(report.maxPain) > 0) {
    ordered.push({ name: `MP ${fmtStrike(Number(report.maxPain))}`, value: Number(report.maxPain), color: palette.PRIMARY, type: "solid", "width": "2px" });
  }
  const calls = [...(report?.walls?.calls ?? [])].sort((a, b) => num(b?.oi) - num(a?.oi)).slice(0, 2);
  const puts = [...(report?.walls?.puts ?? [])].sort((a, b) => num(b?.oi) - num(a?.oi)).slice(0, 2);
  for (const w of calls) {
    if (!Number.isFinite(Number(w?.strike))) continue;
    const strike = Number(w.strike);
    const ws = wallSide(strike, spot);
    const tag = wallCode(true, ws, false);
    ordered.push({ name: `${tag} ${fmtStrike(strike)}`, value: strike, color: palette.NEGATIVE, type: "dashed", "width": "1px" });
  }
  for (const w of puts) {
    if (!Number.isFinite(Number(w?.strike))) continue;
    const strike = Number(w.strike);
    const ws = wallSide(strike, spot);
    const tag = wallCode(false, ws, false);
    ordered.push({ name: `${tag} ${fmtStrike(strike)}`, value: strike, color: palette.POSITIVE, type: "dashed", "width": "1px" });
  }
  if (poc != null && Number.isFinite(poc)) {
    ordered.push({ name: `OI POC ${fmtStrike(poc)}`, value: poc, color: palette.WARNING, type: "solid", "width": "2px" });
  }
  if (stats.hi != null) {
    ordered.push({ name: `Hi ${fmtStrike(stats.hi)}`, value: stats.hi, color: palette.TEXT_MUTED, type: "dotted", "width": "1px" });
  }
  if (stats.lo != null) {
    ordered.push({ name: `Lo ${fmtStrike(stats.lo)}`, value: stats.lo, color: palette.TEXT_MUTED, type: "dotted", "width": "1px" });
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

  const axisLabel = { color: palette.CHART_MUTED, "font-size": "10px" };
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
    "background-color": "transparent",
    animation: false,
    legend: { show: false },
    // The two grids no longer share a value axis (depth y is categorical),
    // so only the candle grid participates in pointer linking.
    axisPointer: { link: { yAxisIndex: [0] } },
    tooltip: {
      trigger: "item",
      "background-color": palette.TOOLTIP_BG,
      "border-color": palette.TOOLTIP_BORDER,
      textStyle: { color: palette.TOOLTIP_TEXT, "font-size": "12px" },
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
      { "left": "56px", right: "32%", "top": "16px", "bottom": "48px" },
      { left: "70%", "right": "64px", "top": "16px", "bottom": "48px" },
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
          "border-color": palette.POSITIVE,
          borderColor0: palette.NEGATIVE,
        },
        markLine: {
          symbol: "none",
          silent: true,
          label: { "font-size": "10px", formatter: "{b}" },
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
        itemStyle: { color: palette.NEGATIVE, "border-radius": [2, 0, 0, 2] },
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
        itemStyle: { color: palette.POSITIVE, "border-radius": [0, 2, 2, 0] },
        label: {
          show: true,
          position: "right",
          "font-size": "9px",
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

const LegendChip = (props: {
  testId: string;
  color: string;
  label: string;
  value: string;
  valueColor?: string;
}) => {
  return (
    <Box
      data-testid={props.testId}
      className="flex items-center gap-[8px] tabular-nums"
    >
      <Box
        className="w-[8px] h-[8px] rounded-full shrink-0"
        style={{ "background-color": props.color }}
      />
      <Text size="xs" c="dimmed" span>
        {props.label}
      </Text>
      <Text size="xs" fw={700} span className="tabular-nums" style={{ color: props.valueColor ?? palette.TEXT }}>
        {props.value}
      </Text>
    </Box>
  );
};

/** Minimal ECharts instance surface this panel drives. */
interface DepthChartHandle {
  resize: () => void;
  setOption: (option: object, opts?: { notMerge?: boolean; lazyUpdate?: boolean }) => void;
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

function NiftyDepthMapInner(props: NiftyDepthMapProps) {
  const report = () => props.report;
  const active = () => props.active ?? true;
  const rows = createMemo(() => buildDepthRows(report()));
  const stats = createMemo(() => dayStats(report()));
  const poc = createMemo(() => findOiPoc(report()));
  const option = createMemo(() => buildDepthOption(report()));

  /**
   * Keep the ECharts *engine* mounted once it has drawn a row.
   *
   * A poll that momentarily returns no strikes (pre-open, a chain refresh, a
   * replay boundary) used to unmount `ReactECharts`: that disposes the
   * instance, and the next poll re-`init`s it (~380 ms + a fresh zrender
   * canvas). Worse, `echarts-for-react` initialises asynchronously (it waits
   * for the `finished` event, then disposes + re-inits): unmounting inside that
   * window leaves an instance created after `componentWillUnmount`, with no one
   * left to dispose it. Keeping it mounted removes the whole class.
   */
  const [hasEverHadRows, setHasEverHadRows] = createSignal(false);
  createEffect(() => {
    if (rows().length > 0 && !hasEverHadRows()) setHasEverHadRows(true);
  });

  const [chartInstance, setChartInstance] = createSignal<DepthChartHandle | null>(null);

  const handleChartReady = (instance: DepthChartHandle) => {
    setChartInstance(() => instance);
  };

  /** Drop the instance on unmount so nothing drives a disposed chart. */
  onCleanup(() => {
    setChartInstance(null);
  });

  const resolveInstance = (): DepthChartHandle | null => chartInstance();

  // Resize only when the view becomes visible. The hidden container is
  // zero-size, so one resize on activation is required — but resizing on every
  // report push (every poll) forced a full ECharts/zrender re-layout for no
  // geometry change.
  createEffect(() => {
    if (!active()) return;
    resolveInstance()?.resize();
  });

  // Single option driver. The library's automatic setOption is disabled via
  // `shouldSetOption` below, so while `active` is false this effect provably
  // skips all ECharts work; on (re)activation it pushes the latest option.
  //
  // `notMerge: true` is deliberate: the option is rebuilt in full from the
  // report, and a merge-mode setOption re-uses/patches ECharts' internal model
  // in place every poll — the accumulation pattern that grows a long-lived
  // chart tab. Full replacement also guarantees a series removed upstream
  // cannot survive as a stale ghost series.
  createEffect(() => {
    if (!active()) return;
    const instance = resolveInstance();
    if (!instance) return;
    instance.setOption(option(), { notMerge: true, lazyUpdate: false });
  });

  const legend = createMemo(() => {
    const r = rows();
    const ceDom = r.filter((x) => x.ceOi > x.peOi).length;
    const peDom = r.filter((x) => x.peOi > x.ceOi).length;
    const totalOi = r.reduce((acc, x) => acc + x.ceOi + x.peOi, 0);
    const chgByStrike = new Map<number, number>(
      (Array.isArray(report()?.strikes) ? report()!.strikes! : [])
        .filter((x) => x && Number.isFinite(Number(x.strike)))
        .map((x) => [Number(x.strike), num(x?.ce?.oiChange) + num(x?.pe?.oiChange)]),
    );
    const netChg = r.reduce((acc, x) => acc + (chgByStrike.get(x.strike) ?? 0), 0);
    return { ceDom, peDom, totalOi, netChg };
  });

  const changeTone = () =>
    stats().changePct == null ? "default" : (stats().changePct ?? 0) > 0 ? palette.POSITIVE : (stats().changePct ?? 0) < 0 ? palette.NEGATIVE : "default";
  const changeText = () =>
    stats().changePct == null
      ? "—"
      : `${(stats().changePct ?? 0) > 0 ? "+" : ""}${stats().changePct!.toFixed(2)}%`;
  const netChgTone = () => (legend().netChg > 0 ? palette.POSITIVE : legend().netChg < 0 ? palette.NEGATIVE : palette.TEXT_MUTED);
  const netChgText = () =>
    `${legend().netChg > 0 ? "+" : ""}${formatOiCompact(legend().netChg)}`;

  return (
    <Box
      data-testid="nifty-depthmap"
      className="flex flex-col gap-[16px] w-full min-w-0"
    >
      <Box data-testid="nifty-depth-stats" className="flex w-full min-w-0">
        <CompactStatGrid>
          <CompactStat
            data-testid="nifty-depth-stat-last"
            label="Last"
            value={fmtStrike(num(report()?.spot))}
          />
          <CompactStat
            data-testid="nifty-depth-stat-hilo"
            label="Hi / Lo"
            valueSize="md"
            value={stats().hi == null || stats().lo == null ? "—" : `${fmtStrike(stats().hi!)} / ${fmtStrike(stats().lo!)}`}
          />
          <CompactStat
            data-testid="nifty-depth-stat-chg"
            label="Change"
            tone={changeTone()}
            value={changeText()}
          />
          <CompactStat
            data-testid="nifty-depth-stat-pcr"
            label="PCR-OI"
            value={Number.isFinite(Number(report()?.pcrOi)) ? Number(report()!.pcrOi).toFixed(2) : "—"}
          />
          <CompactStat
            data-testid="nifty-depth-stat-maxpain"
            label="Max Pain"
            value={Number(report()?.maxPain) > 0 ? fmtStrike(Number(report()!.maxPain)) : "—"}
          />
        </CompactStatGrid>
      </Box>

      <Box
        data-testid="nifty-depth-legend"
        className="flex items-center flex-wrap gap-[16px] px-2"
      >
        <LegendChip testId="nifty-depth-legend-ce-dom" color={palette.NEGATIVE} label="CE over PE" value={String(legend().ceDom)} />
        <LegendChip testId="nifty-depth-legend-pe-dom" color={palette.POSITIVE} label="PE over CE" value={String(legend().peDom)} />
        <LegendChip testId="nifty-depth-legend-total" color={palette.TEXT} label="Total OI" value={formatOiCompact(legend().totalOi)} />
        <LegendChip testId="nifty-depth-legend-poc" color={palette.WARNING} label="OI POC" value={poc() != null ? fmtStrike(poc()!) : "—"} />
        <LegendChip testId="nifty-depth-legend-chg" color={palette.TEXT_MUTED} label="OI Chg" value={netChgText()} valueColor={netChgTone()} />
      </Box>

      <Box
        data-testid="nifty-depth-chart"
        className="relative w-full min-w-0 min-h-[380px]"
        style={{ height: "min(62vh, 600px)" }}
      >
        {rows().length === 0 ? (
          <EmptyCompact
            data-testid="nifty-depth-empty"
            title="No strikes in window"
            description="No option-chain strikes near spot for this expiry."
          />
        ) : null}
        {rows().length > 0 || hasEverHadRows() ? (
          <Box
            className="absolute inset-0"
            style={{ display: rows().length > 0 ? "block" : "none" }}
          >
            <ChartErrorBoundary label="Depth map">
              <DepthChart option={option()} onChartReady={handleChartReady} data-testid="nifty-depth-echarts" data-series={Array.isArray(option()?.series) ? (option() as { series?: unknown[] }).series?.length ?? 0 : 0} />
            </ChartErrorBoundary>
          </Box>
        ) : null}
      </Box>

      <Text data-testid="nifty-depth-note" size="xs" c="dimmed">
        Strike OI from the chain snapshot — no tick footprint or GEX feed.
      </Text>
    </Box>
  );
}

/** Leaf panel. Solid needs no memo: updates are fine-grained, not whole-tree. */
export const NiftyDepthMap = NiftyDepthMapInner;
