import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Box, Paper, ScrollArea, useDensity } from "@/ui";
import { InlineLoader } from "./states";
import * as palette from "@/ui/palette";
import type { CSSProperties, JSX } from "solid-js";

/**
 * Column-level metadata understood by TanStackTable.
 * Usage: `meta: { align: "right" }` on a ColumnDef.
 */
export interface TableColumnMeta {
  align?: "left" | "center" | "right";
}

export interface TableColumnDef<T> {
  id: string;
  header?: string | JSX.Element | ((ctx: { column: TableColumnDef<T> }) => JSX.Element);
  accessorKey?: keyof T | string;
  accessorFn?: (row: T) => unknown;
  size?: number;
  meta?: TableColumnMeta;
  enableSorting?: boolean;
  cell?: (ctx: {
    row: { original: T; index: number; isExpanded: () => boolean; toggle: () => void };
    column: TableColumnDef<T>;
  }) => JSX.Element;
  [key: string]: any;
}

export interface GroupHeaderInfo<T> {
  value: unknown;
  rows: T[];
  isExpanded: () => boolean;
  toggle: () => void;
}

interface Props<T> {
  data: T[];
  columns: TableColumnDef<T>[];
  initialState?: { sorting?: { id: string; desc: boolean }[]; expanded?: Record<string, boolean> };
  /** Group rows by these column ids (requires enableGrouping). */
  grouping?: string[];
  /** Enables row grouping. */
  enableGrouping?: boolean;
  /** Custom renderer for a full-width group header row. */
  renderGroupHeader?: (group: GroupHeaderInfo<T>) => JSX.Element;
  /** Test id for group header rows, keyed by the grouping value. */
  getGroupRowTestId?: (value: unknown) => string | undefined;
  dataTestId?: string;
  loading?: boolean;
  loadingMessage?: string;
  emptyMessage?: string;
  emptyIcon?: JSX.Element;
  emptyAction?: JSX.Element;
  onRowClick?: (row: T) => void;
  /** Accessible name for the <table> element (e.g. "Market screener results"). */
  ariaLabel?: string;
  getRowClassName?: (row: T) => string | undefined;
  getRowStyle?: (row: T) => CSSProperties | undefined;
  getRowTestId?: (row: T, index: number) => string | undefined;
  /** Extra DOM attributes for each row (e.g. data-* used for external lookup). */
  getRowAttributes?: (row: T, index: number) => Record<string, string | number | undefined>;
  /**
   * Emits the rows in the order they are rendered (after header sorting /
   * grouping) whenever that order changes.
   */
  onSortedRowsChange?: (rows: T[]) => void;
  enableSorting?: boolean;
  /** Third click on a sorted column clears sorting. */
  enableSortingRemoval?: boolean;
  stickyHeader?: boolean;
  className?: string;
  style?: CSSProperties;
  getRowCanExpand?: (row: T) => boolean;
  renderSubComponent?: (row: T) => JSX.Element;
  /** Ultra-dense rows regardless of the global density. */
  dense?: boolean;
  /** Cap the number of mounted rows (virtualization window). */
  rowWindowSize?: number;
  /** When true the table fills its parent's height instead of the 65vh cap. */
  fillContainer?: boolean;
  /** Minimum table width override. Defaults to `max(640, columns * 96)`. */
  minTableWidth?: number;
  /** Opt-in bare mode: skip the outer Paper wrapper. */
  bare?: boolean;
}

const ROW_ESTIMATED = 23;

function getColumnWidth<T>(column: TableColumnDef<T>): number | undefined {
  const size = column.size;
  return typeof size === "number" ? size : undefined;
}

function getColumnMeta<T>(column: TableColumnDef<T>): Partial<TableColumnMeta> {
  return (column.meta as Partial<TableColumnMeta> | undefined) ?? {};
}

function getValue<T>(row: T, column: TableColumnDef<T>): unknown {
  if (column.accessorFn) return column.accessorFn(row);
  if (column.accessorKey) return (row as any)[column.accessorKey];
  return undefined;
}

