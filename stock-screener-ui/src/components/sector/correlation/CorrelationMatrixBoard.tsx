import { For, createMemo } from "solid-js";
import { alpha, CHART_TOP3, SURFACE_ALT } from "@/ui/palette";
import {
  BROWN_DARK,
  CREAM,
  SECTOR_GREEN,
  SECTOR_LIGHT_GREEN,
  SECTOR_LIGHT_RED,
  SECTOR_RED,
  TRADING_GREEN,
  TRADING_RED,
} from "../../../config/colors";
import { interpolateHex } from "../../../utils/color";
import { pickTextColor } from "../../../utils/contrast";

/** Same red → neutral → green scale the correlation heatmap uses. */
export const CORRELATION_STOPS = [
  SECTOR_LIGHT_RED,
  TRADING_RED,
  SECTOR_RED,
  CREAM,
  SECTOR_GREEN,
  TRADING_GREEN,
  SECTOR_LIGHT_GREEN,
] as const;

const NIFTY_PREFIX = "NIFTY ";
const LABEL_CHARS = 6;
const LABEL_COL_PX = 64;
const MIN_CELL_PX = 40;

/** Keep headers horizontal: strip a shared NIFTY prefix, then cap the width. */
export function shortSectorLabel(name: string, names: string[]): string {
  const strip = names.length > 1 && names.every((item) => item.startsWith(NIFTY_PREFIX));
  const base = strip && name.startsWith(NIFTY_PREFIX) ? name.slice(NIFTY_PREFIX.length) : name;
  return base.length > LABEL_CHARS ? `${base.slice(0, LABEL_CHARS - 1)}…` : base;
}

function fillFor(value: number): string {
  const position = Math.max(0, Math.min(1, (value + 1) / 2)) * (CORRELATION_STOPS.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(CORRELATION_STOPS.length - 1, lower + 1);
  return interpolateHex(CORRELATION_STOPS[lower], CORRELATION_STOPS[upper], position - lower);
}

export interface MatrixCell {
  row: string;
  col: string;
  value: number | null;
  diagonal: boolean;
}

export function buildMatrixModel(matrix: number[][], symbols: string[]): {
  names: string[];
  labels: string[];
  cells: MatrixCell[][];
} {
  const names = [...symbols];
  return {
    names,
    labels: names.map((name) => shortSectorLabel(name, names)),
    cells: names.map((row, i) =>
      names.map((col, j) => {
        const raw = matrix[i]?.[j];
        return {
          row,
          col,
          value: typeof raw === "number" && Number.isFinite(raw) ? raw : null,
          diagonal: i === j,
        };
      }),
    ),
  };
}

export function CorrelationMatrixBoard(props: {
  matrix: number[][];
  symbols: string[];
  isDark: boolean;
}) {
  const model = createMemo(() => buildMatrixModel(props.matrix, props.symbols));
  const template = () =>
    `${LABEL_COL_PX}px repeat(${Math.max(1, model().names.length)}, minmax(${MIN_CELL_PX}px, 1fr))`;

  return (
    <div
      data-testid="correlation-matrix-board"
      data-theme={props.isDark ? "dark" : "light"}
      class="flex min-h-0 min-w-0 flex-1 flex-col gap-1"
    >
      <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-ui-micro text-fin-text-muted">
        <span>correlation %</span>
        <span class="inline-flex items-center gap-1">
          <span>-1</span>
          <For each={[CORRELATION_STOPS[0], CORRELATION_STOPS[3], CORRELATION_STOPS[6]]}>
            {(stop) => (
              <span
                aria-hidden="true"
                class="inline-block h-2 w-3 border border-fin-border"
                style={{ "background-color": stop }}
              />
            )}
          </For>
          <span>+1</span>
        </span>
        <span
          data-testid="correlation-matrix-diagonal-key"
          class="inline-flex items-center gap-1"
        >
          <span
            aria-hidden="true"
            class="inline-block h-2 w-3 rounded-sm"
            style={{
              "background-color": alpha(CHART_TOP3, 0.18),
              "border": `1px solid ${CHART_TOP3}`,
            }}
          />
          diagonal = 1.0 self
        </span>
      </div>

      <div
        data-testid="correlation-matrix-scroll"
        role="region"
        tabIndex={0}
        aria-label="Cross-sector correlation matrix. Scroll sideways for all sectors."
        class="min-h-0 min-w-0 flex-1 overflow-auto focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-primary"
      >
        <div
          data-testid="correlation-matrix-grid"
          class="grid w-max min-w-full gap-px"
          style={{ "grid-template-columns": template() }}
        >
          <div
            data-testid="correlation-matrix-corner"
            class="sticky left-0 z-10 flex items-center justify-center bg-fin-surface px-1 text-ui-micro text-fin-text-muted"
          >
            sector
          </div>
          <For each={model().labels}>
            {(label, index) => (
              <div
                data-testid={`correlation-matrix-header-${index()}`}
                data-sector={model().names[index()]}
                title={model().names[index()]}
                aria-label={model().names[index()]}
                class="flex h-6 min-w-0 items-center justify-center whitespace-nowrap border-b border-fin-border bg-fin-surface px-0.5 text-ui-micro font-semibold text-fin-text"
              >
                {label}
              </div>
            )}
          </For>

          <For each={model().cells}>
            {(cells, rowIndex) => (
              <>
                <div
                  data-testid={`correlation-matrix-row-${rowIndex()}`}
                  data-sector={model().names[rowIndex()]}
                  title={model().names[rowIndex()]}
                  aria-label={model().names[rowIndex()]}
                  class="sticky left-0 z-10 flex items-center truncate bg-fin-surface px-1 text-ui-micro text-fin-text-muted"
                >
                  {model().names[rowIndex()]}
                </div>
                <For each={cells}>
                  {(cell, colIndex) => {
                    const fill = () =>
                      cell.diagonal
                        ? alpha(CHART_TOP3, 0.18)
                        : cell.value === null
                          ? SURFACE_ALT
                          : fillFor(cell.value);
                    const ink = () =>
                      cell.diagonal || cell.value === null
                        ? CHART_TOP3
                        : pickTextColor(fillFor(cell.value!), CREAM, BROWN_DARK);
                    const display = () =>
                      cell.diagonal
                        ? "1.0"
                        : cell.value === null
                          ? "—"
                          : String(Math.round(cell.value * 100));
                    const label = () =>
                      cell.diagonal
                        ? `${cell.row} × ${cell.col}: 1.0 self`
                        : cell.value === null
                          ? `${cell.row} × ${cell.col}: — no data`
                          : `${cell.row} × ${cell.col}: ${display()}%`;
                    return (
                      <div
                        data-testid={`correlation-matrix-cell-${rowIndex()}-${colIndex()}`}
                        data-diagonal={String(cell.diagonal)}
                        title={label()}
                        aria-label={label()}
                        class="flex h-7 min-w-0 items-center justify-center border font-mono text-ui-micro tabular-nums"
                        classList={{ "font-bold": cell.diagonal }}
                        style={{
                          "background-color": fill(),
                          color: ink(),
                          "border-color": cell.diagonal ? CHART_TOP3 : "var(--color-fin-border)",
                        }}
                      >
                        {display()}
                      </div>
                    );
                  }}
                </For>
              </>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
