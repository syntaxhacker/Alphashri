import { alpha, INFO, PRIMARY } from "@/ui/palette";
import {
  asArray,
  baseOption,
  categoryAxis,
  CHART_LAYOUT,
  DEFAULT_UNIT,
  EdaRollingInput,
  EdaSeriesPoint,
  field,
  finite,
  formatCount,
  formatValue,
  makeDataZoom,
  MONTHS,
  Option,
  paramIndex,
  themeTokens,
  tooltipShell,
  valueAxis,
} from "./shared";

export const ROLLING_WINDOWS = [7, 20, 60] as const;
const MAX_CALENDAR_GAP_DAYS = 7;
const GAP_MARKER = "\u0000gap";

interface RollingRow {
  date: string;
  modal: number | null;
  gap: boolean;
  skippedDays: number;
}

function calendarGapDays(previous: string, next: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(previous) || !/^\d{4}-\d{2}-\d{2}$/.test(next)) return null;
  const from = Date.parse(`${previous}T00:00:00Z`);
  const to = Date.parse(`${next}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatDateLabel(date: unknown): string {
  if (typeof date !== "string") return "";
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (day) {
    const month = MONTHS[Number(day[2]) - 1];
    return month ? `${day[3]} ${month}` : date;
  }
  return /^\d{4}-\d{2}$/.test(date) ? date : date.slice(0, 10);
}

/**
 * Modal line, trailing mean and a mean ± 1σ band.
 * Calendar gaps longer than 7 days insert a null break, so neither the line nor
 * the band can imply continuous trading across a hole in the feed.
 */
export function buildRollingOption(input: EdaRollingInput | null | undefined): Option {
  if (!input || typeof input !== "object") return {};
  const t = themeTokens(input.isDark);
  const points = asArray<EdaSeriesPoint>(input.series)
    .map((point) => ({ date: point.date, modal: finite(point.modal) }))
    .filter((point) => point.modal != null);
  if (points.length === 0) return {};

  const requested = Math.floor(finite(input.window) ?? finite(input.rolling) ?? 7);
  const window = Math.max(2, Math.min(requested >= 2 ? requested : 7, points.length));

  const rows: RollingRow[] = [];
  const skipped: number[] = [];
  let previousDate: string | null = null;
  for (const point of points) {
    if (previousDate != null) {
      const gap = calendarGapDays(previousDate, point.date);
      if (gap != null && gap > MAX_CALENDAR_GAP_DAYS) {
        rows.push({ date: GAP_MARKER, modal: null, gap: true, skippedDays: gap - 1 });
        skipped.push(gap);
      }
    }
    rows.push({ date: point.date, modal: point.modal, gap: false, skippedDays: 0 });
    previousDate = point.date;
  }

  const means: (number | null)[] = [];
  const lowers: (number | null)[] = [];
  const spans: (number | null)[] = [];
  const counts: (number | null)[] = [];
  let windowValues: number[] = [];
  for (const row of rows) {
    if (row.gap || row.modal == null) {
      windowValues = [];
      means.push(null);
      lowers.push(null);
      spans.push(null);
      counts.push(null);
      continue;
    }
    windowValues.push(row.modal);
    if (windowValues.length > window) windowValues.shift();
    if (windowValues.length < 2) {
      means.push(null);
      lowers.push(null);
      spans.push(null);
      counts.push(windowValues.length);
      continue;
    }
    const mean = windowValues.reduce((sum, value) => sum + value, 0) / windowValues.length;
    const variance = windowValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / windowValues.length;
    const sd = Math.sqrt(variance);
    means.push(round2(mean));
    lowers.push(round2(mean - sd));
    spans.push(round2(2 * sd));
    counts.push(windowValues.length);
  }

  const gapNote = `Line and band break on calendar gaps > ${MAX_CALENDAR_GAP_DAYS} days`;
  const skippedNote = skipped.length > 0
    ? `${gapNote} · ${skipped.length} gap${skipped.length === 1 ? "" : "s"} skipped`
    : gapNote;

  const compact = input.compact === true;
  const option = baseOption(
    t,
    compact
      ? `Rolling mean · ${window} obs`
      : `Modal price with ${window}-observation rolling band · ${DEFAULT_UNIT}`,
    ["Modal", `Rolling mean (${window})`, "Lower band", "Upper band"],
    (params) => {
      const index = paramIndex(params);
      const row = rows[index];
      if (!row) return "";
      if (row.gap) {
        return tooltipShell("Gap", [
          field("Data", `— no trading data across ${formatCount(row.skippedDays)} skipped day${row.skippedDays === 1 ? "" : "s"}`),
        ]);
      }
      const lower = lowers[index];
      const span = spans[index];
      const upper = lower != null && span != null ? round2(lower + span) : null;
      return tooltipShell(formatDateLabel(row.date), [
        field("Modal", formatValue(row.modal, DEFAULT_UNIT)),
        field(`Rolling mean (${window})`, formatValue(means[index], DEFAULT_UNIT)),
        field("Lower band", formatValue(lower, DEFAULT_UNIT)),
        field("Upper band", formatValue(upper, DEFAULT_UNIT)),
        field("Window n", formatCount(counts[index])),
      ]);
    },
    compact ? `n = ${formatCount(points.length)}` : skippedNote,
  );

  return {
    ...option,
    // On a 390 panel the four-item legend and a y-axis name share the same
    // top-right corner; the unit already lives in the panel caption.
    legend: { ...(option.legend as Record<string, unknown>), top: compact ? 42 : CHART_LAYOUT.legendTopWithSubtext },
    grid: [
      {
        left: compact ? 48 : 56,
        right: compact ? 12 : 24,
        top: compact ? 66 : CHART_LAYOUT.gridTopWithSubtext,
        bottom: CHART_LAYOUT.gridBottomWithZoom,
        containLabel: true,
      },
    ],
    xAxis: [categoryAxis(rows.map((row) => (row.gap ? "" : formatDateLabel(row.date))), t)],
    yAxis: [valueAxis(t, compact ? undefined : DEFAULT_UNIT)],
    dataZoom: makeDataZoom(t, [0]),
    series: [
      {
        name: "Modal",
        type: "line",
        data: rows.map((row) => row.modal),
        showSymbol: false,
        symbol: "none",
        connectNulls: false,
        lineStyle: { color: PRIMARY, width: 2 },
        itemStyle: { color: PRIMARY },
        z: 5,
      },
      {
        name: `Rolling mean (${window})`,
        type: "line",
        data: means,
        showSymbol: false,
        symbol: "none",
        connectNulls: false,
        lineStyle: { color: INFO, width: 2, type: "dashed" },
        itemStyle: { color: INFO },
        z: 4,
      },
      // The band is stacked: the lower leg is invisible and the upper leg draws
      // only the span, so ECharts fills the region between the two bounds.
      {
        name: "Lower band",
        type: "line",
        stack: "agri-rolling-band",
        data: lowers,
        showSymbol: false,
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: alpha(INFO, 0) },
        silent: true,
        z: 1,
      },
      {
        name: "Upper band",
        type: "line",
        stack: "agri-rolling-band",
        data: spans,
        showSymbol: false,
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: alpha(INFO, 0.15) },
        silent: true,
        z: 2,
      },
    ],
  };
}
