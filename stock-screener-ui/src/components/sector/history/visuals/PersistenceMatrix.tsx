import { For, Show, createMemo, createUniqueId } from "solid-js";
import { BORDER, PRIMARY, SCALE_GRAY, SURFACE, TEXT_MUTED } from "@/ui/palette";
import { SVG_TEXT, finite } from "./shared";

const LABEL_W = 76;
const CELL_W = 44;
const CELL_H = 22;
const HEADER_H = 38;
const FOOTER_H = 28;
const EMPTY_W = 360;
const EMPTY_H = 96;

export interface PersistenceMatrixProps {
  names: string[];
  matrix: (number | null)[][];
}

interface PersistenceCell {
  key: string;
  col: number;
  pct: number | null;
  diagonal: boolean;
  title: string;
}

interface PersistenceRow {
  key: string;
  index: number;
  cells: PersistenceCell[];
}

function exactPct(value: number): string {
  return `${value.toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function PersistenceMatrix(props: PersistenceMatrixProps) {
  const titleId = `history-persistence-title-${createUniqueId()}`;
  const descId = `history-persistence-desc-${createUniqueId()}`;

  const model = createMemo(() => {
    const matrix = props.matrix;
    const rows = matrix.length;
    const cols = rows > 0 ? matrix.reduce((max, row) => Math.max(max, row.length), 0) : 0;
    const hasData = rows > 0 && cols > 0;
    const width = hasData ? LABEL_W + cols * CELL_W + 2 : EMPTY_W;
    const height = hasData ? HEADER_H + rows * CELL_H + FOOTER_H : EMPTY_H;
    const sectorCount = Math.max(props.names.length, rows);

    const finiteValues = matrix.flat().filter(finite);
    const rowSums = matrix
      .map((row) => row.filter(finite))
      .filter((row) => row.length > 0)
      .map((row) => row.reduce((sum, value) => sum + value, 0));
    const percentRows = rowSums.filter((sum) => sum >= 95 && sum <= 105).length;
    const fractionRows = rowSums.filter((sum) => sum >= 0.95 && sum <= 1.05).length;
    const maxRaw = finiteValues.reduce((max, value) => Math.max(max, value), 0);
    const asFraction =
      fractionRows > percentRows
        ? true
        : percentRows > fractionRows
          ? false
          : maxRaw > 0 && maxRaw <= 1.0001;
    const pctOf = (value: number | null): number | null => {
      if (!finite(value)) return null;
      return asFraction ? value * 100 : value;
    };
    const maxPct = Math.max(
      1,
      finiteValues.reduce((max, value) => Math.max(max, asFraction ? value * 100 : value), 0),
    );

    const grid: PersistenceRow[] = matrix.map((rowValues, rowIndex) => ({
      key: `row-${rowIndex}`,
      index: rowIndex,
      cells: Array.from({ length: cols }, (_, col) => {
        const pct = pctOf(rowValues[col] ?? null);
        return {
          key: `${rowIndex}-${col}`,
          col,
          pct,
          diagonal: rowIndex === col,
          title:
            pct === null
              ? `#${rowIndex + 1} → #${col + 1} · no data`
              : `#${rowIndex + 1} → #${col + 1} · ${exactPct(pct)}`,
        };
      }),
    }));

    return { hasData, width, height, rows, cols, grid, sectorCount, maxPct };
  });

  return (
    <svg
      data-testid="history-persistence"
      width="100%"
      viewBox={`0 0 ${model().width} ${model().height}`}
      preserveAspectRatio="xMinYMin meet"
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      style={{ display: "block" }}
    >
      <title id={titleId}>
        {model().hasData
          ? `Rank persistence matrix for ${model().sectorCount} sectors, ${model().rows} by ${model().cols} ranks.`
          : "Rank persistence matrix, no data"}
      </title>
      <desc id={descId}>
        Rows are this month's sector rank and columns are next month's rank, from 1 through{" "}
        {Math.max(model().rows, model().cols)}, across {model().sectorCount} sectors. Each cell is
        the share of transitions that moved between those ranks, in percent. The diagonal marks
        sectors that stayed in the same rank.
      </desc>
      <rect width={model().width} height={model().height} fill={SURFACE} />

      <Show
        when={model().hasData}
        fallback={
          <text
            data-testid="history-persistence-empty"
            x={model().width / 2}
            y={model().height / 2}
            font-size={SVG_TEXT}
            fill={TEXT_MUTED}
            text-anchor="middle"
            dominant-baseline="central"
          >
            No persistence data
          </text>
        }
      >
        <g>
          <text x={4} y={14} font-size={SVG_TEXT} fill={TEXT_MUTED}>
            this month ↓
          </text>
          <text x={LABEL_W} y={14} font-size={SVG_TEXT} fill={TEXT_MUTED}>
            next month rank →
          </text>

          <For each={Array.from({ length: model().cols }, (_, index) => index)}>
            {(col) => (
              <text
                x={LABEL_W + col * CELL_W + CELL_W / 2}
                y={HEADER_H - 6}
                font-size={SVG_TEXT}
                fill={TEXT_MUTED}
                text-anchor="middle"
              >
                {col + 1}
              </text>
            )}
          </For>

          <For each={model().grid}>
            {(row) => {
              const rowY = () => HEADER_H + row.index * CELL_H;
              return (
                <g>
                  <text
                    x={4}
                    y={rowY() + CELL_H / 2}
                    font-size={SVG_TEXT}
                    fill={TEXT_MUTED}
                    dominant-baseline="central"
                  >
                    {`#${row.index + 1}`}
                  </text>
                  <For each={row.cells}>
                    {(cell) => {
                      const cellX = () => LABEL_W + cell.col * CELL_W;
                      return (
                        <g>
                          <rect
                            data-cell={`persistence-${row.index}-${cell.col}`}
                            data-diagonal={cell.diagonal ? "true" : "false"}
                            x={cellX()}
                            y={rowY()}
                            width={CELL_W}
                            height={CELL_H}
                            fill={cell.pct === null ? SURFACE : PRIMARY}
                            fill-opacity={
                              cell.pct === null
                                ? 1
                                : 0.08 + 0.62 * Math.min(1, cell.pct / model().maxPct)
                            }
                            stroke={cell.diagonal ? PRIMARY : BORDER}
                            stroke-width={cell.diagonal ? 1.25 : 0.5}
                            shape-rendering="crispEdges"
                            aria-label={cell.title}
                          >
                            <title>{cell.title}</title>
                          </rect>
                          <Show when={cell.pct !== null && cell.pct >= 10}>
                            <text
                              x={cellX() + CELL_W / 2}
                              y={rowY() + CELL_H / 2}
                              font-size={SVG_TEXT}
                              fill={SCALE_GRAY[0]}
                              text-anchor="middle"
                              dominant-baseline="central"
                            >
                              {`${Math.round(cell.pct ?? 0)}%`}
                            </text>
                          </Show>
                        </g>
                      );
                    }}
                  </For>
                </g>
              );
            }}
          </For>

          <text x={4} y={model().height - 8} font-size={SVG_TEXT} fill={TEXT_MUTED}>
            share of transitions · diagonal = stayed in rank
          </text>
        </g>
      </Show>
    </svg>
  );
}
