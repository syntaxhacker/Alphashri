import { createMemo, type Accessor } from "solid-js";
import type {
  ColumnView,
  CSSProperties,
  TableColumnDef,
  TableColumnMeta,
  TableProps,
} from "./types";

export function getColumnWidth<T>(column: TableColumnDef<T>): number | undefined {
  const size = column.size;
  return typeof size === "number" ? size : undefined;
}

// Columns without an explicit `meta` are the common case; returning a shared
// frozen object keeps header/cell derivation from allocating on every pass.
const EMPTY_COLUMN_META: Partial<TableColumnMeta> = Object.freeze({});

export function getColumnMeta<T>(column: TableColumnDef<T>): Partial<TableColumnMeta> {
  return (column.meta as Partial<TableColumnMeta> | undefined) ?? EMPTY_COLUMN_META;
}

export function getValue<T>(row: T, column: TableColumnDef<T>): unknown {
  if (column.accessorFn) return column.accessorFn(row);
  if (column.accessorKey) return (row as any)[column.accessorKey];
  return undefined;
}

export interface ColumnViews<T> {
  hasSizedColumns: Accessor<boolean>;
  colCount: () => number;
  isNumeric: (id: string) => boolean;
  columnView: (id: string) => ColumnView;
  tableStyle: () => CSSProperties;
  tableClassName: () => string;
  rowStyleBase: (row: T) => CSSProperties;
}

/** Derives column width/alignment/numeric views once per column set, not per row. */
export function useColumnViews<T>(
  props: TableProps<T>,
  deps: {
    visibleColumns: Accessor<TableColumnDef<T>[]>;
    sortedData: Accessor<T[]>;
  },
): ColumnViews<T> {
  const hasSizedColumns = createMemo(() =>
    deps.visibleColumns().some((col) => {
      const w = getColumnWidth(col);
      return w !== undefined && w !== 0;
    }),
  );
  const colCount = () => deps.visibleColumns().length;

  const numericColumnIds = createMemo(() => {
    const ids = new Set<string>();
    const rows = deps.sortedData();
    const sampleLength = Math.min(rows.length, 5);
    if (sampleLength > 0) {
      // Sample each column in place: `map`/`filter` here allocated two arrays
      // per column on every price tick, only for the set to be discarded by
      // the equality guard below when numeric-ness did not actually change.
      for (const col of deps.visibleColumns()) {
        let seen = 0;
        let allNumeric = true;
        for (let i = 0; i < sampleLength; i++) {
          const v = getValue(rows[i], col);
          if (v === null || v === undefined || v === "") continue;
          seen++;
          if (typeof v !== "number") {
            allNumeric = false;
            break;
          }
        }
        if (seen > 0 && allNumeric) ids.add(col.id);
      }
    }
    return ids;
  }, undefined, {
    // A data swap rebuilds the sample but the columns' numeric-ness usually does
    // not change. Without this, the fresh Set identity re-ran every cell's style
    // effect (80 rows x 14 columns) on each filter click.
    equals: (a, b) => a.size === b.size && [...a].every((id) => b.has(id)),
  });
  const isNumeric = (id: string) => numericColumnIds().has(id);

  // Width, alignment, numeric detection and the resulting cell class/style are
  // computed once per column set, not once per row. Both `visibleColumns()` and
  // the numeric set keep their identity across a price tick — the latter via
  // its equality guard — so no cell re-derives this on a data update. Keying by
  // id also keeps cell DOM stable when column prefs reorder the columns.
  const columnViews = createMemo(() => {
    const numeric = numericColumnIds();
    const views = new Map<string, ColumnView>();
    for (const col of deps.visibleColumns()) {
      const width = getColumnWidth(col);
      const explicitAlign = getColumnMeta(col).align;
      const isNum = numeric.has(col.id);
      const dir = explicitAlign === "right" || explicitAlign === "center" ? explicitAlign : "left";
      const style: CSSProperties = {
        padding: width === 0 ? "0" : "var(--tbl-cell-pad, 3px 8px)",
        "font-size": "var(--tbl-fs, var(--text-ui-micro))",
        "line-height": "1.2",
        "vertical-align": "middle",
        "font-variant-numeric": "tabular-nums",
        "white-space": "nowrap",
        height: "var(--tbl-row-h, 23px)",
        "border-bottom": "1px solid var(--color-fin-border)",
        // Deliberately `background-color: inherit` for the base case: a cell that
        // paints its own opaque surface covers whatever `getRowStyle` put on the
        // <tr>, which is why the selected row (and every hover tint) was invisible.
        "background-color": "inherit",
        width: width !== undefined ? `${width}px` : undefined,
        display: width === 0 ? "none" : undefined,
        "text-align": explicitAlign ?? (isNum ? "right" : "left"),
      };
      if (width !== undefined) {
        style.overflow = "hidden";
        style["text-overflow"] = "ellipsis";
      }
      views.set(col.id, {
        cellClass: `paper-tanstack-cell text-${dir} ${dir === "right" || isNum ? "font-mono tabular-nums" : ""}`,
        cellStyle: style,
      });
    }
    return views;
  });
  const columnView = (id: string) => columnViews().get(id)!;

  const tableStyle = (): CSSProperties => ({
    width: "100%",
    "table-layout": hasSizedColumns() ? "fixed" : "auto",
    "min-width": `${props.minTableWidth ?? Math.max(640, colCount() * 96)}px`,
    "border-collapse": "collapse",
    "background-color": "var(--color-fin-surface)",
    ...props.style,
  });

  // `paper-row-states` opts this table into the managed row states in style.css
  // (base surface / hover / focus). The legacy paper-trading table paints an
  // opaque surface on every <td>, so it needs its own `td`-level hover instead.
  const tableClassName = () => `paper-tanstack-table paper-row-states ${props.className || ""}`;

  const rowStyleBase = (row: T): CSSProperties => ({
    "cursor": props.onRowClick ? "pointer" : undefined,
    // Deliberately no inline surface: an inline background-color outranks every
    // `:hover` rule, which is why hover never painted on the row. The surface is
    // declared in style.css on `tr[data-row="stock"]`, so hover can win; an
    // inline tint from `getRowStyle` still outranks CSS, so selection wins over
    // hover. Cells inherit the resolved row background.
    ...props.getRowStyle?.(row),
  });

  return { hasSizedColumns, colCount, isNumeric, columnView, tableStyle, tableClassName, rowStyleBase };
}
