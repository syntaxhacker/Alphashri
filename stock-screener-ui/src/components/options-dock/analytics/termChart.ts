import { typeSize } from "@/ui";
/**
 * Pure view-model + ECharts option for the ATM-IV-by-expiry (term) panel.
 *
 * The x-axis is categorical: each point is keyed by its expiry date label, so
 * the date travels with the value into the tooltip instead of a bare DTE number.
 * DTE is kept as the sort key and shown in the tooltip.
 */

import * as palette from "@/ui/palette";
import type { AnalyticsExpiry, OptionsAnalytics } from "@/api/optionsAnalytics";
import { termPoints, termSlope, type TermPoint } from "@/utils/optionsAnalyticsMath";

/** Chart text floor: the analytics band is 206px tall, sub-10px ticks vanish. */
export const CHART_LABEL_FONT_SIZE = typeSize("micro");

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

export const TERM_HINT = "Curve = all expiries; the marker shows the selected expiry";

export interface TermPointVM {
  /** ISO date when the point came from a dated expiry; null for a DTE-only fallback. */
  date: string | null;
  /** Category label, e.g. `23 NOV`. */
  label: string;
  dte: number;
  iv: number;
}

export type TermShape = "backwardation" | "contango" | "flat";

export interface TermBadge {
  shape: TermShape;
  text: string;
}

export interface TermVM {
  points: TermPointVM[];
  slope: number | null;
  /** Earliest/latest expiry by DTE, with the label even when the IV is absent. */
  frontLabel: string;
  backLabel: string;
  /** The point for the earliest/latest expiry, or null when its IV is missing. */
  front: TermPointVM | null;
  back: TermPointVM | null;
  /** True when the earliest expiry exists but has no usable ATM IV. */
  frontMissing: boolean;
  selected: TermPointVM | null;
  selectedLabel: string;
  badge: TermBadge | null;
}

export function expiryLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const month = MONTHS[Number(match[2]) - 1] ?? "";
  return `${Number(match[3])} ${month}`.trim();
}

export function termTooltip(point: TermPointVM): string {
  return `${point.label} · ${point.dte} DTE · IV ${point.iv.toFixed(1)}%`;
}

function enrich(points: readonly TermPoint[], data: OptionsAnalytics): TermPointVM[] {
  const byDte = new Map<number, AnalyticsExpiry>();
  for (const expiry of data.expiries) {
    if (expiry.dte != null && Number.isFinite(expiry.dte) && !byDte.has(expiry.dte)) {
      byDte.set(expiry.dte, expiry);
    }
  }
  return points
    .map((point) => {
      const date = byDte.get(point.dte)?.date ?? null;
      return {
        date,
        label: date ? expiryLabel(date) : `${point.dte} DTE`,
        dte: point.dte,
        iv: point.iv,
      };
    })
    .sort((a, b) => a.dte - b.dte || (a.date ?? "").localeCompare(b.date ?? ""));
}

function pointAtExpiry(points: readonly TermPointVM[], expiry: AnalyticsExpiry | null): TermPointVM | null {
  if (!expiry || expiry.dte == null) return null;
  return points.find((point) => point.dte === expiry.dte) ?? null;
}

function buildBadge(slope: number | null, points: readonly TermPointVM[]): TermBadge | null {
  if (slope == null || points.length < 2) return null;
  const near = points[0];
  const far = points[points.length - 1];
  const gap = Math.abs(near.iv - far.iv).toFixed(0);
  if (slope < -1) {
    return { shape: "backwardation", text: `BACKWARDATION · near-term +${gap} vp over ${far.label}` };
  }
  if (slope > 1) {
    return { shape: "contango", text: `CONTANGO · later expiries +${gap} vp` };
  }
  return { shape: "flat", text: "FLAT" };
}

