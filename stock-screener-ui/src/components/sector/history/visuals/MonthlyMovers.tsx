import { For, Show, createMemo, createUniqueId } from "solid-js";
import { BORDER, MONO, SURFACE, TEXT, TEXT_MUTED } from "@/ui/palette";
import { useMediaQuery } from "@/ui/hooks";
import type { SectorHistorySeries } from "../../../../types/sectorHistory";
import { rankAt } from "../historyMath";
import { CHART_CURRENT, CHART_MUTED, CHART_TOP3 } from "./chartPalette";
import { useScrollHint } from "./matrices/useScrollHint";
import { SVG_TEXT } from "./shared";

/** Row rhythm and fixed geometry shared by the component and its tests. */
export const MOVERS_ROW_HEIGHT = 26;
export const MOVERS_HEADER_HEIGHT = 40;
export const MOVERS_VIEW_WIDTH = 520;
export const MOVERS_MIN_WIDTH = 520;

const LABEL_PAD = 8;
const RIGHT_COLUMN = 44;
const LABEL_MIN_WIDTH = 140;
const LABEL_MAX_WIDTH = 240;
const LABEL_CHAR_WIDTH = 7.2;
const LABEL_RANK_GUTTER = 48;
const PREVIOUS_DOT_RADIUS = 3;
const CURRENT_DOT_RADIUS = 4;

export interface MonthlyMoversProps {
  months: string[];
  series: SectorHistorySeries[];
  /** Host panels can suppress the internal title when they render their own header. */
  showHeader?: boolean;
}

export interface MonthlyMoverRow {
  name: string;
  previousRank: number | null;
  currentRank: number;
  /** Positive means the sector moved up (previous rank − current rank). */
  delta: number | null;
  /** Absolute size of the move; 0 when there is no previous rank. */
  magnitude: number;
  top3: boolean;
}

export interface MonthlyMoversModel {
  hasData: boolean;
  previousMonth: string | null;
  currentMonth: string | null;
  previousIndex: number | null;
  currentIndex: number | null;
  rows: MonthlyMoverRow[];
  rankMax: number;
}

export interface MonthlyMoversInput {
  months: string[];
  series: SectorHistorySeries[];
}

/**
 * Pick the last two months that actually contain ranks, then order sectors by
 * the size of their rank move. A sector without a previous rank is still shown
 * (current dot only) but sorts after every measured move.
 */
export function buildMonthlyMovers(input: MonthlyMoversInput): MonthlyMoversModel {
  const sectors = input.series.filter((item) => !item.is_benchmark);
  const rankedMonths: number[] = [];
  for (let index = 0; index < input.months.length; index++) {
    if (sectors.some((sector) => rankAt(sector, index) !== null)) {
      rankedMonths.push(index);
    }
  }

  const currentIndex = rankedMonths.length > 0 ? rankedMonths[rankedMonths.length - 1] : null;
  const previousIndex = rankedMonths.length > 1 ? rankedMonths[rankedMonths.length - 2] : null;

  if (currentIndex === null) {
    return {
      hasData: false,
      previousMonth: null,
      currentMonth: null,
      previousIndex: null,
      currentIndex: null,
      rows: [],
      rankMax: Math.max(1, sectors.length),
    };
  }

  const rows: MonthlyMoverRow[] = [];
  for (const sector of sectors) {
    const currentRank = rankAt(sector, currentIndex);
    if (currentRank === null) continue;
    const previousRank = previousIndex === null ? null : rankAt(sector, previousIndex);
    const delta = previousRank === null ? null : previousRank - currentRank;
    rows.push({
      name: sector.name,
      previousRank,
      currentRank,
      delta,
      magnitude: delta === null ? 0 : Math.abs(delta),
      top3: currentRank <= 3,
    });
  }

  rows.sort((a, b) => {
    const aMagnitude = a.delta === null ? -1 : a.magnitude;
    const bMagnitude = b.delta === null ? -1 : b.magnitude;
    if (aMagnitude !== bMagnitude) return bMagnitude - aMagnitude;
    if (a.currentRank !== b.currentRank) return a.currentRank - b.currentRank;
    return a.name.localeCompare(b.name);
  });

  const observedMax = rows.reduce(
    (max, row) => Math.max(max, row.currentRank, row.previousRank ?? row.currentRank),
    1,
  );

  return {
    hasData: rows.length > 0,
    previousMonth: previousIndex === null ? null : (input.months[previousIndex] ?? null),
    currentMonth: input.months[currentIndex] ?? null,
    previousIndex,
    currentIndex,
    rows,
    rankMax: Math.max(1, sectors.length, observedMax),
  };
}

