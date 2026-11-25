import { createEffect, createSignal, untrack, type Accessor } from "solid-js";

export interface RovingCell {
  row: number;
  col: number;
}

type Bounds = number | (() => number);

export interface UseRovingGridOptions {
  rows: Bounds;
  cols: Bounds;
  /** DOM id for a cell; the caller owns the rendered elements. */
  cellId: (row: number, col: number) => string;
  initial?: RovingCell;
  /** Called with the new cell whenever the active cell changes. */
  onFocus?: (cell: RovingCell) => void;
}

export interface RovingGrid {
  active: Accessor<RovingCell>;
  isActive: (row: number, col: number) => boolean;
  tabIndex: (row: number, col: number) => 0 | -1;
  focusCell: (row: number, col: number) => void;
  onKeyDown: (event: KeyboardEvent, row: number, col: number) => void;
  setActive: {
    (row: number, col: number): void;
    (cell: RovingCell): void;
  };
}

function resolve(value: Bounds): number {
  return typeof value === "function" ? value() : value;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function sameCell(a: RovingCell, b: RovingCell): boolean {
  return a.row === b.row && a.col === b.col;
}

/**
 * One-tab-stop keyboard navigation for a row/column grid. The caller keeps the
 * cell elements and supplies their DOM ids; a move rewrites only the old and
 * new tabindex attributes.
 */
export function useRovingGrid(options: UseRovingGridOptions): RovingGrid {
  const [position, setPosition] = createSignal<RovingCell>({
    row: options.initial?.row ?? 0,
    col: options.initial?.col ?? 0,
  });

  const limits = () => ({
    maxRow: Math.max(0, Math.floor(resolve(options.rows)) - 1),
    maxCol: Math.max(0, Math.floor(resolve(options.cols)) - 1),
  });

  const clampCell = (row: number, col: number): RovingCell => {
    const { maxRow, maxCol } = limits();
    return {
      row: clamp(row, 0, maxRow),
      col: clamp(col, 0, maxCol),
    };
  };

  const active = (): RovingCell => {
    const current = position();
    return clampCell(current.row, current.col);
  };

  const domCell = (cell: RovingCell): HTMLElement | null => {
    if (typeof document === "undefined") return null;
    return document.getElementById(options.cellId(cell.row, cell.col));
  };

  // A move writes only the old and new tab stops; it never re-renders every
  // cell's tabindex binding.
  const moveTabStop = (from: RovingCell, to: RovingCell) => {
    if (sameCell(from, to)) return;
    const previous = domCell(from);
    const next = domCell(to);
    if (previous && previous !== next) previous.setAttribute("tabindex", "-1");
    next?.setAttribute("tabindex", "0");
  };

  const setActiveCell = (row: number, col: number) => {
    const next = clampCell(row, col);
    const previous = untrack(active);
    if (sameCell(previous, next)) return;
    setPosition(next);
    moveTabStop(previous, next);
    options.onFocus?.(next);
  };

  function setActive(row: number, col: number): void;
  function setActive(cell: RovingCell): void;
  function setActive(rowOrCell: number | RovingCell, maybeCol?: number): void {
    if (typeof rowOrCell === "number") {
      setActiveCell(rowOrCell, maybeCol ?? 0);
      return;
    }
    setActiveCell(rowOrCell.row, rowOrCell.col);
  }

  // Dimensions can shrink under the active cell; keep the stored position valid
  // so a later re-render seats the single tab stop on a cell that exists.
  createEffect(() => {
    const { maxRow, maxCol } = limits();
    const current = untrack(position);
    const next = {
      row: clamp(current.row, 0, maxRow),
      col: clamp(current.col, 0, maxCol),
    };
    if (!sameCell(current, next)) setPosition(next);
  });

  const focusCell = (row: number, col: number) => {
    const next = clampCell(row, col);
    setActive(next.row, next.col);
    domCell(next)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent, row: number, col: number) => {
    const current = clampCell(row, col);
    const { maxRow, maxCol } = limits();
    let nextRow = current.row;
    let nextCol = current.col;

    switch (event.key) {
      case "ArrowLeft":
        nextCol = Math.max(0, current.col - 1);
        break;
      case "ArrowRight":
        nextCol = Math.min(maxCol, current.col + 1);
        break;
      case "ArrowUp":
        nextRow = Math.max(0, current.row - 1);
        break;
      case "ArrowDown":
        nextRow = Math.min(maxRow, current.row + 1);
        break;
      case "Home":
        nextCol = 0;
        break;
      case "End":
        nextCol = maxCol;
        break;
      case "Enter":
      case " ":
      case "Spacebar":
        event.preventDefault();
        focusCell(current.row, current.col);
        return;
      default:
        return;
    }

    event.preventDefault();
    focusCell(nextRow, nextCol);
  };

  return {
    active,
    isActive: (row, col) => sameCell(active(), { row, col }),
    tabIndex: (row, col) => {
      // Subscribe to bounds only: active changes are applied to the two moved
      // DOM cells imperatively, so a move cannot dirty every cell.
      resolve(options.rows);
      resolve(options.cols);
      const current = untrack(active);
      return sameCell(current, { row, col }) ? 0 : -1;
    },
    focusCell,
    onKeyDown,
    setActive,
  };
}