export function buildTermVM(data: OptionsAnalytics, selectedExpiry: string | null): TermVM {
  const raw = termPoints(data, "atm");
  const points = enrich(raw, data);
  const slope = termSlope(raw);

  const ordered = data.expiries
    .filter((expiry) => expiry.dte != null && Number.isFinite(expiry.dte))
    .sort((a, b) => (a.dte as number) - (b.dte as number));
  const frontExpiry = ordered[0] ?? null;
  const backExpiry = ordered[ordered.length - 1] ?? null;

  const front = frontExpiry ? pointAtExpiry(points, frontExpiry) : (points[0] ?? null);
  const back = backExpiry ? pointAtExpiry(points, backExpiry) : (points[points.length - 1] ?? null);

  const selectedExpiryRow = selectedExpiry
    ? data.expiries.find((expiry) => expiry.date === selectedExpiry) ?? null
    : null;
  const selected = selectedExpiryRow
    ? pointAtExpiry(points, selectedExpiryRow)
    : (points.find((point) => point.date === selectedExpiry) ?? null);

  return {
    points,
    slope,
    frontLabel: frontExpiry ? expiryLabel(frontExpiry.date) : (front?.label ?? ""),
    backLabel: backExpiry ? expiryLabel(backExpiry.date) : (back?.label ?? ""),
    front,
    back,
    frontMissing: frontExpiry != null && front == null,
    selected,
    selectedLabel: selectedExpiryRow ? expiryLabel(selectedExpiryRow.date) : (selected?.label ?? ""),
    badge: buildBadge(slope, points),
  };
}

export function buildTermOption(vm: TermVM, ink: string): Record<string, unknown> {
  const points = vm.points;
  const selected = vm.selected;
  const selectedIndex = selected ? points.findIndex((point) => point.dte === selected.dte) : -1;
  // Category axes accept fractional indices, so ±0.5 spans one whole category.
  const band =
    selectedIndex >= 0
      ? [
          [
            {
              xAxis: selectedIndex - 0.5,
              name: `SEL ${selected!.label}`,
              itemStyle: { color: palette.alpha(palette.PRIMARY, 0.14) },
            },
            { xAxis: selectedIndex + 0.5 },
          ],
        ]
      : [];

  return {
    animation: false,
    backgroundColor: "transparent",
    // `containLabel` keeps the x tick labels inside the band; the top row is the
    // point IV labels, which are inside the plot on purpose.
    grid: { left: 2, right: 10, top: 20, bottom: 2, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: palette.TOOLTIP_BG,
      borderColor: palette.TOOLTIP_BORDER,
      textStyle: { color: palette.OPTION_PAYOFF_TOOLTIP_TEXT, fontSize: typeSize("micro") },
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params];
        const first = list[0] as { dataIndex?: number } | undefined;
        const point = first?.dataIndex != null ? points[first.dataIndex] : undefined;
        return point ? termTooltip(point) : "";
      },
    },
    xAxis: {
      type: "category",
      data: points.map((point) => point.label),
      boundaryGap: true,
      axisLine: { lineStyle: { color: palette.AXIS_LINE } },
      axisTick: { show: false },
      axisLabel: {
        color: ink,
        fontSize: CHART_LABEL_FONT_SIZE,
        margin: 4,
        // Every expiry label carries a date; hide instead of clip when the
        // 390px dock cannot fit them all.
        interval: 0,
        hideOverlap: true,
        rotate: 0,
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
        name: "ATM IV",
        type: "line",
        data: points.map((point) => [point.label, Number(point.iv.toFixed(2))]),
        showSymbol: true,
        symbolSize: 4,
        lineStyle: { width: 1.5, color: palette.INFO },
        itemStyle: { color: palette.INFO },
        areaStyle: { color: palette.alpha(palette.INFO, 0.18), origin: "start" },
        label: {
          show: true,
          position: "top",
          distance: 2,
          color: ink,
          fontSize: CHART_LABEL_FONT_SIZE,
          fontFamily: palette.MONO,
          formatter: (param: { value?: unknown }) => {
            const value = Array.isArray(param?.value) ? param.value[1] : param?.value;
            const iv = Number(value);
            return Number.isFinite(iv) ? iv.toFixed(1) : "";
          },
        },
        labelLayout: { hideOverlap: true },
      },
      {
        name: "selected",
        type: "scatter",
        silent: true,
        data: selected ? [[selected.label, Number(selected.iv.toFixed(2))]] : [],
        symbolSize: 9,
        itemStyle: { color: palette.PRIMARY, borderColor: palette.BG, borderWidth: 1 },
        label: {
          show: true,
          // Below the marker: the point's own IV label owns the top slot, so
          // two labels on the same expiry can never overlap at 390px.
          position: "bottom",
          distance: 4,
          formatter: selected ? `SEL ${selected.label}` : "",
          color: palette.PRIMARY,
          fontSize: CHART_LABEL_FONT_SIZE,
          fontFamily: palette.MONO,
          backgroundColor: palette.SURFACE,
          padding: [1, 2],
          borderRadius: 2,
        },
        markArea: { silent: true, data: band },
      },
    ],
  };
}
