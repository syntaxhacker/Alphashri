import { For, Show, createMemo } from "solid-js";
import { alpha, TEXT } from "@/ui/palette";
import { typeSize } from "@/ui/typography";
import type { SectorHistorySeries } from "../../../../types/sectorHistory";
import { monthlyTransitionCount, rankAt } from "../historyMath";
import { EChart } from "../../../common/EChart";
import { CHART_TOP3, RANK_STOPS } from "./chartPalette";
import { baseOption, tooltipStyle } from "./core/chartBase";

const LABEL_FONT = typeSize("micro");

/** Fixed height requested by the panel layout; the Sankey itself is responsive. */
export const TRANSITION_CHART_HEIGHT = 340;

export const TRANSITION_ARIA_DESCRIPTION =
  "Rank transitions between consecutive months, aggregated across the selected lookback. " +
  "The left column groups the earlier month's rank band and the right column the following " +
  "month's. Link thickness is the number of monthly moves between those bands.";

export type RankBandId = "top" | "mid" | "bottom";

export const TRANSITION_BAND_FILLS: Record<RankBandId, string> = {
  top: CHART_TOP3,
  mid: RANK_STOPS[2],
  bottom: RANK_STOPS[3],
};

export interface RankTransitionSankeyProps {
  months: string[];
  series: SectorHistorySeries[];
  topN?: number;
  /** Lookback in years; labels the aggregate window when present. */
  years?: number;
  /** Host panels can suppress the internal title when they render their own header. */
  showHeader?: boolean;
}

export interface TransitionBand {
  id: RankBandId;
  label: string;
  fill: string;
  minRank: number;
  maxRank: number;
}
export interface TransitionSankeyNode {
  name: string;
  displayName: string;
  side: "now" | "next";
  band: RankBandId;
  itemStyle: { color: string };
  label: { color: string; position: "left" | "right" };
}

export interface TransitionSankeyLink {
  source: string;
  target: string;
  value: number;
  sourceBand: RankBandId;
  targetBand: RankBandId;
  sourceFill: string;
  lineStyle: { color: string; opacity: number };
}

export interface TransitionSankeyOption extends Record<string, unknown> {
  hasData: boolean;
  bands: TransitionBand[];
  nodes: TransitionSankeyNode[];
  links: TransitionSankeyLink[];
  transitions: number;
  bandLinkCount: number;
}

export interface TransitionSankeyInput {
  months: string[];
  series: SectorHistorySeries[];
  topN?: number;
}

