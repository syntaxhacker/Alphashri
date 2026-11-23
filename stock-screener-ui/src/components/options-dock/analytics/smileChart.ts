import { typeSize } from "@/ui";
/**
 * Intuition layer for the IV smile: strike on the x-axis, 25Δ wings as first
 * class markers, and a plain-language read of which side is rich. All of it is
 * a function of the OTM smile points already on screen — no request, no store.
 */

import * as palette from "@/ui/palette";
import type { OptionSide, SmilePoint } from "@/utils/optionsAnalyticsMath";
import { formatVp } from "@/utils/optionsAnalyticsMath";

export interface Wing {
  strike: number;
  iv: number;
  delta: number;
}

const WING_TARGET = 0.25;
const WING_LOW = 0.15;
const WING_HIGH = 0.35;

/** Nearest OTM point whose delta sits in the 15–35Δ band, signed by side. */
export function findWing(points: readonly SmilePoint[], side: OptionSide): Wing | null {
  let best: Wing | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const signedTarget = side === "CE" ? WING_TARGET : -WING_TARGET;
  for (const point of points) {
    if (point.delta == null || !Number.isFinite(point.delta)) continue;
    const magnitude = Math.abs(point.delta);
    if (magnitude < WING_LOW || magnitude > WING_HIGH) continue;
    if (side === "CE" ? point.delta <= 0 : point.delta >= 0) continue;
    const distance = Math.abs(point.delta - signedTarget);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = { strike: point.strike, iv: point.iv, delta: point.delta };
  }
  return best;
}

/** call − put; negative reads as "puts rich" in the desk's sign convention. */
export function wingVp(call: Wing | null, put: Wing | null): number | null {
  if (!call || !put) return null;
  const value = call.iv - put.iv;
  return Number.isFinite(value) ? value : null;
}

export function wingVerdict(vp: number | null): string {
  if (vp == null) return "";
  if (vp < 0) return "PUTS RICH";
  return vp > 0 ? "CALLS RICH" : "FLAT";
}

/** One-line plain-language read, never a bare dash when a wing is missing. */
export function wingAnnotation(call: Wing | null, put: Wing | null): string {
  const missing: string[] = [];
  if (!put) missing.push("25Δ put missing");
  if (!call) missing.push("25Δ call missing");
  if (missing.length) return missing.join(" · ");
  const vp = wingVp(call, put);
  return `25Δ wings: put ${(put as Wing).iv.toFixed(1)} · call ${(call as Wing).iv.toFixed(1)} → ${wingVerdict(vp)} ${formatVp(vp)}`;
}

/** Strikes are rupee levels, so a compact K/L formatter would be ambiguous. */
export function formatStrike(strike: number): string {
  return Number.isInteger(strike) ? String(strike) : strike.toFixed(1);
}

export function atmStrikeOf(
  points: readonly { strike: number }[],
  spot: number,
): number | null {
  if (!Number.isFinite(spot) || spot <= 0 || points.length === 0) return null;
  return points.reduce<number>(
    (best, point) => (Math.abs(point.strike - spot) < Math.abs(best - spot) ? point.strike : best),
    points[0].strike,
  );
}

const roundIv = (iv: number): number => Number(iv.toFixed(2));

/** Chart text floor: the analytics band is 206px tall, sub-10px ticks vanish. */
export const CHART_LABEL_FONT_SIZE = typeSize("micro");

/** At most five strike labels across the plot — 38 quotes must never merge. */
export const SMILE_MAX_AXIS_LABELS = 5;

const STRIKE_STEPS = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000,
];

/**
 * Explicit tick step for a dense strike axis. ECharts' own "nice" interval
 * depends on the canvas width, so the same 38-strike chain got a legible axis
 * at 675px and nine colliding labels at 390px. The step is a pure function of
 * the quoted strikes, which makes the result width-independent and testable.
 * Returns 0 when there is nothing to thin (the caller then leaves ECharts auto).
 */
export function strikeAxisInterval(
  strikes: readonly number[],
  maxLabels = SMILE_MAX_AXIS_LABELS,
): number {
  const finite = [...new Set(strikes.filter((strike) => Number.isFinite(strike)))].sort(
    (a, b) => a - b,
  );
  if (finite.length < 2) return 0;
  const span = finite[finite.length - 1] - finite[0];
  if (!(span > 0)) return 0;
  const gaps = finite.slice(1).map((strike, index) => strike - finite[index]);
  const minGap = Math.min(...gaps);
  const raw = span / Math.max(1, maxLabels - 1);
  // Never finer than the quoted strike grid: an invented tick between two
  // strikes is noise, and a two-strike chain only ever needs two labels.
  const nice = STRIKE_STEPS.find((step) => step >= raw) ?? Math.ceil(raw);
  return Math.max(nice, minGap);
}

export interface SmileChartInput {
  ce: readonly SmilePoint[];
  pe: readonly SmilePoint[];
  spot: number;
  legStrikes: readonly number[];
  pain: number | null;
  callWing: Wing | null;
  putWing: Wing | null;
  ink: string;
}

/**
 * ECharts option for the strike-based smile. The axes stay in rupees; the
 * moneyness read moves to the tooltip so it cannot be mistaken for the axis.
 */
