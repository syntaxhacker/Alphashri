import { Show, createMemo } from "solid-js";
import { typeSize } from "@/ui/typography";
import { EChart } from "../../../common/EChart";
import { CHART_CURRENT, CHART_LINE, CHART_MUTED, CHART_NEUTRAL } from "./chartPalette";
import { baseOption, niceAxis, tooltipStyle, valueAxis } from "./core/chartBase";
import { finite, signedPct } from "./shared";
import {
  buildRelativeStrengthModel,
  type RelativeStrengthInput,
  type RelativeStrengthModel,
} from "./RelativeStrength";

const CHART_HEIGHT = 280;
const LABEL_FONT = typeSize("micro");
const MOMENTUM_LOOKBACK = 6;
const TRAIL_POINTS = 12;
const PERCENT = 100;

export interface RelativeStrengthTrailProps extends RelativeStrengthInput {
  /** Set false when the host panel already renders the title and method note. */
  showHeader?: boolean;
}

export interface RsTrailPoint {
  month: string;
  /** Normalized relative-strength index (100 = parity at the first common month). */
  rs: number;
  /** Decimal fraction, e.g. 0.061 is +6.1% over six months. */
  momentum: number;
}

export interface RsTrailModel {
  hasData: boolean;
  hasBenchmark: boolean;
  hasSector: boolean;
  enoughHistory: boolean;
  sectorName: string;
  benchmarkName: string;
  points: RsTrailPoint[];
  current: RsTrailPoint | null;
}

interface TrailChartPoint {
  value: [number, number];
  month: string;
}

