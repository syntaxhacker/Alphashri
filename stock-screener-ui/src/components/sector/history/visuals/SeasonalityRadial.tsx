import { Show, createMemo } from "solid-js";
import { typeSize } from "@/ui/typography";
import type { SectorHistorySeasonality } from "../../../../types/sectorHistory";
import { EChart } from "../../../common/EChart";
import { CHART_MUTED, CHART_NEGATIVE, CHART_NEUTRAL, CHART_POSITIVE } from "./chartPalette";
import { MONTH_NAMES, finite, hitRatePercent, signedPct } from "./shared";

const LABEL_FONT = typeSize("micro");
const CHART_HEIGHT = 300;
const MONTHS_PER_YEAR = 12;

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

function buildSampleLabel(entries: SeasonalityRadialEntry[]): string {
  const counts = entries
    .map((entry) => entry.n)
    .filter((value) => finite(value) && value > 0)
    .map((value) => Math.round(value));
  if (counts.length === 0) return "n unavailable";
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return min === max ? `n=${min} per month` : `n=${min}–${max} per month`;
}

export function buildSeasonalityRadialModel(
  cells: SectorHistorySeasonality[],
  sector: string,
): SeasonalityRadialModel {
  // The API may send months as 0- or 1-based; the full-year range disambiguates them.
  const zeroBased =
    cells.some((cell) => cell.month === 0) && !cells.some((cell) => cell.month === 12);
  const rows = cells.filter((cell) => cell.name === sector);
  const byMonth = new Map<number, SectorHistorySeasonality>();
  for (const row of rows) {
    const index = zeroBased ? row.month : row.month - 1;
    if (index >= 0 && index < MONTHS_PER_YEAR) byMonth.set(index, row);
  }

  const entries = MONTH_NAMES.map((label, month) => {
    const row = byMonth.get(month);
    const avg = row && finite(row.avg_return) ? row.avg_return : null;
    const hitRate = row?.hit_rate ?? null;
    const hitPct = finite(hitRate) ? hitRatePercent(hitRate) : null;
    const n = row && finite(row.n) && row.n > 0 ? Math.round(row.n) : 0;
    return {
      month,
      label,
      avg,
      hitPct: hitPct === null ? null : Math.max(0, Math.min(100, hitPct)),
      n,
      color: toneFor(avg),
    };
  });

  return {
    hasData: rows.length > 0 && entries.some((entry) => entry.avg !== null),
    sectorName: sector,
    entries,
    sampleLabel: buildSampleLabel(entries),
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

  return {
    animation: false,
    backgroundColor: "transparent",
    aria: {
      enabled: true,
      label: {
        description:
          `Average return by calendar month for ${sector}, drawn as a polar bar chart. ` +
          "Orange bars are positive months and blue bars are negative months. Hover a month for " +
          "the average return, up-month hit rate and sample size. History, not a forecast.",
      },
    },
    polar: {
      center: ["50%", "50%"],
      radius: ["16%", "68%"],
    },
    angleAxis: {
      type: "category",
      data: MONTH_NAMES,
      startAngle: 90,
      clockwise: true,
      axisLine: { lineStyle: { color: CHART_NEUTRAL, opacity: 0.35 } },
      axisTick: { show: false },
      axisLabel: {
        color: CHART_MUTED,
        fontSize: LABEL_FONT,
        interval: 0,
        margin: 8,
      },
      splitLine: { show: false },
    },
    radiusAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { lineStyle: { color: CHART_NEUTRAL, opacity: 0.16 } },
    },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (params: SeasonalityTooltipParam | SeasonalityTooltipParam[]) => {
        const item = Array.isArray(params) ? params[0] : params;
        const index = typeof item?.dataIndex === "number" ? item.dataIndex : -1;
        const entry = model.entries[index];
        return entry ? formatSeasonalityRadialTooltip(entry) : "";
      },
    },
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
        <EChart
          option={option()}
          data-testid="history-seasonality-radial-chart"
          style={{ height: `${CHART_HEIGHT}px`, width: "100%" }}
        />
        <span
          data-testid="history-seasonality-radial-note"
          class="text-ui-micro text-fin-text-muted"
        >
          {`avg return by month · hit rate in tooltip · ${model().sampleLabel} · history, not a forecast`}
        </span>
      </Show>
    </div>
  );
}
