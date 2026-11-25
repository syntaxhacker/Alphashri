import { For, Show, createMemo } from "solid-js";
import type { SectorHistorySeasonality } from "../../../../types/sectorHistory";
import { seasonalityByMonth, seasonalitySampleLabel } from "../historyMath";
import { EChart } from "../../../common/EChart";
import { CHART_NEGATIVE, CHART_NEUTRAL, CHART_POSITIVE } from "./chartPalette";
import { baseOption, categoryAxis, tooltipStyle, valueAxis } from "./core/chartBase";
import { MONTH_NAMES, signedPct } from "./shared";

const CHART_HEIGHT = 300;

export interface SeasonalityRadialProps {
  cells: SectorHistorySeasonality[];
  sector: string;
  /** Set false when the host panel already renders the title. */
  showHeader?: boolean;
}

export interface SeasonalityRadialEntry {
  month: number;
  label: string;
  avg: number | null;
  hitPct: number | null;
  n: number;
  color: string;
}

export interface SeasonalityRadialModel {
  hasData: boolean;
  sectorName: string;
  entries: SeasonalityRadialEntry[];
  sampleLabel: string;
}

interface SeasonalityTooltipParam {
  dataIndex?: number;
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

function toneFor(avg: number | null): string {
  if (avg === null || avg === 0) return CHART_NEUTRAL;
  return avg > 0 ? CHART_POSITIVE : CHART_NEGATIVE;
}

export function buildSeasonalityRadialModel(
  cells: SectorHistorySeasonality[],
  sector: string,
): SeasonalityRadialModel {
  const entries: SeasonalityRadialEntry[] = seasonalityByMonth(cells, sector).map((row) => ({
    month: row.month,
    label: row.label,
    avg: row.avg,
    hitPct: row.hitRate,
    n: row.n,
    color: toneFor(row.avg),
  }));

  return {
    hasData:
      cells.some((cell) => cell.name === sector) && entries.some((entry) => entry.avg !== null),
    sectorName: sector,
    entries,
    sampleLabel: seasonalitySampleLabel(cells, sector, "n unavailable"),
  };
}

export function formatSeasonalityRadialTooltip(entry: SeasonalityRadialEntry): string {
  const avg = entry.avg === null ? "no data" : `avg ${signedPct(entry.avg)}`;
  const hit = entry.hitPct === null ? "n/a" : `${Math.round(entry.hitPct)}%`;
  return `${escapeHtml(entry.label)} · ${avg} · hit rate ${hit} · n=${entry.n}`;
}

export function buildSeasonalityRadialOption(
  cells: SectorHistorySeasonality[],
  sector: string,
): Record<string, unknown> {
  const model = buildSeasonalityRadialModel(cells, sector);
  const angleAxis = categoryAxis({ data: [...MONTH_NAMES] });

  return {
    ...baseOption(
      `Average return by calendar month for ${sector}, drawn as a polar bar chart. ` +
        "Orange bars are positive months and blue bars are negative months. Hover a month for " +
        "the average return, up-month hit rate and sample size. Every monthly value is also " +
        "listed in the text strip below the chart, so no hover is required. History, not a forecast.",
    ),
    polar: {
      center: ["50%", "50%"],
      radius: ["16%", "68%"],
    },
    angleAxis: {
      ...angleAxis,
      boundaryGap: true,
      startAngle: 90,
      clockwise: true,
      axisLine: { lineStyle: { color: CHART_NEUTRAL, opacity: 0.35 } },
      axisLabel: {
        ...(angleAxis.axisLabel as Record<string, unknown>),
        hideOverlap: false,
        interval: 0,
        margin: 8,
      },
    },
    radiusAxis: {
      ...valueAxis(),
      axisLabel: { show: false },
    },
    tooltip: tooltipStyle<SeasonalityTooltipParam | SeasonalityTooltipParam[]>("item", (params) => {
      const item = Array.isArray(params) ? params[0] : params;
      const index = typeof item?.dataIndex === "number" ? item.dataIndex : -1;
      const entry = model.entries[index];
      return entry ? formatSeasonalityRadialTooltip(entry) : "";
    }),
    series: [
      {
        name: `Average return · ${sector}`,
        type: "bar",
        coordinateSystem: "polar",
        barWidth: "55%",
        data: model.entries.map((entry) => ({
          value: entry.avg === null ? null : round(entry.avg),
          itemStyle: { color: entry.color },
        })),
        itemStyle: { borderRadius: 2 },
        emphasis: { focus: "self" },
        z: 2,
      },
    ],
  };
}

export function SeasonalityRadial(props: SeasonalityRadialProps) {
  const model = createMemo(() => buildSeasonalityRadialModel(props.cells, props.sector));
  const option = createMemo(() => buildSeasonalityRadialOption(props.cells, props.sector));

  return (
    <div data-testid="history-seasonality-radial" class="flex min-w-0 flex-col gap-1">
      <Show when={props.showHeader !== false}>
        <div data-testid="history-seasonality-radial-header">
          <span class="text-ui-micro font-semibold text-fin-text">
            {`Seasonality · ${props.sector}`}
          </span>
        </div>
      </Show>
      <div
        data-testid="history-seasonality-radial-key"
        class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ui-micro text-fin-text-muted"
      >
        <span
          aria-hidden="true"
          class="inline-block h-2 w-2 rounded-sm"
          style={{ "background-color": CHART_POSITIVE }}
        />
        <span>orange positive</span>
        <span aria-hidden="true">{" · "}</span>
        <span
          aria-hidden="true"
          class="inline-block h-2 w-2 rounded-sm"
          style={{ "background-color": CHART_NEGATIVE }}
        />
        <span>blue negative</span>
      </div>
      <Show
        when={model().hasData}
        fallback={
          <div
            data-testid="history-seasonality-radial-empty"
            class="py-3 text-center text-ui-micro text-fin-text-muted"
          >
            {`No seasonality history for ${props.sector}`}
          </div>
        }
      >
        <div data-testid="history-seasonality-radial-body" class="flex min-w-0 flex-col gap-1">
          <EChart
            option={option()}
            data-testid="history-seasonality-radial-chart"
            style={{ height: `${CHART_HEIGHT}px`, width: "100%" }}
          />
          <div
            data-testid="history-seasonality-radial-values"
            role="list"
            aria-label={`Monthly average returns for ${props.sector}`}
            class="order-first grid min-w-0 grid-cols-4 gap-x-2 gap-y-0.5 sm:order-none lg:grid-cols-6"
          >
            <For each={model().entries}>
              {(entry) => (
                <div
                  data-testid={`history-seasonality-radial-value-${entry.month}`}
                  role="listitem"
                  aria-label={`${entry.label} ${
                    entry.avg === null ? "no data" : signedPct(entry.avg)
                  }`}
                  class="flex min-w-0 items-baseline justify-between gap-1 border-t border-fin-border px-0.5 py-0.5"
                >
                  <span class="inline-flex min-w-0 items-center gap-1 text-ui-micro text-fin-text-muted">
                    <span
                      aria-hidden="true"
                      class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ "background-color": entry.color }}
                    />
                    {entry.label}
                  </span>
                  <span class="whitespace-nowrap font-mono text-ui-micro text-fin-text tabular-nums">
                    {entry.avg === null ? "—" : signedPct(entry.avg)}
                  </span>
                </div>
              )}
            </For>
          </div>
          <span
            data-testid="history-seasonality-radial-note"
            class="text-ui-micro text-fin-text-muted"
          >
            {`avg return by month · hit rate in tooltip · ${model().sampleLabel} · history, not a forecast`}
          </span>
        </div>
      </Show>
    </div>
  );
}