interface TrailTooltipParam {
  data?: unknown;
  value?: unknown;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toChartPoint(point: RsTrailPoint): TrailChartPoint {
  return {
    value: [round(point.rs), round(point.momentum * PERCENT)],
    month: point.month,
  };
}

function tooltipPoint(param: TrailTooltipParam | undefined): TrailChartPoint | null {
  if (!param || typeof param.data !== "object" || param.data === null) return null;
  const data = param.data as { value?: unknown; month?: unknown };
  if (!Array.isArray(data.value) || data.value.length < 2) return null;
  const x = Number(data.value[0]);
  const y = Number(data.value[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    value: [x, y],
    month: typeof data.month === "string" ? data.month : "",
  };
}

/**
 * Ratio / ratio[-6] - 1 over the trailing 12 momentum observations. Gaps in the
 * relative-strength series are skipped, so the lookback is six valid ratio points.
 */
export function buildRsTrailModel(base: RelativeStrengthModel): RsTrailModel {
  const valid: Array<{ month: string; ratio: number }> = [];
  for (let index = 0; index < base.months.length; index++) {
    const ratio = base.ratios[index];
    if (!finite(ratio)) continue;
    valid.push({ month: base.months[index], ratio });
  }

  const enoughHistory = valid.length > MOMENTUM_LOOKBACK;
  const momentumPoints: RsTrailPoint[] = [];
  if (enoughHistory) {
    for (let index = MOMENTUM_LOOKBACK; index < valid.length; index++) {
      const prior = valid[index - MOMENTUM_LOOKBACK].ratio;
      const current = valid[index].ratio;
      if (!finite(prior) || prior <= 0) continue;
      const momentum = current / prior - 1;
      if (!Number.isFinite(momentum)) continue;
      momentumPoints.push({
        month: valid[index].month,
        rs: current,
        momentum,
      });
    }
  }

  const points = momentumPoints.slice(-TRAIL_POINTS);

  return {
    hasData: points.length > 0,
    hasBenchmark: base.hasBenchmark,
    hasSector: base.hasSector,
    enoughHistory,
    sectorName: base.sectorName,
    benchmarkName: base.benchmarkName,
    points,
    current: points.length > 0 ? points[points.length - 1] : null,
  };
}

export function formatRsTrailTooltip(params: TrailTooltipParam | TrailTooltipParam[]): string {
  const item = Array.isArray(params) ? params[0] : params;
  const point = tooltipPoint(item);
  if (!point) return "";
  return `${escapeHtml(point.month)} · RS ${point.value[0].toFixed(1)} · 6M ${signedPct(point.value[1])}`;
}

export function buildRelativeStrengthTrailOption(model: RsTrailModel): Record<string, unknown> {
  const chartPoints = model.points.map(toChartPoint);
  const currentIndex = chartPoints.length - 1;
  const trailPoints = chartPoints.slice(0, Math.max(0, currentIndex));
  const currentPoint = currentIndex >= 0 ? [chartPoints[currentIndex]] : [];

  const xValues = chartPoints.map((point) => point.value[0]);
  const yValues = chartPoints.map((point) => point.value[1]);
  let xLow = 100;
  let xHigh = 100;
  let yLow = 0;
  let yHigh = 0;
  for (const value of xValues) {
    xLow = Math.min(xLow, value);
    xHigh = Math.max(xHigh, value);
  }
  for (const value of yValues) {
    yLow = Math.min(yLow, value);
    yHigh = Math.max(yHigh, value);
  }
  const xPadding = Math.max(0.5, (xHigh - xLow) * 0.1);
  const yPadding = Math.max(0.5, (yHigh - yLow) * 0.12);
  const xAxis = niceAxis(xLow - xPadding, xHigh + xPadding, 5, 1);
  const yAxis = niceAxis(yLow - yPadding, yHigh + yPadding, 5, 1);

  return {
    ...baseOption(
      `${model.sectorName} momentum trail versus ${model.benchmarkName}: relative strength ` +
        "on the horizontal axis and six-month momentum on the vertical axis. Quadrant lines " +
        "sit at 100 and zero. The highlighted point is the current month. A descriptive " +
        "trail, not a JdK relative rotation graph.",
    ),
    grid: { left: 56, right: 44, top: 30, bottom: 40 },
    tooltip: tooltipStyle("item", formatRsTrailTooltip),
    xAxis: {
      ...valueAxis({
        min: xAxis.min,
        max: xAxis.max,
        interval: xAxis.interval,
        name: "RS index",
        formatter: (value: number) => value.toFixed(0),
      }),
      nameGap: 26,
      axisLine: { show: true, lineStyle: { color: CHART_MUTED, opacity: 0.45 } },
      splitLine: { lineStyle: { color: CHART_NEUTRAL, opacity: 0.14 } },
    },
    yAxis: {
      ...valueAxis({
        min: yAxis.min,
        max: yAxis.max,
        interval: yAxis.interval,
        name: "6M momentum",
        formatter: (value: number) => `${value.toFixed(0)}%`,
      }),
      nameGap: 40,
      splitLine: { lineStyle: { color: CHART_NEUTRAL, opacity: 0.14 } },
    },
    series: [
      {
        name: "Trail",
        type: "line",
        data: chartPoints,
        symbol: "none",
        lineStyle: { color: CHART_LINE, width: 1.2, opacity: 0.55 },
        markLine: {
          silent: true,
          symbol: ["none", "none"],
          label: { show: false },
          lineStyle: { color: CHART_MUTED, type: "dashed", width: 1, opacity: 0.7 },
          data: [{ xAxis: 100 }, { yAxis: 0 }],
        },
        z: 1,
      },
      {
        name: "Trail points",
        type: "scatter",
        data: trailPoints,
        symbolSize: 5,
        itemStyle: { color: CHART_LINE, opacity: 0.65 },
        label: {
          show: trailPoints.length > 0,
          position: "top",
          distance: 6,
          color: CHART_MUTED,
          fontSize: LABEL_FONT,
          formatter: (params: { dataIndex?: number; data?: unknown }) => {
            if (params.dataIndex !== 0) return "";
            const data = params.data as { month?: unknown } | undefined;
            return typeof data?.month === "string" ? data.month : "";
          },
        },
        z: 2,
      },
      {
        name: "Current",
        type: "scatter",
        data: currentPoint,
        symbolSize: 11,
        itemStyle: { color: CHART_CURRENT, borderColor: CHART_NEUTRAL, borderWidth: 1 },
        label: {
          show: currentPoint.length > 0,
          position: "top",
          color: CHART_CURRENT,
          fontSize: LABEL_FONT,
          formatter: (params: { data?: unknown }) => {
            const data = params.data as { month?: unknown } | undefined;
            return typeof data?.month === "string" ? data.month : "";
          },
        },
        z: 3,
      },
    ],
  };
}

export function RelativeStrengthTrail(props: RelativeStrengthTrailProps) {
  const base = createMemo(() =>
    buildRelativeStrengthModel({
      months: props.months,
      series: props.series,
      sector: props.sector,
    }),
  );
  const model = createMemo(() => buildRsTrailModel(base()));
  const option = createMemo(() => buildRelativeStrengthTrailOption(model()));

  const emptyMessage = () => {
    if (!model().hasBenchmark) return "No benchmark series";
    if (!model().hasSector) return `No history for ${props.sector}`;
    return "Not enough relative history for a 6M trail";
  };

  return (
    <div data-testid="history-rs-trail" class="flex min-w-0 flex-col gap-1">
      <Show when={props.showHeader !== false}>
        <div data-testid="history-rs-trail-header" class="flex flex-col gap-0.5">
          <span class="text-ui-micro font-semibold text-fin-text">
            {`RS momentum trail · last ${TRAIL_POINTS} months`}
          </span>
        </div>
      </Show>
      <Show
        when={model().hasData}
        fallback={
          <div
            data-testid="history-rs-trail-empty"
            class="py-3 text-center text-ui-micro text-fin-text-muted"
          >
            {emptyMessage()}
          </div>
        }
      >
        <EChart
          option={option()}
          data-testid="history-rs-trail-chart"
          style={{ height: `${CHART_HEIGHT}px`, width: "100%" }}
        />
        <span data-testid="history-rs-trail-quadrants" class="text-ui-micro text-fin-text-muted">
          {"RS > 100 = outperform · momentum > 0 = improving · descriptive, not JdK RRG"}
        </span>
      </Show>
    </div>
  );
}
