import { Show, createMemo } from "solid-js";
import type { SectorHistorySeries } from "../../../../types/sectorHistory";
import { buildIndexSeries, drawdownSeries } from "../historyMath";
import { EChart } from "../../../common/EChart";
import { CHART_MUTED, CHART_NEGATIVE, CHART_NEUTRAL } from "./chartPalette";
import { baseOption, categoryAxis, tooltipStyle, valueAxis } from "./core/chartBase";
import { finite, signedPct } from "./shared";

const CHART_HEIGHT = 250;
const PERCENT = 100;

export interface UnderwaterDrawdownProps {
  months: string[];
  series: SectorHistorySeries[];
  sector: string;
  /** Set false when the host panel already renders the title and method note. */
  showHeader?: boolean;
}

export interface DrawdownAxis {
  min: number;
  max: number;
  interval: number;
}

const DRAWDOWN_STEPS = [0.1, 0.2, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

export interface UnderwaterPoint {
  month: string;
  index: number;
  /** Decimal fraction, e.g. -0.124 is a 12.4% drawdown. */
  drawdown: number;
}

export interface UnderwaterModel {
  hasData: boolean;
  months: string[];
  /** Indexed monthly closes, aligned to the months axis; null where the return is missing. */
  indices: (number | null)[];
  /** Drawdown fractions aligned to the months axis; null where the close is missing. */
  drawdowns: (number | null)[];
  points: UnderwaterPoint[];
  maxDrawdown: number | null;
  maxDrawdownMonth: string | null;
}

interface UnderwaterTooltipParam {
  axisValue?: string;
  value?: unknown;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function percentValue(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[value.length - 1] : value;
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function niceDrawdownStep(span: number): number {
  if (!Number.isFinite(span) || span <= 0) return 0.5;
  const target = span / 6;
  let step = DRAWDOWN_STEPS[DRAWDOWN_STEPS.length - 1];
  for (const candidate of DRAWDOWN_STEPS) {
    if (candidate >= target) {
      step = candidate;
      break;
    }
  }
  while (step < target) step *= 10;
  return step;
}

/**
 * Y-axis bounds with a step of at least 0.1pp, so a one-decimal formatter can
 * never print the same label for two adjacent ticks.
 */
export function buildDrawdownAxis(values: (number | null)[]): DrawdownAxis {
  let lowest = 0;
  for (const value of values) {
    if (finite(value)) lowest = Math.min(lowest, value);
  }
  const span = Math.abs(lowest);
  const step = niceDrawdownStep(span);
  const min = span === 0 ? -1 : -Math.max(step, Math.ceil(span / step) * step);
  return { min: round(min), max: 0, interval: step };
}

/** Running-peak drawdown from an indexed monthly close series. */
export function buildUnderwaterModel(
  months: string[],
  returns: (number | null)[],
): UnderwaterModel {
  const indices = buildIndexSeries(months, returns);
  const drawdowns = drawdownSeries(indices);

  const points: UnderwaterPoint[] = [];
  for (let index = 0; index < months.length; index++) {
    const close = indices[index];
    const drawdown = drawdowns[index];
    if (!finite(close) || !finite(drawdown)) continue;
    points.push({ month: months[index], index: close, drawdown });
  }

  let maxDrawdown: number | null = null;
  let maxDrawdownMonth: string | null = null;
  for (const point of points) {
    if (maxDrawdown === null || point.drawdown < maxDrawdown) {
      maxDrawdown = point.drawdown;
      maxDrawdownMonth = point.month;
    }
  }

  return {
    hasData: points.length > 0,
    months,
    indices,
    drawdowns,
    points,
    maxDrawdown,
    maxDrawdownMonth,
  };
}

export function formatUnderwaterTooltip(
  params: UnderwaterTooltipParam | UnderwaterTooltipParam[],
): string {
  const item = Array.isArray(params) ? params[0] : params;
  if (!item) return "";
  const month = escapeHtml(item.axisValue ?? "");
  const value = percentValue(item.value);
  if (value === null) return `${month} · no data`;
  return `${month} · ${signedPct(value)}`;
}

export function buildUnderwaterOption(model: UnderwaterModel): Record<string, unknown> {
  const values = model.months.map((_, index) => {
    const drawdown = model.drawdowns[index];
    return finite(drawdown) ? round(drawdown * PERCENT) : null;
  });
  const axis = buildDrawdownAxis(values);

  const markPointData =
    finite(model.maxDrawdown) && model.maxDrawdownMonth
      ? [
          {
            name: "Max drawdown",
            coord: [model.maxDrawdownMonth, round(model.maxDrawdown * PERCENT)],
            value: round(model.maxDrawdown * PERCENT),
          },
        ]
      : [];

  return {
    ...baseOption(
      "Monthly drawdown from the running peak, in percent. The line sits below the zero " +
        "baseline; the marked point is the deepest drawdown. Monthly closes only; the risk " +
        "table uses daily closes.",
    ),
    grid: { left: 52, right: 20, top: 28, bottom: 34 },
    tooltip: tooltipStyle("axis", formatUnderwaterTooltip),
    xAxis: categoryAxis({ data: model.months }),
    yAxis: {
      ...valueAxis({
        min: axis.min,
        max: axis.max,
        formatter: (value: number) => `${(Math.abs(value) < 0.05 ? 0 : value).toFixed(1)}%`,
      }),
      interval: axis.interval,
    },
    series: [
      {
        name: "Drawdown",
        type: "line",
        data: values,
        connectNulls: false,
        showSymbol: false,
        lineStyle: { color: CHART_NEGATIVE, width: 1.8 },
        itemStyle: { color: CHART_NEGATIVE },
        areaStyle: { color: CHART_NEGATIVE, opacity: 0.18 },
        markLine: {
          silent: true,
          symbol: ["none", "none"],
          label: { show: false },
          lineStyle: { color: CHART_MUTED, type: "dashed", width: 1 },
          data: [{ yAxis: 0 }],
        },
        markPoint: {
          symbol: "circle",
          symbolSize: 8,
          itemStyle: { color: CHART_NEGATIVE, borderColor: CHART_NEUTRAL, borderWidth: 1 },
          label: { show: false },
          data: markPointData,
        },
        z: 2,
      },
    ],
  };
}

export function UnderwaterDrawdown(props: UnderwaterDrawdownProps) {
  const source = createMemo(
    () => props.series.find((item) => !item.is_benchmark && item.name === props.sector) ?? null,
  );
  const model = createMemo(() =>
    buildUnderwaterModel(props.months, source()?.monthly_returns ?? []),
  );
  const option = createMemo(() => buildUnderwaterOption(model()));
  const maxCaption = createMemo(() => {
    const current = model();
    if (!finite(current.maxDrawdown) || !current.maxDrawdownMonth) return "";
    return `Max drawdown ${signedPct(current.maxDrawdown * PERCENT)} · ${current.maxDrawdownMonth}`;
  });

  return (
    <div data-testid="history-underwater" class="flex min-w-0 flex-col gap-1">
      <Show when={props.showHeader !== false}>
        <div data-testid="history-underwater-header" class="flex flex-col gap-0.5">
          <span class="text-ui-micro font-semibold text-fin-text">
            {`Monthly drawdown · ${props.sector}`}
          </span>
          <span class="text-ui-micro text-fin-text-muted">
            monthly closes; risk table uses daily closes
          </span>
        </div>
      </Show>
      <Show
        when={model().hasData}
        fallback={
          <div
            data-testid="history-underwater-empty"
            class="py-3 text-center text-ui-micro text-fin-text-muted"
          >
            {source()
              ? `No drawdown history for ${props.sector}`
              : `No history for ${props.sector}`}
          </div>
        }
      >
        <EChart
          option={option()}
          data-testid="history-underwater-chart"
          style={{ height: `${CHART_HEIGHT}px`, width: "100%" }}
        />
        <span data-testid="history-underwater-caption" class="text-ui-micro text-fin-text-muted">
          {maxCaption()}
        </span>
      </Show>
    </div>
  );
}