export interface TransitionTooltipParam {
  dataType?: string;
  name?: string;
  data?: {
    source?: string;
    target?: string;
    value?: number | string;
    sourceBand?: RankBandId;
    targetBand?: RankBandId;
  };
  source?: string;
  target?: string;
  value?: number | string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function labelFromNode(name: string | undefined): string {
  if (!name) return "";
  return name.replace(/ · (now|next)$/, "");
}

function nodeName(band: TransitionBand, side: "now" | "next"): string {
  return `${band.label} · ${side}`;
}

function clampedTopN(topN: number | undefined): number {
  if (!Number.isFinite(topN) || !topN || topN <= 0) return 10;
  return Math.max(1, Math.floor(topN));
}

function bandForRank(rank: number, bands: TransitionBand[]): TransitionBand | null {
  return bands.find((band) => rank >= band.minRank && rank <= band.maxRank) ?? null;
}

/**
 * Three direct-labelled bands. `topN` caps the universe (default 10) and the
 * labels clamp when a market has fewer sectors than the nominal 3/4–6/7–10
 * boundaries.
 */
export function transitionBands(
  topN: number | undefined,
  sectorCount: number,
  observedMax: number,
): TransitionBand[] {
  const cap = Math.max(1, Math.min(10, clampedTopN(topN), Math.max(sectorCount, observedMax)));
  const topMax = Math.min(3, cap);
  const bands: TransitionBand[] = [
    {
      id: "top",
      label: topMax === 3 ? "Top 3" : topMax === 1 ? "Top 1" : `Top 1–${topMax}`,
      fill: TRANSITION_BAND_FILLS.top,
      minRank: 1,
      maxRank: topMax,
    },
  ];

  if (cap >= 4) {
    const midMax = Math.min(6, cap);
    bands.push({
      id: "mid",
      label: midMax === 4 ? "Mid 4" : `Mid 4–${midMax}`,
      fill: TRANSITION_BAND_FILLS.mid,
      minRank: 4,
      maxRank: midMax,
    });
  }

  if (cap >= 7) {
    const bottomMax = Math.min(10, cap);
    bands.push({
      id: "bottom",
      label: bottomMax === 7 ? "Bottom 7" : `Bottom 7–${bottomMax}`,
      fill: TRANSITION_BAND_FILLS.bottom,
      minRank: 7,
      maxRank: bottomMax,
    });
  }

  return bands;
}

/** Edge tooltip: `Top 3 → Mid 4–6 · 7 moves`. */
export function formatTransitionTooltip(
  params: TransitionTooltipParam | TransitionTooltipParam[],
): string {
  const list = Array.isArray(params) ? params : [params];
  const item = list.find((entry) => entry.data?.source || entry.source) ?? list[0];
  if (!item) return "";
  const payload = item.data ?? item;
  const source = payload.source;
  const target = payload.target;
  if (!source || !target) {
    return item.name ? escapeHtml(labelFromNode(item.name)) : "";
  }
  const value = Number(payload.value);
  const moves = Number.isFinite(value) ? Math.round(value) : 0;
  return `${escapeHtml(labelFromNode(source))} → ${escapeHtml(
    labelFromNode(target),
  )} · ${moves} moves`;
}

/**
 * Pure builder for tests and the EChart wrapper. The returned object is a valid
 * ECharts option plus the model fields (`nodes`, `links`, `transitions`) so the
 * transition counts can be asserted without reading canvas state.
 */
export function buildTransitionSankey(input: TransitionSankeyInput): TransitionSankeyOption {
  const sectors = input.series.filter((item) => !item.is_benchmark);
  const months = input.months;
  let observedMax = 0;
  for (const sector of sectors) {
    for (const rank of sector.ranks) {
      if (typeof rank === "number" && Number.isFinite(rank) && rank > observedMax) {
        observedMax = rank;
      }
    }
  }

  const bands = transitionBands(input.topN, sectors.length, observedMax);
  const nodes: TransitionSankeyNode[] = bands.flatMap((band) => [
    {
      name: nodeName(band, "now"),
      displayName: band.label,
      side: "now" as const,
      band: band.id,
      itemStyle: { color: band.fill },
      label: { color: TEXT, position: "left" as const },
    },
    {
      name: nodeName(band, "next"),
      displayName: band.label,
      side: "next" as const,
      band: band.id,
      itemStyle: { color: band.fill },
      label: { color: TEXT, position: "right" as const },
    },
  ]);

  const counts = new Map<string, number>();
  for (let month = 0; month < months.length - 1; month++) {
    for (const sector of sectors) {
      const fromRank = rankAt(sector, month);
      const toRank = rankAt(sector, month + 1);
      if (fromRank === null || toRank === null) continue;
      const fromBand = bandForRank(fromRank, bands);
      const toBand = bandForRank(toRank, bands);
      if (!fromBand || !toBand) continue;
      const key = `${fromBand.id}->${toBand.id}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const transitions = monthlyTransitionCount(sectors);

  const links: TransitionSankeyLink[] = [];
  for (const fromBand of bands) {
    for (const toBand of bands) {
      const value = counts.get(`${fromBand.id}->${toBand.id}`) ?? 0;
      if (value === 0) continue;
      links.push({
        source: nodeName(fromBand, "now"),
        target: nodeName(toBand, "next"),
        value,
        sourceBand: fromBand.id,
        targetBand: toBand.id,
        sourceFill: fromBand.fill,
        lineStyle: { color: alpha(fromBand.fill, 0.32), opacity: 0.9 },
      });
    }
  }

  const option = {
    ...baseOption(TRANSITION_ARIA_DESCRIPTION),
    tooltip: tooltipStyle<TransitionTooltipParam | TransitionTooltipParam[]>("item", (params) =>
      formatTransitionTooltip(params),
    ),
    series: [
      {
        type: "sankey",
        left: 88,
        right: 88,
        top: 12,
        bottom: 12,
        nodeWidth: 12,
        nodeGap: 10,
        draggable: false,
        emphasis: { focus: "adjacency" },
        label: {
          show: true,
          color: TEXT,
          fontSize: LABEL_FONT,
          formatter: (params: { name?: string }) => labelFromNode(params?.name),
        },
        labelLayout: { hideOverlap: true },
        lineStyle: {
          color: "source",
          opacity: 0.32,
          curveness: 0.5,
        },
        itemStyle: { borderWidth: 0, borderRadius: 2 },
        data: nodes,
        links,
      },
    ],
  } as unknown as TransitionSankeyOption;

  return Object.assign(option, {
    hasData: links.length > 0,
    bands,
    nodes,
    links,
    transitions,
    bandLinkCount: links.length,
  });
}

/**
 * Month-to-month band moves, with direct labels rather than a colour legend.
 * The Sankey encodes where sectors came from and where they went.
 */
export function RankTransitionSankey(props: RankTransitionSankeyProps) {
  const option = createMemo(() =>
    buildTransitionSankey({
      months: props.months,
      series: props.series,
      topN: props.topN,
    }),
  );
  const windowLabel = () =>
    typeof props.years === "number" && Number.isFinite(props.years) ? `${props.years}Y` : "";
  const title = () =>
    windowLabel()
      ? `Rank transitions · ${windowLabel()} band flows`
      : "Rank transitions · band flows across the lookback";
  const toBandLabel = () =>
    windowLabel() ? `To band · ${windowLabel()} aggregate` : "To band · aggregate";

  return (
    <div class="flex min-w-0 flex-col gap-1">
      <div class="flex flex-col gap-0.5">
        <Show when={props.showHeader !== false}>
          <span
            data-testid="history-rank-transition-title"
            class="text-ui-micro font-semibold text-fin-text"
          >
            {title()}
          </span>
        </Show>
        <span class="text-ui-micro text-fin-text-muted">counts of monthly band moves</span>
        <Show when={option().hasData}>
          <div
            data-testid="history-rank-transition-key"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-micro text-fin-text-muted"
          >
            <For each={option().bands}>
              {(band) => (
                <span class="inline-flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    class="inline-block h-2 w-2 rounded-sm"
                    style={{ "background-color": band.fill }}
                  />
                  <span>{band.label}</span>
                </span>
              )}
            </For>
          </div>
        </Show>
        <Show when={option().hasData}>
          <div
            data-testid="history-rank-transition-columns"
            class="flex items-center justify-between text-ui-micro text-fin-text-muted"
          >
            <span>From band</span>
            <span>{toBandLabel()}</span>
          </div>
        </Show>
      </div>
      <Show
        when={option().hasData}
        fallback={
          <div
            data-testid="history-rank-transition"
            class="py-3 text-center text-ui-micro text-fin-text-muted"
          >
            <div data-testid="history-rank-transition-empty">No rank transitions to show</div>
          </div>
        }
      >
        <div
          data-testid="history-rank-transition"
          class="min-w-0"
          aria-label={TRANSITION_ARIA_DESCRIPTION}
        >
          <EChart
            option={option()}
            data-testid="history-rank-transition-sankey"
            style={{
              height: `${TRANSITION_CHART_HEIGHT}px`,
              flex: "none",
              width: "100%",
              "min-height": "0px",
            }}
          />
        </div>
      </Show>
    </div>
  );
}
