import { For, Show, createMemo, createUniqueId } from "solid-js";
import { alpha, BORDER, SURFACE, TEXT_MUTED } from "@/ui/palette";
import { pickTextColor } from "@/utils/contrast";
import { seasonalityByMonth } from "../historyMath";
import type { SectorHistorySeasonality } from "../../../../types/sectorHistory";
import {
  CHART_MUTED,
  CHART_NEGATIVE,
  CHART_NEUTRAL,
  CHART_POSITIVE,
  returnColor,
} from "./chartPalette";
import { labelWidthFor } from "./matrices/labelWidth";
import { MatrixFrame } from "./matrices/MatrixFrame";
import { useRovingGrid } from "./matrices/useRovingGrid";
import { useScrollHint } from "./matrices/useScrollHint";
import { SVG_TEXT, monthName, signedPct } from "./shared";

const CELL_W = 42;
const CELL_H = 26;
const HEADER_H = 26;
const EMPTY_W = 360;
const EMPTY_H = 96;
const HIT_BAR_INSET = 4;
const HIT_BAR_H = 4;
const HIT_BAR_TRACK_OPACITY = 0.3;
const HIT_BAR_OPACITY = 1;
const MONTHS_IN_YEAR = 12;

export interface SeasonalityHeatmapProps {
  cells: SectorHistorySeasonality[];
  names: string[];
}

interface SeasonalityCell {
  key: string;
  index: number;
  avg: number | null;
  hitPct: number | null;
  tooltip: string;
  fill: string;
  opacity: number;
  ink: string;
}

interface SeasonalityRow {
  key: string;
  index: number;
  name: string;
  cells: SeasonalityCell[];
}