export function TanStackTable<T>(props: Props<T>) {
  const densityApi = useDensity();
  const isDense = () => props.dense ?? false;
  const isComfortable = () => densityApi.density() === "comfortable";

  // Sizing is written once as CSS variables and read by every cell. Toggling
  // density then repaints through CSS instead of re-rendering rows.
  let tableEl: HTMLTableElement | undefined;
  createEffect(() => {
    const el = tableEl;
    if (!el) return;
    const comfortable = isComfortable();
    const tokens = densityApi.tokens;
    const rowH = isDense() ? 18 : comfortable ? tokens.tableRowHeight : ROW_ESTIMATED;
    el.style.setProperty("--tbl-row-h", `${rowH}px`);
    el.style.setProperty("--tbl-cell-pad", isDense() ? "1px 6px" : comfortable ? tokens.tableCellPad : "2px 8px");
    el.style.setProperty("--tbl-fs", `${isDense() ? 10 : 11}px`);
  });

  const [sorting, setSorting] = createSignal<{ id: string; desc: boolean }[]>(props.initialState?.sorting ?? []);
  const [expandedGroups, setExpandedGroups] = createSignal<Record<string, boolean>>({});
  const [expandedRows, setExpandedRows] = createSignal<Record<string, boolean>>({});

  const visibleColumns = createMemo(() => props.columns.filter((col) => getColumnWidth(col) !== 0));

  const enableSorting = () => props.enableSorting ?? true;
  const enableSortingRemoval = () => props.enableSortingRemoval ?? true;

  const sortedData = createMemo(() => {
    const rows = [...props.data];
    const sorters = sorting();
    if (!enableSorting() || sorters.length === 0) return rows;
    for (let i = sorters.length - 1; i >= 0; i--) {
      const { id, desc } = sorters[i];
      const col = props.columns.find((c) => c.id === id);
      if (!col) continue;
      rows.sort((a, b) => {
        let aVal = getValue(a, col);
        let bVal = getValue(b, col);
        if (typeof aVal === "string" && typeof bVal === "string") {
          return desc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
        }
        const an = aVal == null ? 0 : Number(aVal);
        const bn = bVal == null ? 0 : Number(bVal);
        return desc ? bn - an : an - bn;
      });
    }
    return rows;
  });

  const groups = createMemo(() => {
    if (!props.enableGrouping || !props.grouping?.length) return null;
    const col = props.columns.find((c) => c.id === props.grouping![0]);
    const result: { value: unknown; rows: T[]; baseIndex: number }[] = [];
    let cur: { value: unknown; rows: T[] } | null = null;
    let base = 0;
    for (const row of sortedData()) {
      const v = col ? getValue(row, col) : (row as any)[props.grouping![0]];
      if (cur === null || String(cur.value) !== String(v)) {
        cur = { value: v, rows: [], baseIndex: base };
        result.push(cur);
      }
      cur.rows.push(row);
      base++;
    }
    return result;
  });

  const rowKey = (row: T, index: number) => {
    const testId = props.getRowTestId?.(row, index);
    return testId != null ? testId : String(index);
  };

  // expanded map keys are `columnId:value` (same shape as TanStack's grouping state)
  const groupKey = (value: unknown) =>
    `${props.grouping?.[0] ?? ""}:${String(value)}`;

  const isGroupExpanded = (value: unknown) => {
    const map = expandedGroups();
    const k = groupKey(value);
    if (k in map) return map[k];
    return props.initialState?.expanded?.[k] ?? false;
  };

  const isRowExpanded = (row: T, index: number) => {
    const map = expandedRows();
    const k = rowKey(row, index);
    if (k in map) return map[k];
    return props.initialState?.expanded?.[k] ?? false;
  };

  const toggleSort = (id: string) => {
    setSorting((prev) => {
      const found = prev.find((s) => s.id === id);
      const next = prev.filter((s) => s.id !== id);
      // The clicked column becomes PRIMARY. Pushing it to the end left the
      // previous sorter dominant, so clicking a header could never reorder the
      // table — a header click always means "sort by this".
      if (found) {
        if (enableSortingRemoval() && found.desc) return next;
        next.unshift({ id, desc: !found.desc });
      } else {
        // TanStack's auto-sort contract: text columns sort A→Z first, numeric
        // columns sort biggest-first. Sample the first values to pick.
        let desc = false;
        const col = props.columns.find((c) => c.id === id);
        if (col) {
          let seen = 0;
          let numeric = true;
          for (const row of props.data) {
            if (seen >= 5) break;
            const v = getValue(row, col);
            if (v === null || v === undefined || v === "") continue;
            seen++;
            if (typeof v !== "number") {
              numeric = false;
              break;
            }
          }
          desc = seen > 0 && numeric;
        }
        next.unshift({ id, desc });
      }
      return next;
    });
  };

  createEffect(() => {
    if (props.onSortedRowsChange) props.onSortedRowsChange(sortedData());
  });

  const toggleGroup = (value: unknown) => {
    const k = groupKey(value);
    setExpandedGroups((prev) => ({ ...prev, [k]: !isGroupExpanded(value) }));
  };

  const toggleRow = (row: T, index: number) => {
    const k = rowKey(row, index);
    setExpandedRows((prev) => ({ ...prev, [k]: !isRowExpanded(row, index) }));
  };

  const hasSizedColumns = visibleColumns().some((col) => {
    const w = getColumnWidth(col);
    return w !== undefined && w !== 0;
  });
  const colCount = () => visibleColumns().length;
  const showLoading = () => props.loading && props.data.length === 0;
  const showEmpty = () => !props.loading && props.data.length === 0;
  const emptyMessage = () => props.emptyMessage ?? "No data";

  const tableStyle: CSSProperties = {
    width: "100%",
    "table-layout": hasSizedColumns ? "fixed" : "auto",
    "min-width": `${props.minTableWidth ?? Math.max(640, colCount() * 96)}px`,
    "border-collapse": "collapse",
    "background-color": palette.SURFACE,
    ...props.style,
  };

  const tableClassName = `paper-tanstack-table ${props.className || ""}`;

  const numericColumnIds = createMemo(() => {
    const ids = new Set<string>();
    const sampleRows = sortedData().slice(0, 5);
    if (sampleRows.length > 0) {
      for (const col of visibleColumns()) {
        const values = sampleRows.map((r) => getValue(r, col)).filter((v) => v !== null && v !== undefined && v !== "");
        if (values.length > 0 && values.every((v) => typeof v === "number")) {
          ids.add(col.id);
        }
      }
    }
    return ids;
  });
  const isNumeric = (id: string) => numericColumnIds().has(id);

  const rowStyleBase = (row: T): CSSProperties => ({
    "cursor": props.onRowClick ? "pointer" : undefined,
    ...props.getRowStyle?.(row),
  });

  const cellStyle = (col: TableColumnDef<T>, width: number | undefined): CSSProperties => {
    const { align } = getColumnMeta(col);
    const s: CSSProperties = {
      padding: width === 0 ? "0" : "var(--tbl-cell-pad, 2px 8px)",
      "font-size": "var(--tbl-fs, 11px)",
      "line-height": "1.2",
      "font-variant-numeric": "tabular-nums",
      "white-space": "nowrap",
      height: "var(--tbl-row-h, 23px)",
      "border-bottom": `1px solid ${palette.BORDER}`,
      "background-color": palette.SURFACE,
      width: width !== undefined ? `${width}px` : undefined,
      display: width === 0 ? "none" : undefined,
      "text-align": align ?? (isNumeric(col.id) ? "right" : "left"),
    };
    if (width !== undefined) {
      s.overflow = "hidden";
      s["text-overflow"] = "ellipsis";
    }
    return s;
  };

  const alignClass = (col: TableColumnDef<T>) => {
    const { align } = getColumnMeta(col);
    return (align === "right" || isNumeric(col.id)) ? "font-mono" : "";
  };

  const renderHeader = (col: TableColumnDef<T>) => {
    const width = getColumnWidth(col);
    const isSorted = () => sorting().some((s) => s.id === col.id);
    const sortDir = () => sorting().find((s) => s.id === col.id);
    const headerStyle: CSSProperties = {
      padding: width === 0 ? "0" : "var(--tbl-cell-pad, 2px 8px)",
      height: "var(--tbl-row-h, 23px)",
      "font-size": "var(--tbl-fs, 11px)",
      "line-height": "1.2",
      "font-weight": 600,
      "letter-spacing": "0.02em",
      "font-variant-numeric": "tabular-nums",
      "white-space": "nowrap",
      "user-select": "none",
      color: palette.TEXT_MUTED,
      "border-bottom": `1px solid ${palette.BORDER}`,
      width: width !== undefined ? `${width}px` : undefined,
      display: width === 0 ? "none" : undefined,
      "text-align": getColumnMeta(col).align ?? (isNumeric(col.id) ? "right" : "left"),
      "cursor": col.enableSorting !== false && enableSorting() ? "pointer" : "default",
      position: props.stickyHeader ? "sticky" : undefined,
      top: props.stickyHeader ? 0 : undefined,
      "z-index": props.stickyHeader ? 1 : undefined,
      "background-color": props.stickyHeader ? palette.SURFACE_ALT : undefined,
    };
    const h = col.header;
    const content = typeof h === "function" ? h({ column: col }) : h != null ? <span>{h}</span> : <span>{col.id}</span>;
    return (
      <Box
        component="th"
        
        className="paper-tanstack-header-cell"
        id={`paper-tanstack-header-${String(col.id)}`}
        style={headerStyle}
        onClick={() => col.enableSorting !== false && enableSorting() && toggleSort(col.id)}
      >
        {content}
        {isSorted() && (sortDir()?.desc ? " ▼" : " ▲")}
      </Box>
    );
  };

  const renderSubRow = (row: T, index: number) => {
    if (!props.getRowCanExpand?.(row) || !props.renderSubComponent) return null;
    const expanded = () => isRowExpanded(row, index);
    return (
      <Show when={expanded()}>
        <tr className="paper-tanstack-expanded-row">
          <td colSpan={colCount()} style={{ padding: "0px", "border-top": `1px solid ${palette.BORDER}`, "border-bottom": `1px solid ${palette.BORDER}`, background: palette.BG }}>
            {props.renderSubComponent(row)}
          </td>
        </tr>
      </Show>
    );
  };

  const renderRow = (row: T, index: number) => {
    const k = rowKey(row, index);
    const expanded = () => isRowExpanded(row, index);
    return (
      <>
        <tr
          style={{ ...rowStyleBase(row) }}
          onClick={() => props.onRowClick?.(row)}
          onKeyDown={props.onRowClick ? (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onRowClick!(row); } } : undefined}
          tabIndex={props.onRowClick ? 0 : undefined}
          className={props.getRowClassName?.(row)}
          data-testid={props.getRowTestId?.(row, index)}
          {...props.getRowAttributes?.(row, index)}
          data-row="stock"
        >
          <For each={visibleColumns()}>{(col) => {
            const width = getColumnWidth(col);
            const cell = col.cell
              ? col.cell({ row: { original: row, index, isExpanded: () => expanded, toggle: () => toggleRow(row, index) }, column: col })
              : <span>{String(getValue(row, col))}</span>;
            return (
              <Box
                component="td"
                
                className={`paper-tanstack-cell ${alignClass(col)}`}
                id={`paper-tanstack-cell-${String(col.id)}-${k}`}
                style={cellStyle(col, width)}
              >
                {cell}
              </Box>
            );
          }}</For>
        </tr>
        {renderSubRow(row, index)}
      </>
    );
  };

  const bodyItems = createMemo(() => {
    const items: Array<{ kind: "row"; row: T; index: number } | { kind: "group"; value: unknown; rows: T[]; baseIndex: number }> = [];
    const grps = groups();
    if (grps) {
      for (const g of grps) {
        items.push({ kind: "group", value: g.value, rows: g.rows, baseIndex: g.baseIndex });
        if (isGroupExpanded(g.value)) {
          for (let i = 0; i < g.rows.length; i++) {
            items.push({ kind: "row", row: g.rows[i], index: g.baseIndex + i });
          }
        }
      }
      return items;
    }
    for (let i = 0; i < sortedData().length; i++) {
      items.push({ kind: "row", row: sortedData()[i], index: i });
    }
    return items;
  });

  const visibleItems = createMemo(() => {
    const items = bodyItems();
    return props.rowWindowSize != null ? items.slice(0, props.rowWindowSize) : items;
  });

  const tableScroll = (
    <ScrollArea
      className="paper-tanstack-scroll"
      style={{ flex: 1, "min-height": "0px", overflow: "auto", display: "flex", "flex-direction": "column", "background-color": palette.SURFACE }}
    >
      <Box
        component="table"
        ref={(el: HTMLTableElement) => (tableEl = el)}
        data-testid={props.dataTestId}
        aria-label={props.ariaLabel}
        id={props.dataTestId ? `paper-tanstack-table-${props.dataTestId}` : undefined}
        style={tableStyle}
        className={tableClassName}
      >
        <thead>
          <tr>
            <For each={visibleColumns()}>{renderHeader}</For>
          </tr>
        </thead>
        <tbody>
          <Show
            when={showLoading()}
            fallback={
              <Show
                when={showEmpty()}
                fallback={(
                  <For each={visibleItems()}>{(item) => {
                    if (item.kind === "group") {
                      const expanded = isGroupExpanded(item.value);
                      return (
                        <>
                          <tr
                            data-testid={props.getGroupRowTestId?.(item.value)}
                            onClick={() => toggleGroup(item.value)}
                            style={{ "cursor": "pointer" }}
                            className="paper-tanstack-group-row"
                          >
                            <Box component="td" colSpan={colCount()} style={{ padding: "0px", border: "none" }}>
                              {props.renderGroupHeader?.({
                                value: item.value,
                                rows: item.rows,
                                isExpanded: () => expanded,
                                toggle: () => toggleGroup(item.value),
                              })}
                            </Box>
                          </tr>
                        </>
                      );
                    }
                    return <>{renderRow(item.row, item.index)}</>;
                  }}</For>
                )}
              >
                <tr>
                  <td colSpan={colCount()}>
                    <div className="flex flex-col items-center justify-center py-3">
                      {props.emptyIcon}
                      <div className="text-xs c-dimmed">{emptyMessage()}</div>
                      {props.emptyAction}
                    </div>
                  </td>
                </tr>
              </Show>
            }
          >
            <tr>
              <td colSpan={colCount()}>
                <InlineLoader data-testid="table-loading-state" size="sm" message={props.loadingMessage} />
              </td>
            </tr>
          </Show>
        </tbody>
      </Box>
    </ScrollArea>
  );

  if (props.bare) return tableScroll;

  const containerStyle: CSSProperties = {
    display: "flex",
    "flex-direction": "column",
    overflow: "hidden",
    "border-radius": "8px",
    border: `1px solid ${palette.BORDER}`,
    "background-color": palette.SURFACE,
    "max-height": props.fillContainer ? undefined : "65vh",
    "min-height": props.fillContainer ? 0 : "200px",
    flex: props.fillContainer ? 1 : undefined,
    height: props.fillContainer ? "100%" : undefined,
  };

  return (
    <Paper
      className={`paper-tanstack-container ${props.className || ""}`}
      id={props.dataTestId ? `paper-tanstack-${props.dataTestId}` : undefined}
      style={containerStyle}
    >
      {tableScroll}
    </Paper>
  );
}
