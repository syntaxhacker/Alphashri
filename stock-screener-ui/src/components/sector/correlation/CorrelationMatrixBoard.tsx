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
import { useScrollHint } from "../history/visuals/matrices/useScrollHint";

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
const BASE_INDEX = "NIFTY 50";
const BASE_INDEX_LABEL = "N50";
/** A 10-column India matrix fits inside a 748px panel at 34–38px cells. */
const LABEL_COL_PX = 104;
// 48px carries a 6-letter header ("PHARMA", "ENERGY") at the 12px floor; 38px
// let those labels overprint the neighbouring header on a 390 phone.
const MIN_CELL_PX = 48;

/**
 * NSE index names are long ("NIFTY CONSUMPTION") while a matrix header cell is
 * ~60px. Financial shorthand stays readable where a six-character slice read
 * "CONSU…" at every width. Row labels keep the stripped full name.
 */
const HEADER_LABELS: Record<string, string> = {
  "NIFTY 50": "N50",
  "NIFTY BANK": "BANK",
  "NIFTY IT": "IT",
  "NIFTY FMCG": "FMCG",
  "NIFTY PHARMA": "PHARMA",
  "NIFTY AUTO": "AUTO",
  "NIFTY ENERGY": "ENERGY",
  "NIFTY REALTY": "REALTY",
  "NIFTY METAL": "METAL",
  "NIFTY CONSUMPTION": "CONS.",
  "NIFTY FIN SERVICE": "FIN SVC",
  "NIFTY FINANCIAL SERVICES": "FIN SVC",
  "NIFTY CONSUMER DURABLES": "CONS DUR",
  "NIFTY CONSUMER NON DURABLES": "CONS N-D",
  "NIFTY CONSUMER SERVICES": "CONS SVC",
  "NIFTY TECHNOLOGY SERVICES": "TECH SVC",
  "NIFTY HEALTH TECHNOLOGY": "HLTH TEC",
  "NIFTY ELECTRONIC TECHNOLOGY": "ELEC TEC",
  "NIFTY PRODUCER MANUFACTURING": "PROD MFG",
  "NIFTY COMMERCIAL SERVICES": "COMM SVC",
  "NIFTY DISTRIBUTION SERVICES": "DIST SVC",
  "NIFTY INDUSTRIAL SERVICES": "INDL SVC",
  "NIFTY NON ENERGY MINERALS": "NON-EN",
  "NIFTY ENERGY MINERALS": "ENERGY",
  "NIFTY PROCESS INDUSTRIES": "PROCESS",
  "NIFTY RETAIL TRADE": "RETAIL",
  "NIFTY HEALTH SERVICES": "HEALTH",
  "NIFTY MISCELLANEOUS": "MISC",
  "NIFTY COMMUNICATIONS": "COMMS",
  "NIFTY TRANSPORTATION": "TRANSP",
};

function stripNifty(name: string, names: string[]): string {
  const strip = names.length > 1 && names.every((item) => item.startsWith(NIFTY_PREFIX));
  return strip && name.startsWith(NIFTY_PREFIX) ? name.slice(NIFTY_PREFIX.length) : name;
}

/** Keep headers horizontal: strip a shared NIFTY prefix, then use finance shorthand. */
export function shortSectorLabel(name: string, names: string[]): string {
  // The base index must not read like a correlation value once "NIFTY " is gone.
  if (name === BASE_INDEX) return BASE_INDEX_LABEL;
  const base = stripNifty(name, names);
  const stripped = base !== name;
  const normalized = base.toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const mapped = stripped
    ? (HEADER_LABELS[normalized] ?? HEADER_LABELS[`NIFTY ${normalized}`])
    : undefined;
  if (mapped) return mapped;
  if (base.length <= 7) return base;
  return `${base.slice(0, 6)}…`;
}

/** Row rail labels: full name once the shared NIFTY prefix is removed. */
export function rowSectorLabel(name: string, names: string[]): string {
  if (name === BASE_INDEX) return BASE_INDEX_LABEL;
  const base = stripNifty(name, names);
  return base.length > 14 ? `${base.slice(0, 13)}…` : base;
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
  rowLabels: string[];
  cells: MatrixCell[][];
} {
  const names = [...symbols];
  return {
    names,
    labels: names.map((name) => shortSectorLabel(name, names)),
    rowLabels: names.map((name) => rowSectorLabel(name, names)),
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
  const hint = useScrollHint();
  const template = () =>
    `${LABEL_COL_PX}px repeat(${Math.max(1, model().names.length)}, minmax(${MIN_CELL_PX}px, 1fr))`;
  // Keep the full matrix inside a ~748px panel at 900/1100; only a phone needs
  // the horizontal scroller. Previously `w-max` let every 1fr track claim its
  // widest content, so the 10th column clipped even at 1600.
  const minWidth = () =>
    LABEL_COL_PX + Math.max(1, model().names.length) * MIN_CELL_PX + model().names.length;

  return (
    <div
      data-testid="correlation-matrix-board"
      data-theme={props.isDark ? "dark" : "light"}
      class="flex min-h-0 min-w-0 flex-col gap-1"
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
          diagonal = 100% self
        </span>
      </div>

      <div
        data-testid="correlation-matrix-scroll-hint"
        aria-hidden="true"
        class={`mb-0.5 justify-end ${hint.overflowing() ? "flex" : "hidden"}`}
      >
        <span class="text-ui-micro text-fin-text-muted">
          {hint.atEnd() ? "Scroll ←" : "Scroll →"}
        </span>
      </div>

      <div
        ref={(el) => hint.setRef(el)}
        data-testid="correlation-matrix-scroll"
        role="region"
        tabIndex={0}
        aria-label="Cross-sector correlation matrix. Scroll sideways for all sectors."
        class="min-h-0 min-w-0 overflow-auto focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-primary"
      >
        <div
          data-testid="correlation-matrix-grid"
          class="grid w-full min-w-0 gap-px"
          style={{
            "grid-template-columns": template(),
            "min-width": `${minWidth()}px`,
          }}
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
                  class="sticky left-0 z-10 flex min-w-0 items-center overflow-hidden text-ellipsis whitespace-nowrap bg-fin-surface px-1 text-ui-micro text-fin-text-muted"
                >
                  {model().rowLabels[rowIndex()]}
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
                      cell.diagonal || cell.value === null
                        ? cell.diagonal
                          ? "100"
                          : "—"
                        : String(Math.round(cell.value * 100));
                    const label = () =>
                      cell.diagonal
                        ? `${cell.row} × ${cell.col}: 100% self`
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