/**
 * Native SVG dumbbell. Identity comes from the left-hand sector label; the
 * muted dot is the previous rank, the arrow lands on the current rank, and the
 * right column repeats that rank as a number.
 */
export function MonthlyMovers(props: MonthlyMoversProps) {
  const model = createMemo(() =>
    buildMonthlyMovers({ months: props.months, series: props.series }),
  );
  const hint = useScrollHint();
  const compact = useMediaQuery("(max-width: 640px)", undefined, { noSsr: true });
  const titleId = `history-movers-title-${createUniqueId()}`;
  const descId = `history-movers-desc-${createUniqueId()}`;
  const uid = createUniqueId();

  const labelWidth = createMemo(() => {
    const longest = model().rows.reduce((max, row) => Math.max(max, row.name.length), 0);
    return Math.max(
      LABEL_MIN_WIDTH,
      Math.min(LABEL_MAX_WIDTH, Math.ceil(longest * LABEL_CHAR_WIDTH) + LABEL_RANK_GUTTER),
    );
  });

  const chartHeight = () => MOVERS_HEADER_HEIGHT + model().rows.length * MOVERS_ROW_HEIGHT;

  const plotLeft = () => labelWidth();
  const plotRight = () => MOVERS_VIEW_WIDTH - RIGHT_COLUMN;

  /** Rank 1 is strongest, so an inverted axis puts it on the right. */
  const rankX = (rank: number) => {
    const max = Math.max(1, model().rankMax);
    if (max === 1) return plotRight();
    const t = (Math.min(max, Math.max(1, rank)) - 1) / (max - 1);
    return plotRight() - t * (plotRight() - plotLeft());
  };

  const rankTicks = () => Array.from({ length: model().rankMax }, (_, index) => index + 1);

  /** Stop the connector short of the current dot so its arrowhead stays visible. */
  const connectorEndX = (previousX: number, currentX: number) =>
    currentX + (previousX < currentX ? -7 : 7);

  return (
    <div data-testid="history-monthly-movers" class="flex min-w-0 flex-col gap-1">
      <div class="flex flex-col gap-0.5">
        <Show when={props.showHeader !== false}>
          <span
            data-testid="history-monthly-movers-title"
            class="text-ui-micro font-semibold text-fin-text"
          >
            Rank change over the latest month · arrows point to current rank
          </span>
        </Show>
        <Show when={model().hasData}>
          <div class="flex flex-wrap items-baseline gap-x-1 text-ui-micro text-fin-text-muted">
            <span data-testid="history-monthly-movers-months">
              {model().previousMonth
                ? `${model().previousMonth} → ${model().currentMonth}`
                : `No prior ranked month · ${model().currentMonth}`}
            </span>
            <span data-testid="history-monthly-movers-note">
              · sorted by size of move · muted = previous · amber = top 3 · cyan = current
            </span>
          </div>
        </Show>
      </div>

      <Show
        when={model().hasData}
        fallback={
          <div class="py-3 text-center text-ui-micro text-fin-text-muted">
            <div data-testid="history-monthly-movers-empty">No rank change to show</div>
          </div>
        }
      >
        <div
          aria-hidden="true"
          data-testid="history-monthly-movers-scroll-hint"
          class={`mb-0.5 items-center justify-end ${hint.overflowing() ? "flex" : "hidden"}`}
        >
          <span class="text-ui-micro text-fin-text-muted">
            {hint.atEnd() ? "Scroll ←" : "Scroll →"}
          </span>
        </div>
        <div
          ref={hint.setRef}
          data-testid="history-monthly-movers-scroll"
          role="region"
          tabIndex={0}
          aria-label="Monthly movers chart. Scroll sideways to compare ranks."
          class="min-w-0 overflow-x-auto focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-primary"
        >
          <svg
            data-testid="history-monthly-movers-chart"
            width="100%"
            height={chartHeight()}
            viewBox={`0 0 ${MOVERS_VIEW_WIDTH} ${chartHeight()}`}
            preserveAspectRatio="xMinYMin meet"
            role="img"
            aria-labelledby={`${titleId} ${descId}`}
            font-family={MONO}
            style={{
              display: "block",
              width: "100%",
              "min-width": `${MOVERS_MIN_WIDTH}px`,
              "max-width": `${MOVERS_VIEW_WIDTH}px`,
              height: "auto",
            }}
          >
            <title id={titleId}>
              {`Rank change over the latest month, ${
                model().currentMonth ?? "latest"
              }: ${model().rows.length} sectors. Arrows point to the current rank.`}
            </title>
            <desc id={descId}>
              Rows are sectors. The rank axis runs from rank 1 at the right (strongest) to rank{" "}
              {model().rankMax} at the left. A muted dot is the previous month's rank; a cyan dot
              and arrow mark the current rank. The current rank is repeated at the left label rail
              and at the right. Amber highlights top-3 rank badges. Sectors without a previous rank
              show only the current dot.
            </desc>
            <rect width={MOVERS_VIEW_WIDTH} height={chartHeight()} fill={SURFACE} />

            <defs>
              <marker
                id={`mover-arrow-${uid}`}
                viewBox="0 0 6 6"
                refX={5}
                refY={3}
                markerWidth={4}
                markerHeight={4}
                orient="auto"
              >
                <path d="M0,0 L6,3 L0,6 Z" fill={CHART_CURRENT} />
              </marker>
              <For each={model().rows}>
                {(row, index) => (
                  <Show when={row.previousRank !== null && row.previousRank !== row.currentRank}>
                    <linearGradient
                      id={`mover-line-${uid}-${index()}`}
                      gradientUnits="userSpaceOnUse"
                      x1={rankX(row.previousRank ?? row.currentRank)}
                      x2={connectorEndX(
                        rankX(row.previousRank ?? row.currentRank),
                        rankX(row.currentRank),
                      )}
                      y1={0}
                      y2={0}
                    >
                      <stop offset="0" stop-color={CHART_MUTED} />
                      <stop offset="1" stop-color={CHART_CURRENT} />
                    </linearGradient>
                  </Show>
                )}
              </For>
            </defs>

            <text x={LABEL_PAD} y={16} font-size={SVG_TEXT} font-weight={700} fill={TEXT_MUTED}>
              sector
            </text>
            <For each={rankTicks()}>
              {(rank) => (
                <text
                  data-rank-axis={rank}
                  x={rankX(rank)}
                  y={16}
                  font-size={SVG_TEXT}
                  fill={TEXT_MUTED}
                  text-anchor="middle"
                >
                  {`#${rank}`}
                </text>
              )}
            </For>
            <text
              x={MOVERS_VIEW_WIDTH - LABEL_PAD}
              y={32}
              font-size={SVG_TEXT}
              font-weight={700}
              fill={TEXT_MUTED}
              text-anchor="end"
            >
              current
            </text>
            <text
              data-testid="history-monthly-movers-rank-caption"
              x={(plotLeft() + plotRight()) / 2}
              y={32}
              font-size={SVG_TEXT}
              fill={TEXT_MUTED}
              text-anchor="middle"
            >
              {compact() ? "rank →" : "rank · better →"}
            </text>

            <For each={rankTicks()}>
              {(rank) => (
                <line
                  x1={rankX(rank)}
                  x2={rankX(rank)}
                  y1={MOVERS_HEADER_HEIGHT - 3}
                  y2={chartHeight() - 2}
                  stroke={BORDER}
                  stroke-opacity={0.4}
                  stroke-dasharray="2 3"
                  shape-rendering="crispEdges"
                />
              )}
            </For>

            <For each={model().rows}>
              {(row, index) => {
                const rowY = MOVERS_HEADER_HEIGHT + index() * MOVERS_ROW_HEIGHT;
                const centerY = rowY + MOVERS_ROW_HEIGHT / 2;
                const currentX = rankX(row.currentRank);
                const previousX = row.previousRank === null ? null : rankX(row.previousRank);
                return (
                  <g
                    data-testid={`history-mover-row-${index()}`}
                    data-sector={row.name}
                    data-prev-rank={row.previousRank ?? undefined}
                    data-current-rank={row.currentRank}
                    data-delta={row.delta ?? undefined}
                    data-move={row.delta === null ? undefined : row.magnitude}
                    data-top3={row.top3 ? "true" : "false"}
                  >
                    <title>
                      {row.previousRank === null
                        ? `${row.name}: no previous rank · current #${row.currentRank}`
                        : `${row.name}: #${row.previousRank} → #${row.currentRank}`}
                    </title>
                    <text
                      data-testid={`history-mover-left-rank-${index()}`}
                      data-left-rank={row.currentRank}
                      x={LABEL_PAD}
                      y={centerY}
                      font-size={SVG_TEXT}
                      font-weight={row.top3 ? 700 : 500}
                      fill={row.top3 ? CHART_TOP3 : CHART_MUTED}
                      text-anchor="start"
                      dominant-baseline="central"
                    >
                      {`#${row.currentRank}`}
                    </text>
                    <text
                      x={plotLeft() - LABEL_PAD}
                      y={centerY}
                      font-size={SVG_TEXT}
                      fill={row.top3 ? TEXT : TEXT_MUTED}
                      text-anchor="end"
                      dominant-baseline="central"
                    >
                      <title>{row.name}</title>
                      {row.name}
                    </text>

                    <Show when={row.previousRank !== null && row.previousRank !== row.currentRank}>
                      <line
                        data-connector={`${index()}`}
                        x1={previousX ?? currentX}
                        x2={connectorEndX(previousX ?? currentX, currentX)}
                        y1={centerY}
                        y2={centerY}
                        stroke={`url(#mover-line-${uid}-${index()})`}
                        stroke-width={1.8}
                        marker-end={`url(#mover-arrow-${uid})`}
                      />
                    </Show>

                    <Show when={previousX !== null}>
                      <circle
                        data-previous-dot={`${index()}`}
                        cx={previousX ?? 0}
                        cy={centerY}
                        r={PREVIOUS_DOT_RADIUS}
                        fill={CHART_MUTED}
                        stroke={SURFACE}
                        stroke-width={1}
                      />
                    </Show>

                    <circle
                      data-current-dot={`${index()}`}
                      cx={currentX}
                      cy={centerY}
                      r={CURRENT_DOT_RADIUS}
                      fill={CHART_CURRENT}
                      stroke={SURFACE}
                      stroke-width={1.5}
                    />

                    <text
                      data-testid={`history-mover-rank-${index()}`}
                      x={MOVERS_VIEW_WIDTH - LABEL_PAD}
                      y={centerY}
                      font-size={SVG_TEXT}
                      font-weight={row.top3 ? 700 : 500}
                      fill={row.top3 ? CHART_TOP3 : TEXT}
                      text-anchor="end"
                      dominant-baseline="central"
                    >
                      {`#${row.currentRank}`}
                    </text>
                  </g>
                );
              }}
            </For>
          </svg>
        </div>
      </Show>
    </div>
  );
}
