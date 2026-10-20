import { memo, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import { SegmentedControl, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { TradingViewChart } from "@/components/chart/TradingViewChart";
import { CompactPanel } from "@/components/common/compact";
import { EmptyCompact } from "@/components/common/states";
import { NiftyDepthMap } from "./NiftyDepthMap";
import type { MarkLineData } from "@/utils/chart/types";
import type {
  NiftyIntradayCandle,
  NiftyReport,
  NiftyReportMode,
} from "@/types/niftyReport";
import type { ReplayCandle } from "@/types/replay";

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

/** Module-level toggle data so memoized parents never see a new array. */
export const CHART_TF_OPTIONS: { value: string; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
];

export const CHART_SIZE_OPTIONS: { value: string; label: string }[] = [
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
  { value: "xl", label: "XL" },
];

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

/** Build an rgba() string from a palette hex token — never hardcode the channels. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

export interface NiftyChartPanelProps {
  report: NiftyReport;
  mode: NiftyReportMode;
  view: "chart" | "depth";
}

/**
 * Chart/depth body isolated behind `React.memo` with its own size + timeframe
 * state. Clicking S/M/L/XL or 1m/5m/15m re-renders only this panel: the props
 * (`report`, `mode`, `view`) are all stable across those toggles and nothing
 * tick-driven is passed in.
 */
export const NiftyChartPanel = memo(function NiftyChartPanel({
  report,
  mode,
  view,
}: NiftyChartPanelProps) {
  const [chartSize, setChartSize] = useState<ChartSize>("s");
  /** Chart bar timeframe: 1m native; 5m/15m resampled client-side. */
  const [chartTf, setChartTf] = useState<ChartTimeframe>("1m");

  // Lazy depth mount: switching views used to cold-mount ECharts (~380ms),
  // so the depth subtree is not created until first selected. Afterwards
  // both views stay mounted and visibility toggles via `display: none`,
  // making Chart<->Depth switches instant. (Render-time adjust — the
  // React-endorsed pattern for syncing state to a prop change.)
  const [depthEverShown, setDepthEverShown] = useState(false);
  if (view === "depth" && !depthEverShown) {
    setDepthEverShown(true);
  }

  const markLines = useMemo(
    () => buildMarkLines(report, mode === "live" && !!report.gex),
    [report, mode],
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

  return (
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
              data={CHART_TF_OPTIONS}
              size="sm"
            />
            <SegmentedControl
              data-testid="nifty-chart-size"
              value={chartSize}
              onChange={(v) => setChartSize(v as ChartSize)}
              data={CHART_SIZE_OPTIONS}
              size="sm"
            />
          </Box>
        ) : undefined
      }
    >
      {/*
        * Both views stay mounted after first use; the inactive wrapper is
        * `display: none` (zero layout space) so switching never remounts
        * either chart engine. The depth subtree mounts lazily on first
        * selection via `depthEverShown` above.
        */}
      <Box
        data-testid="nifty-chart-view"
        style={{ display: view === "chart" ? "block" : "none" }}
      >
        {chartCandles && chartCandles.length > 0 ? (
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
      </Box>
      {depthEverShown ? (
        <Box
          data-testid="nifty-depth-view"
          style={{ display: view === "depth" ? "block" : "none" }}
        >
          <NiftyDepthMap report={report} active={view === "depth"} />
        </Box>
      ) : null}
      <LevelLegend live={mode === "live" && !!report.gex} />
    </CompactPanel>
  );
});
