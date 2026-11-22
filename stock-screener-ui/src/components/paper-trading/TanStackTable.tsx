import { For, createEffect, createMemo, createSignal } from "solid-js";
import { ScrollArea, useDensity, Box, Paper } from "@/ui";
import { InlineLoader } from "../common/states";
import * as palette from "@/ui/palette";
import type { JSX } from "solid-js";
type CSSProperties = JSX.CSSProperties;

type BodyItemInput<T> =
  | { kind: "row"; row: T; index: number }
  | { kind: "group"; value: unknown; rows: T[]; baseIndex: number };
type BodyItem<T> = BodyItemInput<T> & { key: string };

/**
 * Column-level metadata understood by TanStackTable.
 * Usage: `meta: { align: "right" }` on a ColumnDef.
 */
export interface TableColumnMeta {
  align?: "left" | "center" | "right";
}

/** A single sort directive: column id + direction. */
export interface SortEntry {
  id: string;
  desc: boolean;
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
  initialState?: { sorting?: SortEntry[]; expanded?: Record<string, boolean> };
  /** Initial sorting for an uncontrolled table (fallback when initialState.sorting is absent). */
  initialSorting?: SortEntry[];
  /** Controlled sorting source. When supplied, rendering follows it and only onSortingChange mutates it. */
  sorting?: SortEntry[];
  /** Emitted on every sort change, in both controlled and uncontrolled modes. */
  onSortingChange?: (next: SortEntry[]) => void;
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
  /** Stable row identity. Reused to keep the row DOM element across data ticks. */
  getRowKey?: (row: T, index: number) => string | number;
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
  /** Accepted for API compatibility (this build renders all rows). */
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

// Live ticks replace position objects wholesale. Comparing their flat fields
// lets an unchanged row keep its DOM node while a changed row still re-renders.
function shallowEqualValues(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  const aKeys = Object.keys(a as object);
  if (aKeys.length !== Object.keys(b as object).length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }
  return true;
}

function sameBodyItem<T>(prev: BodyItem<T>, next: BodyItemInput<T>): boolean {
  if (prev.kind !== next.kind) return false;
  if (prev.kind === "row" && next.kind === "row") {
    return prev.index === next.index && shallowEqualValues(prev.row, next.row);
  }
  if (prev.kind === "group" && next.kind === "group") {
    return (
      prev.value === next.value &&
      prev.baseIndex === next.baseIndex &&
      shallowEqualValues(prev.rows, next.rows)
    );
  }
  return false;
}

/**
 * Missing values and NaN are not zeros — they trail in both directions. A null
 * sorted as 0 read as "mid-pack" for signed metrics and "best" for negatives.
 */
function compareSortValues(aVal: unknown, bVal: unknown, desc: boolean): number {
  const aMissing = aVal === null || aVal === undefined || aVal === "";
  const bMissing = bVal === null || bVal === undefined || bVal === "";
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return 0;
    return aMissing ? 1 : -1;
  }
  if (typeof aVal === "string" && typeof bVal === "string") {
    return desc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
  }
  const an = Number(aVal);
  const bn = Number(bVal);
  const aNaN = Number.isNaN(an);
  const bNaN = Number.isNaN(bn);
  if (aNaN || bNaN) {
    if (aNaN && bNaN) return 0;
    return aNaN ? 1 : -1;
  }
  return desc ? bn - an : an - bn;
}