export function buildSmileOption(input: SmileChartInput): Record<string, unknown> {
  const { ce, pe, spot, legStrikes, pain, callWing, putWing, ink } = input;
  const ceByStrike = new Map(ce.map((point) => [point.strike, point]));
  const peByStrike = new Map(pe.map((point) => [point.strike, point]));
  const atm = atmStrikeOf([...ce, ...pe], spot);

  const marks = [
    ...(atm != null
      ? [
          {
            xAxis: atm,
            name: "ATM",
            lineStyle: { color: palette.PRIMARY, width: 1, type: "solid" as const },
          },
        ]
      : []),
    ...legStrikes.map((strike) => ({
      xAxis: strike,
      name: formatStrike(strike),
      lineStyle: { color: ink, width: 1, type: "dotted" as const },
    })),
    ...(pain != null
      ? [
          {
            xAxis: pain,
            name: "MP",
            lineStyle: { color: palette.WARNING, width: 1, type: "dashed" as const },
          },
        ]
      : []),
  ];

  const tooltipFormatter = (raw: unknown): string => {
    const params = (Array.isArray(raw) ? raw : [raw]) as Array<{
      seriesName?: string;
      value?: unknown;
      color?: string;
    }>;
    const priced = params.find((item) => Array.isArray(item.value));
    const pricedValue = priced?.value;
    const strike = Array.isArray(pricedValue) ? Number(pricedValue[0]) : NaN;
    if (!Number.isFinite(strike)) return "";
    const pct = spot > 0 ? (strike / spot - 1) * 100 : Number.NaN;
    const pctText = Number.isFinite(pct) ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "—";
    const lines = [
      `<div><b>₹${formatStrike(strike)}</b> · ${pctText} from spot</div>`,
    ];
    for (const param of params) {
      if (param.seriesName !== "Calls" && param.seriesName !== "Puts") continue;
      const value = Array.isArray(param.value) ? (param.value as number[]) : [];
      const iv = Number(value[1]);
      if (!Number.isFinite(iv)) continue;
      const point = param.seriesName === "Calls" ? ceByStrike.get(strike) : peByStrike.get(strike);
      const delta = point?.delta == null ? "—" : point.delta.toFixed(2);
      lines.push(
        `<div style="color:${param.color ?? palette.TEXT}">${param.seriesName} · IV ${iv.toFixed(1)}% · Δ ${delta}</div>`,
      );
    }
    return lines.join("");
  };

  const wingPoint = (wing: Wing, name: string, color: string) => ({
    value: [wing.strike, roundIv(wing.iv)],
    name,
    itemStyle: { color },
  });

  // Axis names are not painted: `containLabel` does not reserve room for them,
  // so a name row would either eat the plot or overlap the tick labels in a
  // 70px canvas. The strike axis is obvious, and the y ticks carry the unit.
  const axisInterval = strikeAxisInterval([...ce, ...pe].map((point) => point.strike));

  return {
    animation: false,
    backgroundColor: "transparent",
    grid: { left: 2, right: 12, top: 16, bottom: 2, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: palette.TOOLTIP_BG,
      borderColor: palette.TOOLTIP_BORDER,
      textStyle: { color: palette.OPTION_PAYOFF_TOOLTIP_TEXT, fontSize: typeSize("micro") },
      formatter: tooltipFormatter,
    },
    xAxis: {
      type: "value",
      scale: true,
      axisLine: { lineStyle: { color: palette.AXIS_LINE } },
      axisTick: { show: false },
      axisLabel: {
        color: ink,
        fontSize: CHART_LABEL_FONT_SIZE,
        margin: 4,
        // Belt and braces: an explicit step thins 38 strikes, hideOverlap drops
        // any residual collision instead of painting labels on top of each other.
        hideOverlap: true,
        rotate: 0,
        formatter: (value: number | string) => formatStrike(Number(value)),
        ...(axisInterval > 0 ? { interval: axisInterval } : {}),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      scale: true,
      splitNumber: 3,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: ink,
        fontSize: CHART_LABEL_FONT_SIZE,
        margin: 3,
        hideOverlap: true,
        formatter: "{value}%",
      },
      splitLine: { lineStyle: { color: palette.AXIS_SPLIT } },
    },
    series: [
      {
        name: "Calls",
        type: "line",
        data: ce.map((point) => [point.strike, roundIv(point.iv)]),
        showSymbol: true,
        symbolSize: 3,
        lineStyle: { width: 1.5, color: palette.INFO },
        itemStyle: { color: palette.INFO },
      },
      {
        name: "Puts",
        type: "line",
        data: pe.map((point) => [point.strike, roundIv(point.iv)]),
        showSymbol: true,
        symbolSize: 3,
        lineStyle: { width: 1.5, color: palette.WARNING },
        itemStyle: { color: palette.WARNING },
      },
      {
        name: "25Δ wings",
        type: "scatter",
        symbolSize: 7,
        z: 5,
        tooltip: { show: false },
        label: {
          show: true,
          position: "top",
          distance: 2,
          formatter: "{b}",
          color: palette.TEXT,
          fontSize: CHART_LABEL_FONT_SIZE,
          fontFamily: palette.MONO,
          backgroundColor: palette.SURFACE,
          padding: [0, 1],
          borderRadius: 2,
        },
        data: [
          ...(callWing ? [wingPoint(callWing, "25ΔC", palette.INFO)] : []),
          ...(putWing ? [wingPoint(putWing, "25ΔP", palette.WARNING)] : []),
        ],
      },
      {
        name: "marks",
        type: "line",
        data: [],
        silent: true,
        markLine: {
          silent: true,
          symbol: "none",
          label: {
            show: true,
            // Inside the plot at the top end: a mark label must never sit in the
            // x-axis band, where it would cover the strike ticks.
            position: "insideEndTop" as const,
            formatter: "{b}",
            color: palette.TEXT,
            fontSize: CHART_LABEL_FONT_SIZE,
            fontFamily: palette.MONO,
            backgroundColor: palette.SURFACE,
            padding: [1, 2],
            borderRadius: 2,
          },
          data: marks,
        },
      },
    ],
  };
}
