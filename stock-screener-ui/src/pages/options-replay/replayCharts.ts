import * as palette from "@/ui/palette";
import type { OptionReplayResult, ReplayFrame } from "@/types/optionsPaper";

/**
 * ECharts option keys are camelCase — a kebab `font-size` / `width` is silently
 * ignored, which is why the replay axes previously rendered at the browser
 * default. These live here as the single source for both replay charts.
 */
export const CHART_LABEL_FONT_SIZE = 11;
export const PROFIT_AREA_TINT = palette.alpha(palette.POSITIVE, 0.2);
export const LOSS_AREA_TINT = palette.alpha(palette.NEGATIVE, 0.2);

const axisLabel = {
  fontSize: CHART_LABEL_FONT_SIZE,
  fontFamily: palette.MONO,
  color: palette.CHART_MUTED,
  hideOverlap: true,
};

/** Mark labels sit on the panel surface, never directly on a saturated line. */
const markLabel = {
  backgroundColor: palette.SURFACE,
  borderColor: palette.BORDER,
  borderWidth: 1,
  borderRadius: 3,
  padding: [2, 4] as [number, number],
  fontSize: CHART_LABEL_FONT_SIZE,
  fontFamily: palette.MONO,
};

const tooltipBase = {
  backgroundColor: palette.TOOLTIP_BG,
  borderColor: palette.TOOLTIP_BORDER,
  borderWidth: 1,
  textStyle: { color: palette.TOOLTIP_TEXT, fontSize: CHART_LABEL_FONT_SIZE },
  extraCssText: "border-radius:4px",
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function inr(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const body = abs >= 1000
    ? `${(abs / 1000).toFixed(1)}k`
    : value.toFixed(2).replace(/\.?0+$/, "");
  return `${value < 0 ? "-" : ""}₹${body}`;
}

/** Axis-trigger tooltip: names the figure instead of dumping a raw series key. */
export function replayPathTooltipHtml(raw: unknown): string {
  const list = Array.isArray(raw) ? raw : [raw];
  const point = (list.find((p) => (p as { seriesName?: string })?.seriesName === "net P&L") ?? list[0]) as
    | { axisValue?: unknown; value?: unknown }
    | undefined;
  const stamp = typeof point?.axisValue === "string" ? point.axisValue : "";
  const when = stamp ? `${stamp.slice(5, 10)} ${stamp.slice(11, 16)}` : "playhead";
  const value = finite(Array.isArray(point?.value) ? point.value[1] : point?.value);
  const pnl = value === null ? "no frame at this time" : inr(value);
  return [
    `<div style="font-weight:600">${escapeHtml(when)}</div>`,
    `<div>Mark-to-market P&amp;L <b>${pnl}</b></div>`,
    `<div style="color:${palette.CHART_MUTED}">net of entry charges only</div>`,
  ].join("");
}

/** Value-axis tooltip: states that the curve is intrinsic value, not MTM. */
export function replayPayoffTooltipHtml(raw: unknown): string {
  const item = (Array.isArray(raw) ? raw[0] : raw) as { value?: unknown } | undefined;
  const row = Array.isArray(item?.value) ? item.value : [];
  const spot = finite(row[0]);
  const pnl = finite(row[1]);
  return [
    `<div style="font-weight:600">Spot ${spot === null ? "—" : inr(spot)}</div>`,
    `<div>Expiry payoff <b>${pnl === null ? "—" : inr(pnl)}</b></div>`,
    `<div style="color:${palette.CHART_MUTED}">intrinsic value at expiry · gross of costs</div>`,
  ].join("");
}

/** P&L over replay time, with a vertical line and a value marker at the playhead. */
export function pathChartOption(
  result: OptionReplayResult | null,
  asOf: string | null,
): Record<string, unknown> {
  const frames: ReplayFrame[] = result?.frames ?? [];
  const points: Array<[string, number]> = frames.map((frame) => [frame.t, finite(frame.netPnl) ?? 0]);
  const positive = points.map(([t, pnl]) => [t, Math.max(0, pnl)]);
  const negative = points.map(([t, pnl]) => [t, Math.min(0, pnl)]);
  const active = points.find(([t]) => t === asOf) ?? points.at(-1) ?? null;
  return {
    animation: false,
    backgroundColor: "transparent",
    grid: { left: "12px", right: "16px", top: "18px", bottom: "26px", containLabel: true },
    tooltip: {
      ...tooltipBase,
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: palette.CHART_CROSSHAIR } },
      formatter: replayPathTooltipHtml,
    },
    xAxis: {
      type: "category",
      data: frames.map((frame) => frame.t),
      axisLabel: {
        ...axisLabel,
        formatter: (value: string) => value.slice(5, 16).replace("T", " "),
      },
      axisLine: { lineStyle: { color: palette.AXIS_LINE } },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: { ...axisLabel, formatter: (value: number) => inr(value) },
      axisLine: { lineStyle: { color: palette.AXIS_LINE } },
      splitLine: { lineStyle: { color: palette.AXIS_SPLIT } },
    },
    series: [
      {
        name: "profit",
        type: "line",
        showSymbol: false,
        silent: true,
        data: positive,
        lineStyle: { opacity: 0 },
        areaStyle: { color: PROFIT_AREA_TINT },
      },
      {
        name: "loss",
        type: "line",
        showSymbol: false,
        silent: true,
        data: negative,
        lineStyle: { opacity: 0 },
        areaStyle: { color: LOSS_AREA_TINT },
      },
      {
        name: "net P&L",
        type: "line",
        showSymbol: false,
        z: 3,
        data: points,
        lineStyle: { color: palette.PRIMARY, width: 2 },
        ...(active
          ? {
              markPoint: {
                symbol: "circle",
                symbolSize: 9,
                silent: true,
                itemStyle: { color: palette.PRIMARY, borderColor: palette.SURFACE, borderWidth: 2 },
                label: { ...markLabel, show: true, position: "top", color: palette.TEXT, formatter: inr(active[1]) },
                data: [{ coord: [active[0], active[1]], name: "P&L" }],
              },
            }
          : {}),
        markLine: asOf
          ? {
              symbol: "none",
              silent: true,
              data: [
                {
                  xAxis: asOf,
                  lineStyle: { color: palette.TERM_SPOT, type: "dotted", width: 1 },
                  label: { ...markLabel, formatter: "PLAYHEAD", color: palette.TERM_SPOT },
                },
              ],
            }
          : undefined,
      },
    ],
  };
}