export function TanStackTable<T>(props: Props<T>) {
  const { density, tokens: densityTokens } = useDensity();
  const isComfortable = createMemo(() => density() === "comfortable");
  const rowEstimated = () => (props.dense ? 18 : isComfortable() ? densityTokens.tableRowHeight : ROW_ESTIMATED);
  const cellPad = () => (props.dense ? "1px 6px" : isComfortable() ? densityTokens.tableCellPad : "2px 8px");
  const cellFontSize = () => (props.dense ? 10 : 11);
  const headerHeight = () => (props.dense ? 20 : isComfortable() ? densityTokens.tableRowHeight : ROW_ESTIMATED);

  const [internalSorting, setInternalSorting] = createSignal<SortEntry[]>(
    props.initialState?.sorting ?? props.initialSorting ?? [],
  );
  const isSortControlled = () => props.sorting != null;
  const sorting = (): SortEntry[] => (isSortControlled() ? props.sorting! : internalSorting());
  // Controlled mode renders from props and persists only through the callback;
  // uncontrolled mode keeps the signal but still emits so callers can observe.
  const commitSorting = (next: SortEntry[]) => {
    if (!isSortControlled()) setInternalSorting(next);
    props.onSortingChange?.(next);
  };
  const [expandedGroups, setExpandedGroups] = createSignal<Record<string, boolean>>({});
  const [expandedRows, setExpandedRows] = createSignal<Record<string, boolean>>({});

  const visibleColumns = createMemo(() => props.columns.filter((col) => getColumnWidth(col) !== 0));

  // Default ON, matching the common table. Gating directly on
  // `props.enableSorting` meant every consumer that didn't pass the flag
  // (positions, trade history, activity feed, replay log, aggregated
  // dashboard) had sorting silently disabled.
  const enableSorting = () => props.enableSorting ?? true;

  const sortedData = createMemo(() => {
    const rows = [...props.data];
    const sorters = sorting();
    if (!enableSorting() || sorters.length === 0) return rows;
    for (let i = sorters.length - 1; i >= 0; i--) {
      const { id, desc } = sorters[i];
      const col = props.columns.find((c) => c.id === id);
      if (!col) continue;
      rows.sort((a, b) => compareSortValues(getValue(a, col), getValue(b, col), desc));
    }
    return rows;
  });

  const groups = createMemo(() => {
    if (!props.enableGrouping || !props.grouping?.length) return null;
    const col = props.columns.find((c) => c.id === props.grouping![0]);
    const result: { value: unknown; rows: T[]; baseIndex: number }[] = [];
    let cur: { value: unknown; rows: T[]; baseIndex: number } | null = null;
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
    const key = props.getRowKey?.(row, index) ?? props.getRowTestId?.(row, index);
    return key != null ? String(key) : String(index);
  };

  const groupKey = (value: unknown) => String(value);

  const isGroupExpanded = (value: unknown) => {
    const map = expandedGroups();
    const k = groupKey(value);
    if (k in map) return map[k];
    return props.initialState?.expanded?.[k] ?? true;
  };

  const isRowExpanded = (row: T, index: number) => {
    const map = expandedRows();
    const k = rowKey(row, index);
    if (k in map) return map[k];
    return props.initialState?.expanded?.[k] ?? false;
  };

  const enableSortingRemoval = () => props.enableSortingRemoval ?? true;

  // TanStack's first-click contract, shared with the common table: text sorts
  // A→Z first, numeric biggest-first. Sample up to 5 non-null values so a few
  // missing cells cannot flip the column's type.
  const descFirst = (col: TableColumnDef<T> | undefined): boolean => {
    if (!col) return false;
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
    return seen > 0 && numeric;
  };

  const toggleSort = (id: string) => {
    const prev = sorting();
    const found = prev.find((s) => s.id === id);
    const next = prev.filter((s) => s.id !== id);
    const col = props.columns.find((c) => c.id === id);
    // The clicked column becomes PRIMARY: a header click always means "sort by
    // this". Appending it left the previous sorter dominant, so a second header
    // click appeared to do nothing.
    if (found) {
      // Flip on the second click; only the third clears (numeric desc→asc→none,
      // text asc→desc→none). Without removal, bounce between the two directions.
      if (found.desc !== descFirst(col) && enableSortingRemoval()) {
        commitSorting(next);
        return;
      }
      next.unshift({ id, desc: !found.desc });
    } else {
      next.unshift({ id, desc: descFirst(col) });
    }
    commitSorting(next);
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

  const hasSizedColumns = createMemo(() =>
    visibleColumns().some((col) => {
      const w = getColumnWidth(col);
      return w !== undefined && w !== 0;
    }),
  );
  const colCount = createMemo(() => visibleColumns().length);
  const showLoading = () => props.loading === true && props.data.length === 0;
  const showEmpty = () => !props.loading && props.data.length === 0;

  const tableStyle: CSSProperties = {
    width: "100%",
    "table-layout": hasSizedColumns() ? "fixed" : "auto",
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

  const rowStyleBase = (row: T): CSSProperties => ({
    "cursor": props.onRowClick ? "pointer" : undefined,
    ...props.getRowStyle?.(row),
  });

  const cellStyle = (col: TableColumnDef<T>, width: number | undefined): CSSProperties => {
    const { align } = getColumnMeta(col);
    const s: CSSProperties = {
      padding: width === 0 ? "0" : cellPad(),
      "font-size": `${cellFontSize()}px`,
      "line-height": 1.2,
      "font-variant-numeric": "tabular-nums",
      "white-space": "nowrap",
      height: `${rowEstimated()}px`,
      "border-bottom": `1px solid ${palette.BORDER}`,
      "background-color": palette.SURFACE,
      width: width !== undefined ? `${width}px` : undefined,
      "display": width === 0 ? "none" : undefined,
      "text-align": align ?? (numericColumnIds().has(col.id) ? "right" : "left"),
    };
    if (width !== undefined) {
      s.overflow = "hidden";
      s["text-overflow"] = "ellipsis";
    }
    return s;
  };

  const alignClass = (col: TableColumnDef<T>) => {
    const { align } = getColumnMeta(col);
    return (align === "right" || numericColumnIds().has(col.id)) ? "font-mono" : "";
  };

  const renderHeader = (col: TableColumnDef<T>) => {
    const width = getColumnWidth(col);
    const sortable = () => col.enableSorting !== false && enableSorting();
    const isSorted = () => sorting().some((s) => s.id === col.id);
    const sortDir = () => sorting().find((s) => s.id === col.id);
    const ariaSort = () => {
      if (!sortable()) return undefined;
      if (!isSorted()) return "none";
      return sortDir()?.desc ? "descending" : "ascending";
    };
    const headerStyle: CSSProperties = {
      padding: width === 0 ? "0" : cellPad(),
      height: `${headerHeight()}px`,
      "font-size": `${cellFontSize()}px`,
      "line-height": 1.2,
      "font-weight": 600,
      "font-variant-numeric": "tabular-nums",
      "white-space": "nowrap",
      "user-select": "none",
      color: palette.TEXT_MUTED,
      "border-bottom": `1px solid ${palette.BORDER}`,
      width: width !== undefined ? `${width}px` : undefined,
      "display": width === 0 ? "none" : undefined,
      "text-align": getColumnMeta(col).align ?? (numericColumnIds().has(col.id) ? "right" : "left"),
      "cursor": col.enableSorting !== false && enableSorting() ? "pointer" : "default",
      "position": props.stickyHeader ? "sticky" : undefined,
      "top": props.stickyHeader ? 0 : undefined,
      "z-index": props.stickyHeader ? 1 : undefined,
    };
    const h = col.header;
    const content = typeof h === "function" ? h({ column: col }) : h != null ? <span>{h}</span> : <span>{col.id}</span>;
    return (
      <Box
        component="th"
        className="paper-tanstack-header-cell"
        id={`paper-tanstack-header-${String(col.id)}`}
        style={headerStyle}
        tabIndex={sortable() ? 0 : undefined}
        aria-sort={ariaSort()}
        onClick={() => sortable() && toggleSort(col.id)}
        onKeyDown={sortable() ? (event: KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleSort(col.id);
          }
        } : undefined}
      >
        {content}
        {isSorted() && (sortDir()?.desc ? " ▼" : " ▲")}
      </Box>
    );
  };

  const renderSubRow = (row: T, index: number) => {
    const expanded = isRowExpanded(row, index);
    if (!props.getRowCanExpand?.(row) || !expanded || !props.renderSubComponent) return null;
    return (
      <tr className="paper-tanstack-expanded-row">
        <td colSpan={colCount()} style={{ padding: 0, "border-top": `1px solid ${palette.BORDER}`, "border-bottom": `1px solid ${palette.BORDER}`, "background": palette.BG }}>
          {props.renderSubComponent(row)}
        </td>
      </tr>
    );
  };

  const renderRow = (row: T, index: number) => {
    const k = rowKey(row, index);
    const expanded = isRowExpanded(row, index);
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

  // <For> keys by reference, so handing it fresh wrappers on every store tick
  // remounts every row. Reuse a wrapper when its stable-keyed row is value-equal;
  // changed rows get a new wrapper and render through the normal path.
  const itemCache = new Map<string, BodyItem<T>>();
  const bodyItems = createMemo(() => {
    const items: BodyItem<T>[] = [];
    const usedKeys = new Set<string>();
    const occurrences = new Map<string, number>();

    const push = (item: BodyItemInput<T>, baseKey: string) => {
      const seen = occurrences.get(baseKey) ?? 0;
      occurrences.set(baseKey, seen + 1);
      const key = seen === 0 ? baseKey : `${baseKey}#${seen}`;
      usedKeys.add(key);
      const prev = itemCache.get(key);
      if (prev && sameBodyItem(prev, item)) {
        items.push(prev);
        return;
      }
      const next = { ...item, key } as BodyItem<T>;
      itemCache.set(key, next);
      items.push(next);
    };

    const grps = groups();
    if (grps) {
      for (const g of grps) {
        push(
          { kind: "group", value: g.value, rows: g.rows, baseIndex: g.baseIndex },
          `group:${groupKey(g.value)}`,
        );
        if (isGroupExpanded(g.value)) {
          for (let i = 0; i < g.rows.length; i++) {
            const row = g.rows[i];
            const index = g.baseIndex + i;
            push({ kind: "row", row, index }, `row:${rowKey(row, index)}`);
          }
        }
      }
    } else {
      const rows = sortedData();
      for (let i = 0; i < rows.length; i++) {
        push({ kind: "row", row: rows[i], index: i }, `row:${rowKey(rows[i], i)}`);
      }
    }

    for (const key of itemCache.keys()) {
      if (!usedKeys.has(key)) itemCache.delete(key);
    }
    return items;
  });

  const tableScroll = (
    <ScrollArea
      className="paper-tanstack-scroll"
      style={{ flex: 1, "min-height": 0, "overflow": "auto", "display": "flex", "flex-direction": "column", "background-color": palette.SURFACE }}
    >
      <Box
        component="table"
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
          {showLoading() ? (
            <tr>
              <td colSpan={colCount()}>
                <InlineLoader data-testid="table-loading-state" size="sm" message={props.loadingMessage} />
              </td>
            </tr>
          ) : showEmpty() ? (
            <tr>
              <td colSpan={colCount()}>
                <div className="flex flex-col items-center justify-center py-3">
                  {props.emptyIcon}
                  {props.emptyMessage && <div className="text-xs c-dimmed">{props.emptyMessage}</div>}
                  {props.emptyAction}
                </div>
              </td>
            </tr>
          ) : (
            <For each={bodyItems()}>{(item) => {
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
                      <Box component="td" colSpan={colCount()} style={{ padding: 0, border: "none" }}>
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
        </tbody>
      </Box>
    </ScrollArea>
  );

  if (props.bare) return tableScroll;

  const containerStyle: CSSProperties = {
    "display": "flex",
    "flex-direction": "column",
    "overflow": "hidden",
    "border-radius": "8px",
    border: `1px solid ${palette.BORDER}`,
    "background-color": palette.SURFACE,
    "max-height": props.fillContainer ? undefined : "65vh",
    "min-height": props.fillContainer ? "0px" : "200px",
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
