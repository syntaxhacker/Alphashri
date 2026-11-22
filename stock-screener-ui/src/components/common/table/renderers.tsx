import { For, Show, type Accessor, type JSX } from "solid-js";
import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import { getColumnWidth, getColumnMeta } from "./columns";
import type {
  ColumnView,
  CSSProperties,
  GroupSlot,
  RowSlot,
  SortEntry,
  TableColumnDef,
  TableProps,
} from "./types";

export interface TableRenderContext<T> {
  props: TableProps<T>;
  visibleColumns: Accessor<TableColumnDef<T>[]>;
  colCount: () => number;
  isNumeric: (id: string) => boolean;
  columnView: (id: string) => ColumnView;
  rowStyleBase: (row: T) => CSSProperties;
  getValue: (row: T, col: TableColumnDef<T>) => unknown;
  sorting: Accessor<SortEntry[]>;
  enableSorting: Accessor<boolean>;
  toggleSort: (id: string) => void;
  isRowExpanded: (row: T, index: number) => boolean;
  toggleRow: (row: T, index: number) => void;
  isGroupExpanded: (value: unknown) => boolean;
  toggleGroup: (value: unknown) => void;
}

export function renderHeader<T>(col: TableColumnDef<T>, ctx: TableRenderContext<T>): JSX.Element {
  const width = getColumnWidth(col);
  const sortable = () => col.enableSorting !== false && ctx.enableSorting();
  const isSorted = () => ctx.sorting().some((s) => s.id === col.id);
  const sortDir = () => ctx.sorting().find((s) => s.id === col.id);
  const ariaSort = () => {
    if (!sortable()) return undefined;
    if (!isSorted()) return "none";
    return sortDir()?.desc ? "descending" : "ascending";
  };
  const headerStyle = (): CSSProperties => ({
    padding: width === 0 ? "0" : "var(--tbl-cell-pad, 2px 8px)",
    height: "var(--tbl-row-h, 23px)",
    "font-size": "10px",
    "font-family": palette.MONO,
    "line-height": "1.2",
    "font-weight": 700,
    "letter-spacing": "0.07em",
    "text-transform": "uppercase",
    "font-variant-numeric": "tabular-nums",
    "white-space": "nowrap",
    "vertical-align": "middle",
    "user-select": "none",
    color: "var(--color-fin-primary)",
    "border-bottom": "1px solid var(--color-fin-border)",
    width: width !== undefined ? `${width}px` : undefined,
    display: width === 0 ? "none" : undefined,
    "text-align": getColumnMeta(col).align ?? (ctx.isNumeric(col.id) ? "right" : "left"),
    "cursor": sortable() ? "pointer" : "default",
    position: ctx.props.stickyHeader ? "sticky" : undefined,
    top: ctx.props.stickyHeader ? 0 : undefined,
    "z-index": ctx.props.stickyHeader ? 1 : undefined,
    "background-color": ctx.props.stickyHeader ? "var(--color-fin-surface-alt)" : undefined,
  });
  const h = col.header;
  const content = typeof h === "function" ? h({ column: col }) : h != null ? <span>{h}</span> : <span>{col.id}</span>;
  return (
    <th
      className="paper-tanstack-header-cell"
      id={`paper-tanstack-header-${String(col.id)}`}
      style={headerStyle()}
      tabIndex={sortable() ? 0 : undefined}
      aria-sort={ariaSort()}
      onClick={() => sortable() && ctx.toggleSort(col.id)}
      onKeyDown={sortable() ? (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          ctx.toggleSort(col.id);
        }
      } : undefined}
    >
      {content}
      {isSorted() && (sortDir()?.desc ? " ▼" : " ▲")}
    </th>
  );
}

export function renderSubRow<T>(
  row: Accessor<T>,
  index: Accessor<number>,
  ctx: TableRenderContext<T>,
): JSX.Element {
  const shows = () => ctx.props.renderSubComponent != null && ctx.props.getRowCanExpand?.(row()) === true;
  return (
    <Show when={shows() && ctx.isRowExpanded(row(), index())}>
      <tr className="paper-tanstack-expanded-row">
        <td colSpan={ctx.colCount()} style={{ padding: "0px", "border-bottom": "1px solid var(--color-fin-border)", "background-color": "var(--color-fin-surface-alt)" }}>
          {ctx.props.renderSubComponent?.(row())}
        </td>
      </tr>
    </Show>
  );
}

export function renderRow<T>(item: RowSlot<T>, ctx: TableRenderContext<T>): JSX.Element {
  // `frame()` is read inside every reactive position below, never captured as
  // a value — that is what lets a stable slot re-render its cells instead of
  // its host element being rebuilt.
  const frame = item.frame;
  const row = () => frame().row;
  const index = () => frame().index;
  const k = item.key;
  return (
    <>
      <tr
        style={{ ...ctx.rowStyleBase(row()) }}
        onClick={() => ctx.props.onRowClick?.(row())}
        onKeyDown={ctx.props.onRowClick ? (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); ctx.props.onRowClick!(row()); } } : undefined}
        tabIndex={ctx.props.onRowClick ? 0 : undefined}
        className={ctx.props.getRowClassName?.(row())}
        data-testid={ctx.props.getRowTestId?.(row(), index())}
        {...ctx.props.getRowAttributes?.(row(), index())}
        data-clickable={ctx.props.onRowClick ? "true" : undefined}
        data-row="stock"
      >
        <For each={ctx.visibleColumns()}>{(col) => {
          const view = () => ctx.columnView(col.id);
          const cell = () => {
            const r = row();
            const i = index();
            return col.cell
              ? col.cell({ row: { original: r, index: i, isExpanded: () => ctx.isRowExpanded(r, i), toggle: () => ctx.toggleRow(r, i) }, column: col })
              : <span>{String(ctx.getValue(r, col))}</span>;
          };
          return (
            <Box
              component="td"
              className={view().cellClass}
              id={`paper-tanstack-cell-${String(col.id)}-${k}`}
              style={view().cellStyle}
            >
              {cell()}
            </Box>
          );
        }}</For>
      </tr>
      {renderSubRow(row, index, ctx)}
    </>
  );
}

export function renderGroupRow<T>(item: GroupSlot<T>, ctx: TableRenderContext<T>): JSX.Element {
  const frame = item.frame;
  const expanded = () => ctx.isGroupExpanded(frame().value);
  return (
    <tr
      data-testid={ctx.props.getGroupRowTestId?.(frame().value)}
      onClick={() => ctx.toggleGroup(frame().value)}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          ctx.toggleGroup(frame().value);
        }
      }}
      tabIndex={0}
      aria-expanded={expanded()}
      style={{ "cursor": "pointer" }}
      className="paper-tanstack-group-row"
    >
      <Box component="td" colSpan={ctx.colCount()} style={{ padding: "0px", border: "none", "background-color": "inherit" }}>
        {ctx.props.renderGroupHeader?.({
          value: frame().value,
          rows: frame().rows,
          isExpanded: expanded,
          toggle: () => ctx.toggleGroup(frame().value),
        })}
      </Box>
    </tr>
  );
}