/**
 * Expiry payoff curve. This is intrinsic value at expiry, not mark-to-market.
 * `payoff` is the interpolated value at spot from the caller's single source;
 * when it is absent the nearest plotted point is used, never a fabricated one.
 */
export function payoffChartOption(
  result: OptionReplayResult | null,
  spot: number,
  payoff: number | null = null,
): Record<string, unknown> {
  const spots = result?.payoff.spots ?? [];
  const expiry = result?.payoff.expiry ?? [];
  const points: Array<[number, number]> = spots.map((value, index) => [
    Number(value),
    finite(expiry[index]) ?? 0,
  ]);
  const positive = points.map(([value, pnl]) => [value, Math.max(0, pnl)]);
  const negative = points.map(([value, pnl]) => [value, Math.min(0, pnl)]);
  const beLines = (result?.breakevens ?? []).map((value) => ({
    xAxis: value,
    lineStyle: { color: palette.CHART_AVG_ENTRY, type: "dashed", width: 1 },
    label: { ...markLabel, formatter: inr(value), color: palette.CHART_AVG_ENTRY },
  }));

  const spotValue = finite(spot);
  const nearest = points.length
    ? points.reduce((best, point) =>
        Math.abs(point[0] - (spotValue ?? 0)) < Math.abs(best[0] - (spotValue ?? 0)) ? point : best,
      )
    : null;
  const marked = payoff !== null && Number.isFinite(payoff) ? payoff : nearest?.[1] ?? null;
  const markPoint = spotValue !== null && Number.isFinite(marked)
    ? {
        symbol: "circle",
        symbolSize: 9,
        silent: true,
        itemStyle: { color: palette.TERM_SPOT, borderColor: palette.SURFACE, borderWidth: 2 },
        label: { ...markLabel, show: true, position: "top", color: palette.TEXT, formatter: inr(marked!) },
        data: [{ coord: [spotValue, marked], name: "spot payoff" }],
      }
    : undefined;

  return {
    animation: false,
    backgroundColor: "transparent",
    grid: { left: "12px", right: "16px", top: "18px", bottom: "26px", containLabel: true },
    tooltip: { ...tooltipBase, trigger: "axis", formatter: replayPayoffTooltipHtml },
    xAxis: {
      type: "value",
      scale: true,
      axisLabel: { ...axisLabel, formatter: (value: number) => inr(value) },
      axisLine: { lineStyle: { color: palette.AXIS_LINE } },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: { ...axisLabel, formatter: (value: number) => inr(value) },
      axisLine: { lineStyle: { color: palette.AXIS_LINE } },
      splitLine: { lineStyle: { color: palette.AXIS_SPLIT } },
    },
    series: [
      {
        name: "profit",
        type: "line",
        showSymbol: false,
        silent: true,
        data: positive,
        lineStyle: { opacity: 0 },
        areaStyle: { color: PROFIT_AREA_TINT },
      },
      {
        name: "loss",
        type: "line",
        showSymbol: false,
        silent: true,
        data: negative,
        lineStyle: { opacity: 0 },
        areaStyle: { color: LOSS_AREA_TINT },
      },
      {
        name: "payoff",
        type: "line",
        showSymbol: false,
        z: 3,
        data: points,
        lineStyle: { color: palette.PRIMARY, width: 2 },
        ...(markPoint ? { markPoint } : {}),
        markLine: {
          symbol: "none",
          silent: true,
          data: [
            { yAxis: 0, lineStyle: { color: palette.CHART_MUTED, type: "dashed", width: 1 } },
            {
              xAxis: spot,
              lineStyle: { color: palette.TERM_SPOT, type: "dotted", width: 1 },
              label: { ...markLabel, formatter: "SPOT", color: palette.TERM_SPOT },
            },
            ...beLines,
          ],
        },
      },
    ],
  };
}
