import { Show, createMemo } from "solid-js";
import { typeSize } from "@/ui/typography";
import type { SectorHistorySeries } from "../../../../types/sectorHistory";
import { buildIndexSeries, relativeStrengthSeries } from "../historyMath";
import { EChart } from "../../../common/EChart";
import { CHART_LINE, CHART_MUTED } from "./chartPalette";
import { baseOption, categoryAxis, niceAxis, tooltipStyle, valueAxis } from "./core/chartBase";
import { finite } from "./shared";

const CHART_HEIGHT = 240;
const START_INDEX = 100;
const LABEL_FONT = typeSize("micro");

export interface RelativeStrengthInput {
  months: string[];
  series: SectorHistorySeries[];
  sector: string;
}

export interface RelativeStrengthProps extends RelativeStrengthInput {
  /** Set false when the host panel already renders the title and method note. */
  showHeader?: boolean;
}

export interface RelativeStrengthPoint {
  month: string;
  sectorIndex: number;
  benchmarkIndex: number;
  /** Sector / benchmark, normalized to 100 at the first common month. */
  ratio: number;
}

export interface RelativeStrengthModel {
  hasData: boolean;
  hasSector: boolean;
  hasBenchmark: boolean;
  sectorName: string;
  benchmarkName: string;
  months: string[];
  /** Normalized ratio aligned to the months axis; null where either side is missing. */
  ratios: (number | null)[];
  points: RelativeStrengthPoint[];
  firstCommonIndex: number;
}

interface RelativeStrengthTooltipParam {
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

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function numericValue(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[value.length - 1] : value;
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildRelativeStrengthModel(input: RelativeStrengthInput): RelativeStrengthModel {
  const benchmark = input.series.find((item) => item.is_benchmark) ?? null;
  const sector =
    input.series.find((item) => !item.is_benchmark && item.name === input.sector) ?? null;
  const sectorIndex = sector ? buildIndexSeries(input.months, sector.monthly_returns) : [];
  const benchmarkIndex = benchmark ? buildIndexSeries(input.months, benchmark.monthly_returns) : [];
  const ratios = relativeStrengthSeries(
    input.months,
    sector?.monthly_returns ?? [],
    benchmark?.monthly_returns ?? [],
  );
  const firstCommonIndex = ratios.findIndex((value) => finite(value));

  const points: RelativeStrengthPoint[] = [];
  for (let index = 0; index < input.months.length; index++) {
    const sectorClose = sectorIndex[index];
    const benchmarkClose = benchmarkIndex[index];
    const ratio = ratios[index];
    if (!finite(sectorClose) || !finite(benchmarkClose) || !finite(ratio)) continue;
    points.push({
      month: input.months[index],
      sectorIndex: sectorClose,
      benchmarkIndex: benchmarkClose,
      ratio,
    });
  }

  return {
    hasData: points.length >= 2,
    hasSector: sector !== null,
    hasBenchmark: benchmark !== null,
    sectorName: sector?.name ?? input.sector,
    benchmarkName: benchmark?.name ?? "",
    months: input.months,
    ratios,
    points,
    firstCommonIndex,
  };
}

export function formatRelativeStrengthTooltip(
  params: RelativeStrengthTooltipParam | RelativeStrengthTooltipParam[],
): string {
  const item = Array.isArray(params) ? params[0] : params;
  if (!item) return "";
  const month = escapeHtml(item.axisValue ?? "");
  const value = numericValue(item.value);
  if (value === null) return `${month} · no data`;
  return `${month} · RS ${value.toFixed(1)}`;
}

export function buildRelativeStrengthOption(model: RelativeStrengthModel): Record<string, unknown> {
  const values = model.ratios.map((ratio) => (finite(ratio) ? round(ratio) : null));
  const observed = values.filter(finite);
  let low = START_INDEX;
  let high = START_INDEX;
  for (const value of observed) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  const padding = Math.max(1, (high - low) * 0.08);
  const axis = niceAxis(low - padding, high + padding, 6, 1);

  return {
    ...baseOption(
      `${model.sectorName} relative strength versus ${model.benchmarkName}, monthly, ` +
        "indexed to 100 at the first common month. Values above 100 mean the sector is " +
        "outperforming the benchmark; values below 100 mean it is lagging.",
    ),
    grid: { left: 52, right: 56, top: 26, bottom: 32 },
    tooltip: tooltipStyle("axis", formatRelativeStrengthTooltip),
    xAxis: categoryAxis({ data: model.months }),
    yAxis: valueAxis({
      min: axis.min,
      max: axis.max,
      interval: axis.interval,
      formatter: (value: number) => value.toFixed(0),
    }),
    series: [
      {
        name: `${model.sectorName} / ${model.benchmarkName}`,
        type: "line",
        data: values,
        connectNulls: false,
        showSymbol: false,
        lineStyle: { color: CHART_LINE, width: 1.8 },
        itemStyle: { color: CHART_LINE },
        endLabel: {
          show: true,
          color: CHART_LINE,
          fontSize: LABEL_FONT,
          formatter: (params: { value?: unknown }) => {
            const value = numericValue(params.value);
            return value === null ? "" : value.toFixed(1);
          },
        },
        markLine: {
          silent: true,
          symbol: ["none", "none"],
          lineStyle: { color: CHART_MUTED, type: "dashed", width: 1, opacity: 0.8 },
          label: {
            show: true,
            position: "insideEndTop",
            color: CHART_MUTED,
            fontSize: LABEL_FONT,
            formatter: "100",
          },
          data: [{ yAxis: START_INDEX, name: "benchmark" }],
        },
        z: 2,
      },
    ],
  };
}

export function RelativeStrength(props: RelativeStrengthProps) {
  const model = createMemo(() =>
    buildRelativeStrengthModel({
      months: props.months,
      series: props.series,
      sector: props.sector,
    }),
  );
  const option = createMemo(() => buildRelativeStrengthOption(model()));
  const benchmarkLabel = createMemo(() => model().benchmarkName || "benchmark");

  const emptyMessage = () => {
    if (!model().hasBenchmark) return "No benchmark series";
    if (!model().hasSector) return `No history for ${props.sector}`;
    return `Not enough overlapping months for ${props.sector}`;
  };

  return (
    <div data-testid="history-relative-strength" class="flex min-w-0 flex-col gap-1">
      <Show when={props.showHeader !== false}>
        <div data-testid="history-relative-strength-header" class="flex flex-col gap-0.5">
          <span class="text-ui-micro font-semibold text-fin-text">
            {`Relative strength vs ${benchmarkLabel()}`}
          </span>
          <span class="text-ui-micro text-fin-text-muted">monthly, indexed to 100</span>
        </div>
      </Show>
      <Show
        when={model().hasData}
        fallback={
          <div
            data-testid="history-relative-strength-empty"
            class="py-3 text-center text-ui-micro text-fin-text-muted"
          >
            {emptyMessage()}
          </div>
        }
      >
        <EChart
          option={option()}
          data-testid="history-relative-strength-chart"
          style={{ height: `${CHART_HEIGHT}px`, width: "100%" }}
        />
        <span data-testid="history-relative-strength-key" class="text-ui-micro text-fin-text-muted">
          above 100 = outperform · below 100 = lag
        </span>
      </Show>
    </div>
  );
}