export function SeasonalityHeatmap(props: SeasonalityHeatmapProps) {
  const cellIdBase = `history-seasonality-cell-${createUniqueId()}`;
  const hint = useScrollHint();

  const model = createMemo(() => {
    const names = props.names;
    const cells = props.cells;
    const hasData = names.length > 0 && cells.length > 0;
    const labelW = labelWidthFor(names);
    const width = hasData ? labelW + MONTHS_IN_YEAR * CELL_W + 2 : EMPTY_W;
    const height = hasData ? HEADER_H + names.length * CELL_H : EMPTY_H;

    const monthly = names.map((name) => seasonalityByMonth(cells, name));
    const avgReturns = monthly
      .flat()
      .map((month) => month.avg)
      .filter((value): value is number => value !== null);
    const maxAbs = avgReturns.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const observations = monthly
      .flat()
      .filter((month) => month.avg !== null && month.n > 0)
      .map((month) => month.n);
    const nMin = observations.length > 0 ? Math.min(...observations) : null;
    const nMax = observations.length > 0 ? Math.max(...observations) : null;
    const sampleLabel =
      nMin === null || nMax === null
        ? "n=—"
        : nMin === nMax
          ? `n=${nMax} per month`
          : `n=${nMin}–${nMax} per month`;

    const rows: SeasonalityRow[] = names.map((name, rowIndex) => ({
      key: `${name}-${rowIndex}`,
      index: rowIndex,
      name,
      cells: monthly[rowIndex].map((month) => {
        const avg = month.avg;
        const hitPct = month.hitRate;
        const hitLabel = hitPct === null ? "n/a" : `${Math.round(hitPct)}%`;
        const tooltip =
          avg === null
            ? `${month.label} · ${name} · no data · hit rate n/a · n=0`
            : `${month.label} · ${name} · avg ${signedPct(avg)} · hit rate ${hitLabel} · n=${month.n}`;
        const fill = avg === null ? SURFACE : avg === 0 ? CHART_NEUTRAL : returnColor(avg, maxAbs);
        return {
          key: `${name}-${month.month}`,
          index: month.month,
          avg,
          hitPct,
          tooltip,
          fill,
          opacity: 1,
          ink: avg === null ? TEXT_MUTED : pickTextColor(fill),
        };
      }),
    }));

    return { hasData, width, height, labelW, rows, sampleLabel };
  });

  const seasonalityCellId = (row: number, col: number) => `${cellIdBase}-${row}-${col}`;
  const grid = useRovingGrid({
    rows: () => model().rows.length,
    cols: MONTHS_IN_YEAR,
    cellId: seasonalityCellId,
  });

  return (
    <div class="history-seasonality min-w-0">
      <Show when={model().hasData}>
        <div
          data-testid="history-seasonality-legend"
          class="mb-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 font-mono text-ui-micro text-fin-text-muted"
        >
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              data-testid="history-seasonality-hit-swatch"
              aria-hidden="true"
              class="relative inline-block h-1 w-[24px]"
              style={{ "background-color": alpha(CHART_MUTED, HIT_BAR_TRACK_OPACITY) }}
            >
              <span
                class="absolute inset-y-0 left-0"
                style={{
                  width: "16px",
                  "background-color": alpha(CHART_MUTED, HIT_BAR_OPACITY),
                }}
              />
            </span>
            <span>bar = up-month hit rate</span>
          </span>
          <span class="min-w-0">longer bar = more up months · hover for hit rate and n</span>
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span>avg return</span>
          </span>
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden="true"
              class="inline-block h-[10px] w-[10px] border border-fin-border"
              style={{ "background-color": CHART_NEGATIVE }}
            />
            <span>negative</span>
          </span>
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden="true"
              class="inline-block h-[10px] w-[10px] border border-fin-border"
              style={{ "background-color": CHART_NEUTRAL }}
            />
            <span>flat</span>
          </span>
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden="true"
              class="inline-block h-[10px] w-[10px] border border-fin-border"
              style={{ "background-color": CHART_POSITIVE }}
            />
            <span>positive</span>
          </span>
          <span data-testid="history-seasonality-note" class="min-w-0">
            {`${model().sampleLabel} · history, not a forecast`}
          </span>
        </div>
      </Show>

      <div
        aria-hidden="true"
        data-testid="history-seasonality-scroll-hint"
        class={`mb-1 items-center justify-end ${hint.overflowing() ? "flex" : "hidden"}`}
      >
        <span class="text-ui-micro text-fin-text-muted">
          {hint.atEnd() ? "Scroll ←" : "Scroll →"}
        </span>
      </div>
      <div
        ref={hint.setRef}
        data-testid="history-seasonality-scroll"
        role="region"
        tabIndex={0}
        aria-label="Seasonality heatmap by calendar month. Scroll sideways for all months."
        style={{ width: "100%", "overflow-x": "auto", "overflow-y": "hidden" }}
        class="min-w-0 max-w-full focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-primary"
      >
        <div class="relative" style={{ "min-width": `${model().width}px` }}>
          <MatrixFrame
            testId="history-seasonality"
            title={
              model().hasData
                ? `Monthly seasonality history, average return by sector and calendar month. ${props.names.length} sectors.`
                : "Monthly seasonality, no data"
            }
            desc="Rows are sectors and columns are January through December. Cells are coloured green for a positive average monthly return and red for a negative one; the text is the average return. The bar along the bottom of each cell is the share of months that finished up, and each cell announces the exact hit rate and number of observations. The hit-rate legend sits above the matrix so it stays visible on narrow screens. This is descriptive history, not a forecast."
            width={model().width}
            height={model().height}
            rowRail={
              model().hasData
                ? {
                    rows: model().rows.map((row) => ({ label: row.name })),
                    labelWidth: model().labelW,
                    headerHeight: HEADER_H,
                    rowHeight: CELL_H,
                  }
                : undefined
            }
            empty={
              <text
                x={model().width / 2}
                y={model().height / 2}
                font-size={SVG_TEXT}
                fill={TEXT_MUTED}
                text-anchor="middle"
                dominant-baseline="central"
              >
                No seasonality data
              </text>
            }
          >
            {model().hasData ? (
              <g>
                <For each={Array.from({ length: MONTHS_IN_YEAR }, (_, index) => index)}>
                  {(index) => (
                    <text
                      x={model().labelW + index * CELL_W + CELL_W / 2}
                      y={HEADER_H - 7}
                      font-size={SVG_TEXT}
                      font-weight={600}
                      fill={TEXT_MUTED}
                      text-anchor="middle"
                    >
                      {monthName(index)}
                    </text>
                  )}
                </For>

                <For each={model().rows}>
                  {(row) => {
                    const rowY = () => HEADER_H + row.index * CELL_H;
                    return (
                      <g>
                        <text
                          x={model().labelW - 6}
                          y={rowY() + CELL_H / 2}
                          font-size={SVG_TEXT}
                          fill={TEXT_MUTED}
                          text-anchor="end"
                          dominant-baseline="central"
                          aria-label={row.name}
                        >
                          <title>{row.name}</title>
                          {row.name}
                        </text>
                        <For each={row.cells}>
                          {(cell) => {
                            const cellX = () => model().labelW + cell.index * CELL_W;
                            const barWidth = () =>
                              cell.hitPct === null
                                ? 0
                                : (CELL_W - HIT_BAR_INSET * 2) * (cell.hitPct / 100);
                            return (
                              <g>
                                <rect
                                  id={seasonalityCellId(row.index, cell.index)}
                                  data-cell={`seasonality-${row.index}-${cell.index}`}
                                  data-ink={cell.avg === null ? undefined : cell.ink}
                                  x={cellX()}
                                  y={rowY()}
                                  width={CELL_W}
                                  height={CELL_H}
                                  fill={cell.fill}
                                  fill-opacity={cell.opacity}
                                  stroke={BORDER}
                                  stroke-width={0.5}
                                  shape-rendering="crispEdges"
                                  role="img"
                                  tabindex={grid.tabIndex(row.index, cell.index)}
                                  aria-label={cell.tooltip}
                                  onFocus={() => grid.setActive(row.index, cell.index)}
                                  onKeyDown={(event) =>
                                    grid.onKeyDown(event, row.index, cell.index)
                                  }
                                >
                                  <title>{cell.tooltip}</title>
                                </rect>
                                <text
                                  x={cellX() + CELL_W / 2}
                                  y={rowY() + CELL_H / 2 - 3}
                                  font-size={SVG_TEXT}
                                  font-weight={500}
                                  fill={cell.ink}
                                  text-anchor="middle"
                                  dominant-baseline="central"
                                  pointer-events="none"
                                  aria-hidden="true"
                                >
                                  {cell.avg === null ? "–" : signedPct(cell.avg)}
                                </text>
                                <Show when={cell.avg !== null && cell.hitPct !== null}>
                                  <rect
                                    data-hit-track={`seasonality-${row.index}-${cell.index}`}
                                    x={cellX() + HIT_BAR_INSET}
                                    y={rowY() + CELL_H - HIT_BAR_H - 2}
                                    width={CELL_W - HIT_BAR_INSET * 2}
                                    height={HIT_BAR_H}
                                    fill={cell.ink}
                                    fill-opacity={HIT_BAR_TRACK_OPACITY}
                                    shape-rendering="crispEdges"
                                    pointer-events="none"
                                    aria-hidden="true"
                                  />
                                  <rect
                                    data-hit-bar={`seasonality-${row.index}-${cell.index}`}
                                    data-hit-pct={Math.round(cell.hitPct ?? 0)}
                                    x={cellX() + HIT_BAR_INSET}
                                    y={rowY() + CELL_H - HIT_BAR_H - 2}
                                    width={barWidth()}
                                    height={HIT_BAR_H}
                                    fill={cell.ink}
                                    fill-opacity={HIT_BAR_OPACITY}
                                    shape-rendering="crispEdges"
                                    pointer-events="none"
                                    aria-hidden="true"
                                  />
                                </Show>
                              </g>
                            );
                          }}
                        </For>
                      </g>
                    );
                  }}
                </For>
              </g>
            ) : undefined}
          </MatrixFrame>
        </div>
      </div>
    </div>
  );
}
