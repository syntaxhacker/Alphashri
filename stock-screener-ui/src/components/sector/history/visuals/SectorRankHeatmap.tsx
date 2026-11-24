import { For, Show, createMemo, createUniqueId } from "solid-js";
import { BORDER, SCALE_GRAY, SURFACE, TEXT_MUTED } from "@/ui/palette";
import type { SectorHistorySeries } from "../../../../types/sectorHistory";
import { SVG_TEXT, finite, rankTone, truncate, yearOf } from "./shared";

const CELL_W = 22;
const CELL_H = 22;
const LABEL_W = 108;
const HEADER_H = 22;
const LEGEND_H = 24;
const EMPTY_W = 320;
const EMPTY_H = 92;

export interface SectorRankHeatmapProps {
  months: string[];
  series: SectorHistorySeries[];
}

interface RankCell {
  key: string;
  index: number;
  rank: number | null;
  label: string;
  fill: string;
  opacity: number;
}

interface RankRow {
  key: string;
  index: number;
  name: string;
  cells: RankCell[];
}

export function SectorRankHeatmap(props: SectorRankHeatmapProps) {
  const titleId = `history-rank-heatmap-title-${createUniqueId()}`;
  const descId = `history-rank-heatmap-desc-${createUniqueId()}`;

  const model = createMemo(() => {
    const months = props.months;
    const sectors = props.series.filter((item) => !item.is_benchmark);
    const hasData = sectors.length > 0 && months.length > 0;
    const width = hasData ? LABEL_W + months.length * CELL_W + 4 : EMPTY_W;
    const height = hasData ? HEADER_H + sectors.length * CELL_H + LEGEND_H : EMPTY_H;

    const yearMarks = months.reduce<Array<{ index: number; year: string }>>(
      (marks, month, index) => {
        const year = yearOf(month);
        if (index === 0 || year !== yearOf(months[index - 1])) marks.push({ index, year });
        return marks;
      },
      [],
    );

    const rows: RankRow[] = sectors.map((sector, rowIndex) => ({
      key: `${sector.name}-${rowIndex}`,
      index: rowIndex,
      name: sector.name,
      cells: months.map((month, monthIndex) => {
        const rawRank = sector.ranks[monthIndex];
        const rank = finite(rawRank) ? rawRank : null;
        const label =
          rank === null
            ? `${month} · ${sector.name} · no rank`
            : `${month} · ${sector.name} · rank ${Math.round(rank)}`;
        const tone = rank === null ? null : rankTone(rank, sectors.length);
        return {
          key: `${sector.name}-${month}`,
          index: monthIndex,
          rank,
          label,
          fill: tone ? tone.fill : SURFACE,
          opacity: tone ? tone.opacity : 1,
        };
      }),
    }));

    return { hasData, width, height, yearMarks, rows, sectorCount: sectors.length };
  });

  return (
    <svg
      data-testid="history-rank-heatmap"
      width="100%"
      viewBox={`0 0 ${model().width} ${model().height}`}
      preserveAspectRatio="xMinYMin meet"
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      style={{ display: "block" }}
    >
      <title id={titleId}>
        {model().hasData
          ? `Sector rank heatmap, ${model().sectorCount} sectors across ${props.months.length} months. Rank 1 is strongest.`
          : "Sector rank heatmap, no data"}
      </title>
      <desc id={descId}>
        Rows are sectors and columns are months. Green marks a high rank (1 is strongest), red marks
        a low rank, and the middle of the field is neutral. Missing ranks leave the cell empty.
      </desc>
      <rect width={model().width} height={model().height} fill={SURFACE} />

      <Show
        when={model().hasData}
        fallback={
          <text
            data-testid="history-rank-heatmap-empty"
            x={model().width / 2}
            y={model().height / 2}
            font-size={SVG_TEXT}
            fill={TEXT_MUTED}
            text-anchor="middle"
            dominant-baseline="central"
          >
            No sector history
          </text>
        }
      >
        <g>
          <For each={model().yearMarks}>
            {(mark) => (
              <text
                x={LABEL_W + mark.index * CELL_W + 2}
                y={15}
                font-size={SVG_TEXT}
                fill={TEXT_MUTED}
              >
                {mark.year}
              </text>
            )}
          </For>

          <For each={model().yearMarks.filter((mark) => mark.index > 0)}>
            {(mark) => (
              <line
                x1={LABEL_W + mark.index * CELL_W}
                x2={LABEL_W + mark.index * CELL_W}
                y1={0}
                y2={HEADER_H + model().rows.length * CELL_H}
                stroke={BORDER}
                stroke-width={0.5}
                shape-rendering="crispEdges"
              />
            )}
          </For>

          <For each={model().rows}>
            {(sector) => {
              const rowY = () => HEADER_H + sector.index * CELL_H;
              return (
                <g>
                  <text
                    x={LABEL_W - 6}
                    y={rowY() + CELL_H / 2}
                    font-size={SVG_TEXT}
                    fill={TEXT_MUTED}
                    text-anchor="end"
                    dominant-baseline="central"
                  >
                    {truncate(sector.name, 14)}
                  </text>
                  <For each={sector.cells}>
                    {(cell) => {
                      const cellX = () => LABEL_W + cell.index * CELL_W;
                      return (
                        <g>
                          <rect
                            data-cell={`rank-${sector.index}-${cell.index}`}
                            x={cellX()}
                            y={rowY()}
                            width={CELL_W}
                            height={CELL_H}
                            fill={cell.fill}
                            fill-opacity={cell.opacity}
                            stroke={BORDER}
                            stroke-width={0.5}
                            shape-rendering="crispEdges"
                            aria-label={cell.label}
                          >
                            <title>{cell.label}</title>
                          </rect>
                          <text
                            x={cellX() + CELL_W / 2}
                            y={rowY() + CELL_H / 2}
                            font-size={SVG_TEXT}
                            fill={cell.rank === null ? TEXT_MUTED : SCALE_GRAY[0]}
                            text-anchor="middle"
                            dominant-baseline="central"
                          >
                            {cell.rank === null ? "–" : Math.round(cell.rank)}
                          </text>
                        </g>
                      );
                    }}
                  </For>
                </g>
              );
            }}
          </For>

          <text
            data-testid="history-rank-heatmap-legend"
            x={LABEL_W}
            y={model().height - 7}
            font-size={SVG_TEXT}
            fill={TEXT_MUTED}
          >
            {`1 best → ${model().sectorCount} worst`}
          </text>
        </g>
      </Show>
    </svg>
  );
}
