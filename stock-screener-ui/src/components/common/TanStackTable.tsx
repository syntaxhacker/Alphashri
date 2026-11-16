import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Box, Button, Paper, ScrollArea, ToolbarRow, useDensity } from "@/ui";
import { InlineLoader } from "./states";
import { ColumnPicker, type ColumnPickerItem } from "./ColumnPicker";
import * as palette from "@/ui/palette";
import type { Accessor, JSX } from "solid-js";

// `solid-js` does not re-export JSX.CSSProperties from its package root.
type CSSProperties = JSX.CSSProperties;

/** A single sort directive: column id + direction. */
export interface SortEntry {
  id: string;
  desc: boolean;
}


/**
 * Column-level metadata understood by TanStackTable.
 * Usage: `meta: { align: "right" }` on a ColumnDef.
 */
export interface TableColumnMeta {
  align?: "left" | "center" | "right";
}

/** Persisted shape of a table's column layout. `[]` means "declared default". */
export interface ColumnPrefs {
  order: string[];
  hidden: string[];
}

export interface ResolvedColumnPrefs {
  /** Every known id, in display order. */
  order: string[];
  /** Known + hideable ids only. */
  hidden: string[];
  /** Ids that render, in display order. Never empty for a non-empty table. */
  visible: string[];
}

/**
 * Merge saved prefs onto the live column declarations.
 *
 * `order` is advisory: unknown ids are dropped, known ids keep their saved
 * position and columns added since the config was saved are appended in their
 * declared order — so a new column can never be hidden by an older config.
 * `hidden` is intersected with known ids and with the lockable set.
 *
 * The last step is the reachability guard: if a config hides every column, the
 * locked column (or else the first in display order) is forced visible rather
 * than rendering a table with no columns.
 */
export function resolveColumnPrefs(
  columnIds: string[],
  prefs: ColumnPrefs | undefined,
  lockVisible: string[] = [],
): ResolvedColumnPrefs {
  const known = new Set(columnIds);
  const order: string[] = [];
  const placed = new Set<string>();
  for (const id of prefs?.order ?? []) {
    if (!known.has(id) || placed.has(id)) continue;
    placed.add(id);
    order.push(id);
  }
  for (const id of columnIds) {
    if (placed.has(id)) continue;
    placed.add(id);
    order.push(id);
  }

  const locked = new Set(lockVisible.filter((id) => known.has(id)));
  const hiddenSet = new Set<string>();
  for (const id of prefs?.hidden ?? []) {
    if (!known.has(id) || locked.has(id)) continue;
    hiddenSet.add(id);
  }

  let visible = order.filter((id) => !hiddenSet.has(id));
  if (visible.length === 0 && order.length > 0) {
    // A table with no columns is not a table. Prefer the identity column; fall
    // back to the first column in display order when no lock was declared.
    const keeper = order.find((id) => locked.has(id)) ?? order[0];
    hiddenSet.delete(keeper);
    visible = order.filter((id) => !hiddenSet.has(id));
  }

  return { order, hidden: order.filter((id) => hiddenSet.has(id)), visible };
}

/** The picker needs text; a JSX/function header has none. */
function columnLabel<T>(column: TableColumnDef<T>): string {
  const header = column.header;
  return typeof header === "string" && header.trim() !== "" ? header : column.id;
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
  /** Extra DOM attributes for each row (e.g. data-* used for external lookup). */
  getRowAttributes?: (row: T, index: number) => Record<string, string | number | undefined>;
  /**
   * Emits the rows in the order they are rendered (after header sorting /
   * grouping) whenever that order changes.
   */
  onSortedRowsChange?: (rows: T[]) => void;
  /**
   * Emits the rows currently mounted in the virtualization window, once per
   * real window change (length or first/last row). Callers use this to fetch
   * supplementary data for exactly what is on screen — never for all rows.
   */
  onVisibleRowsChange?: (rows: T[]) => void;
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
  /**
   * Reserved scope key for the saved-config store (e.g. `table.market`).
   * Column controls are driven by `columnPrefs`; nothing here fetches or
   * persists. It surfaces as `data-table-id` on the toolbar so a later task (or
   * an E2E spec) can address this table's preferences unambiguously.
   */
  tableId?: string;
  /** Opt-in column visibility + order picker. Off by default. */
  enableColumnControls?: boolean;
  columnPrefs?: ColumnPrefs;
  onColumnPrefsChange?: (prefs: ColumnPrefs) => void;
  /** Columns that cannot be hidden; the picker shows them disabled. */
  lockVisible?: string[];
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
  const densityApi = useDensity();
  const isDense = () => props.dense ?? false;
  const isComfortable = () => densityApi.density() === "comfortable";

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

  const [internalSorting, setInternalSorting] = createSignal<SortEntry[]>(
    props.initialState?.sorting ?? props.initialSorting ?? [],
  );
  const isSortControlled = () => props.sorting != null;
  const sorting = (): SortEntry[] => (isSortControlled() ? props.sorting! : internalSorting());
  const commitSorting = (next: SortEntry[]) => {
    if (!isSortControlled()) setInternalSorting(next);
    props.onSortingChange?.(next);
  };
  const [expandedGroups, setExpandedGroups] = createSignal<Record<string, boolean>>({});
  const [expandedRows, setExpandedRows] = createSignal<Record<string, boolean>>({});

  /** Declared columns that are not visibility-spacers (`size: 0`). */
  const declaredColumns = createMemo(() => props.columns.filter((col) => getColumnWidth(col) !== 0));
  const declaredIds = createMemo(() => declaredColumns().map((col) => col.id));

  // One pass per prefs/columns change — never per row. Cell rendering reads
  // `visibleColumns()` inside `<For>`, which only re-runs when this memo's
  // identity changes.
  const columnPrefsResolved = createMemo(() =>
    resolveColumnPrefs(
      declaredIds(),
      // Inert unless the table opted in: a caller that passes prefs but leaves
      // `enableColumnControls` off keeps the historical declared layout.
      props.enableColumnControls ? props.columnPrefs : undefined,
      props.enableColumnControls ? props.lockVisible : undefined,
    ),
  );

  const columnsById = createMemo(() => new Map(declaredColumns().map((col) => [col.id, col])));

  const visibleColumns = createMemo(() => {
    const byId = columnsById();
    const out: TableColumnDef<T>[] = [];
    for (const id of columnPrefsResolved().visible) {
      const col = byId.get(id);
      if (col) out.push(col);
    }
    return out;
  });

  const emitPrefs = (next: ColumnPrefs) => props.onColumnPrefsChange?.(next);

  /**
   * Emits `order: []` when the layout still matches the declared order. Storing
   * an explicit copy of today's order would freeze it: a later redesign that
   * reorders the default columns would be silently overridden by a config the
   * user never consciously set. `[]` means "no opinion", which is the truth.
   */
  const prefsForEmit = (order: string[], hiddenIds: string[]): ColumnPrefs => {
    const declared = declaredIds();
    const sameOrder = order.length === declared.length && order.every((id, i) => id === declared[i]);
    return { order: sameOrder ? [] : order, hidden: hiddenIds };
  };

  const toggleColumnPref = (id: string, visible: boolean) => {
    const current = columnPrefsResolved();
    const hidden = new Set(current.hidden);
    if (visible) hidden.delete(id);
    else hidden.add(id);
    emitPrefs(
      prefsForEmit(
        current.order,
        current.order.filter((cid) => hidden.has(cid)),
      ),
    );
  };

  const moveColumnPref = (from: number, to: number) => {
    const order = [...columnPrefsResolved().order];
    if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return;
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    emitPrefs(prefsForEmit(order, [...columnPrefsResolved().hidden]));
  };

  const resetColumnPrefs = () => emitPrefs({ order: [], hidden: [] });

  const columnPickerItems = createMemo<ColumnPickerItem[]>(() => {
    const resolved = columnPrefsResolved();
    const byId = columnsById();
    const hidden = new Set(resolved.hidden);
    const locked = new Set(props.lockVisible ?? []);
    return resolved.order.map((id) => {
      const col = byId.get(id);
      return {
        id,
        label: col ? columnLabel(col) : id,
        visible: !hidden.has(id),
        locked: locked.has(id),
      };
    });
  });

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
    const testId = props.getRowTestId?.(row, index);
    return testId != null ? testId : String(index);
  };

  // expanded map keys are `columnId:value` (same shape as TanStack's grouping state)
  const groupKey = (value: unknown) =>
    `${props.grouping?.[0] ?? ""}:${String(value)}`;

  type RowFrame = { row: T; index: number };
  type GroupFrame = { value: unknown; rows: T[]; baseIndex: number };
  type RowSlot = { kind: "row"; key: string; frame: Accessor<RowFrame>; set: (next: RowFrame) => void };
  type GroupSlot = { kind: "group"; key: string; frame: Accessor<GroupFrame>; set: (next: GroupFrame) => void };
  type BodySlot = RowSlot | GroupSlot;

  // TanStack rebuilds every row object on each data change, and `<For>` keys by
  // reference — so one filter click disposed and re-created all mounted rows
  // (~450 ms at 80 rows x 14 columns, dominated by mergeProps/splitProps/
  // cleanNode). A slot is the stable identity `<For>` keys on: it owns the
  // current frame and its cells read it reactively, so an unchanged key keeps
  // its `<tr>` and only cells that read a changed field update.
  const rowSlots = new Map<string, RowSlot>();
  const groupSlots = new Map<string, GroupSlot>();

  const sameRowFrame = (a: RowFrame, b: RowFrame) => a.row === b.row && a.index === b.index;
  const sameGroupFrame = (a: GroupFrame, b: GroupFrame) =>
    a.value === b.value && a.rows === b.rows && a.baseIndex === b.baseIndex;

  const ensureRowSlot = (row: T, index: number, seen: Set<string>): RowSlot => {
    const base = rowKey(row, index);
    // A consumer that returns one test id for many rows must not collapse them
    // into a single slot (the OI table did: "nifty-strike-row" for every strike).
    const key = seen.has(base) ? `${base}#${index}` : base;
    seen.add(key);
    const existing = rowSlots.get(key);
    if (existing) {
      existing.set({ row, index });
      return existing;
    }
    const [frame, set] = createSignal<RowFrame>({ row, index }, { equals: sameRowFrame });
    const slot: RowSlot = { kind: "row", key, frame, set };
    rowSlots.set(key, slot);
    return slot;
  };

  const ensureGroupSlot = (value: unknown, rows: T[], baseIndex: number): GroupSlot => {
    const key = groupKey(value);
    const existing = groupSlots.get(key);
    if (existing) {
      existing.set({ value, rows, baseIndex });
      return existing;
    }
    const [frame, set] = createSignal<GroupFrame>({ value, rows, baseIndex }, { equals: sameGroupFrame });
    const slot: GroupSlot = { kind: "group", key, frame, set };
    groupSlots.set(key, slot);
    return slot;
  };

  // Keeps the registry bounded by the live row set. Deleting a slot only costs a
  // re-mount for a row that is about to unmount anyway.
  const pruneSlots = (items: BodySlot[]) => {
    if (rowSlots.size > items.length * 2 + 64) {
      const live = new Set(items.map((item) => `${item.kind}:${item.key}`));
      for (const key of rowSlots.keys()) if (!live.has(`row:${key}`)) rowSlots.delete(key);
      for (const key of groupSlots.keys()) if (!live.has(`group:${key}`)) groupSlots.delete(key);
    }
  };

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

  // TanStack's first-click contract: text columns sort A→Z first, numeric
  // columns biggest-first. Sample the first values; shared by both the "new
  // column" and "flip vs clear" paths so they can never disagree.
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
    // The clicked column becomes PRIMARY. Pushing it to the end left the
    // previous sorter dominant, so clicking a header could never reorder the
    // table — a header click always means "sort by this".
    if (found) {
      // First click descends for numbers / ascends for text. The second flips
      // the direction; only the third clears — flipping on desc was the bug
      // that made ascending unreachable on numeric columns.
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
  const colCount = () => visibleColumns().length;
  const showLoading = () => props.loading && props.data.length === 0;
  const showEmpty = () => !props.loading && props.data.length === 0;
  const emptyMessage = () => props.emptyMessage ?? "No data";

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
  }, undefined, {
    // A data swap rebuilds the sample but the columns' numeric-ness usually does
    // not change. Without this, the fresh Set identity re-ran every cell's style
    // effect (80 rows x 14 columns) on each filter click.
    equals: (a, b) => a.size === b.size && [...a].every((id) => b.has(id)),
  });
  const isNumeric = (id: string) => numericColumnIds().has(id);

  const rowStyleBase = (row: T): CSSProperties => ({
    "cursor": props.onRowClick ? "pointer" : undefined,
    // Deliberately no inline surface: an inline background-color outranks every
    // `:hover` rule, which is why hover never painted on the row. The surface is
    // declared in style.css on `tr[data-row="stock"]`, so hover can win; an
    // inline tint from `getRowStyle` still outranks CSS, so selection wins over
    // hover. Cells inherit the resolved row background.
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
      "border-bottom": "1px solid var(--color-fin-border)",
      // Deliberately `background-color: inherit` for the base case: a cell that
      // paints its own opaque surface covers whatever `getRowStyle` put on the
      // <tr>, which is why the selected row (and every hover tint) was invisible.
      "background-color": "inherit",
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
    const dir = align === "right" || align === "center" ? align : "left";
    return `text-${dir} ${dir === "right" || isNumeric(col.id) ? "font-mono tabular-nums" : ""}`;
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
      "user-select": "none",
      color: "var(--color-fin-primary)",
      "border-bottom": "1px solid var(--color-fin-border)",
      width: width !== undefined ? `${width}px` : undefined,
      display: width === 0 ? "none" : undefined,
      "text-align": getColumnMeta(col).align ?? (isNumeric(col.id) ? "right" : "left"),
      "cursor": sortable() ? "pointer" : "default",
      position: props.stickyHeader ? "sticky" : undefined,
      top: props.stickyHeader ? 0 : undefined,
      "z-index": props.stickyHeader ? 1 : undefined,
      "background-color": props.stickyHeader ? "var(--color-fin-surface-alt)" : undefined,
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
      </th>
    );
  };

  const renderSubRow = (row: Accessor<T>, index: Accessor<number>) => {
    const shows = () => props.renderSubComponent != null && props.getRowCanExpand?.(row()) === true;
    return (
      <Show when={shows() && isRowExpanded(row(), index())}>
        <tr className="paper-tanstack-expanded-row">
          <td colSpan={colCount()} style={{ padding: "0px", "border-top": "1px solid var(--color-fin-border)", "border-bottom": "1px solid var(--color-fin-border)", background: "var(--color-fin-bg)" }}>
            {props.renderSubComponent?.(row())}
          </td>
        </tr>
      </Show>
    );
  };

  const renderRow = (item: RowSlot) => {
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
          style={{ ...rowStyleBase(row()) }}
          onClick={() => props.onRowClick?.(row())}
          onKeyDown={props.onRowClick ? (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onRowClick!(row()); } } : undefined}
          tabIndex={props.onRowClick ? 0 : undefined}
          className={props.getRowClassName?.(row())}
          data-testid={props.getRowTestId?.(row(), index())}
          {...props.getRowAttributes?.(row(), index())}
          data-clickable={props.onRowClick ? "true" : undefined}
          data-row="stock"
        >
          <For each={visibleColumns()}>{(col) => {
            const width = getColumnWidth(col);
            const cell = () => {
              const r = row();
              const i = index();
              return col.cell
                ? col.cell({ row: { original: r, index: i, isExpanded: () => isRowExpanded(r, i), toggle: () => toggleRow(r, i) }, column: col })
                : <span>{String(getValue(r, col))}</span>;
            };
            return (
              <Box
                component="td"
                className={`paper-tanstack-cell ${alignClass(col)}`}
                id={`paper-tanstack-cell-${String(col.id)}-${k}`}
                style={cellStyle(col, width)}
              >
                {cell()}
              </Box>
            );
          }}</For>
        </tr>
        {renderSubRow(row, index)}
      </>
    );
  };

  const bodyItems = createMemo(() => {
    const items: BodySlot[] = [];
    const seen = new Set<string>();
    const grps = groups();
    if (grps) {
      for (const g of grps) {
        items.push(ensureGroupSlot(g.value, g.rows, g.baseIndex));
        if (isGroupExpanded(g.value)) {
          for (let i = 0; i < g.rows.length; i++) {
            items.push(ensureRowSlot(g.rows[i], g.baseIndex + i, seen));
          }
        }
      }
    } else {
      const rows = sortedData();
      for (let i = 0; i < rows.length; i++) items.push(ensureRowSlot(rows[i], i, seen));
    }
    pruneSlots(items);
    return items;
  });

  const windowBase = () => {
    const size = props.rowWindowSize;
    return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : Number.POSITIVE_INFINITY;
  };
  // `rowWindowSize` seeds the window; it is not a hard cap. `Load more` grows
  // this signal by one page until the whole set is mounted.
  const [visibleCount, setVisibleCount] = createSignal(windowBase());

  // Collapse back to one page on any change that reshapes the set. Without the
  // sort/column triggers a filtered or re-sorted set could inherit a window
  // grown to hundreds of rows by an earlier interaction.
  createEffect(() => {
    const data = props.data;
    void data.length;
    void sorting();
    void visibleColumns();
    setVisibleCount(windowBase());
  });

  const visibleItems = createMemo(() => {
    const items = bodyItems();
    return items.slice(0, Math.min(visibleCount(), items.length));
  });

  // One callback per window change, never per row — a single effect that
  // compares the mounted row identities. The snapshot's row objects are stable
  // references, so a re-sort or filter fires exactly once while a cell update
  // on an unchanged window fires nothing. Edges-only comparison would miss a
  // window whose middle rows changed and silently starve a symbol-keyed
  // consumer; the full sequence is ~80 reference compares, not 80 effects.
  let lastVisible: T[] = [];
  createEffect(() => {
    if (!props.onVisibleRowsChange) return;
    const rows: T[] = [];
    for (const item of visibleItems()) {
      if (item.kind === "row") rows.push(item.frame().row);
    }
    const same =
      rows.length === lastVisible.length && rows.every((row, i) => row === lastVisible[i]);
    if (same) return;
    lastVisible = rows;
    props.onVisibleRowsChange(rows);
  });

  const loadMore = () => {
    const total = bodyItems().length;
    const step = Number.isFinite(windowBase()) ? windowBase() : total;
    setVisibleCount((n) => Math.min(n + step, total));
  };

  const hiddenCount = createMemo(() => {
    const total = bodyItems().length;
    const shown = visibleItems().length;
    return total > shown ? total - shown : 0;
  });

  const tableScroll = (
    <>
      <Show when={props.enableColumnControls}>
        <ToolbarRow
          justify="flex-end"
          wrap={false}
          className="px-2 shrink-0 border-b border-fin-border bg-fin-surface"
          style={{ height: "26px" }}
          data-testid="table-column-controls"
        >
          <ColumnPicker
            items={columnPickerItems()}
            tableId={props.tableId}
            onMove={moveColumnPref}
            onToggle={toggleColumnPref}
            onReset={resetColumnPrefs}
          />
        </ToolbarRow>
      </Show>
      <ScrollArea
        className="paper-tanstack-scroll"
        style={{ flex: 1, "min-height": "0px", overflow: "auto", display: "flex", "flex-direction": "column", "background-color": "var(--color-fin-surface)" }}
      >
        <table
          ref={(el: HTMLTableElement) => (tableEl = el)}
          data-testid={props.dataTestId}
          aria-label={props.ariaLabel}
          id={props.dataTestId ? `paper-tanstack-table-${props.dataTestId}` : undefined}
          style={tableStyle()}
          className={tableClassName()}
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
                      const frame = item.frame;
                      const expanded = () => isGroupExpanded(frame().value);
                      return (
                        <tr
                          data-testid={props.getGroupRowTestId?.(frame().value)}
                          onClick={() => toggleGroup(frame().value)}
                          style={{ "cursor": "pointer" }}
                          className="paper-tanstack-group-row"
                        >
                          <Box component="td" colSpan={colCount()} style={{ padding: "0px", border: "none" }}>
                            {props.renderGroupHeader?.({
                              value: frame().value,
                              rows: frame().rows,
                              isExpanded: expanded,
                              toggle: () => toggleGroup(frame().value),
                            })}
                          </Box>
                        </tr>
                      );
                    }
                    return renderRow(item);
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
      </table>
      </ScrollArea>
      <Show when={hiddenCount() > 0}>
        <div
          class="flex items-center justify-between gap-2 px-2 h-[22px] shrink-0 border-t border-fin-border text-[10px] text-fin-text-muted font-mono tabular-nums"
          data-testid="table-window-footer"
        >
          <span>
            showing {visibleItems().length} of {bodyItems().length} · {hiddenCount()} not rendered
          </span>
          <Button
            size="xs"
            variant="subtle"
            data-testid="table-load-more"
            style={{ height: "20px" }}
            class="shrink-0"
            onClick={loadMore}
          >
            Load more
          </Button>
        </div>
      </Show>
    </>
  );

  if (props.bare) return tableScroll;

  const containerStyle: CSSProperties = {
    display: "flex",
    "flex-direction": "column",
    overflow: "hidden",
    "border-radius": "2px",
    border: "1px solid var(--color-fin-border)",
    "background-color": "var(--color-fin-surface)",
    "max-height": props.fillContainer ? undefined : "65vh",
    "min-height": props.fillContainer ? 0 : "200px",
    flex: props.fillContainer ? "1 1 0%" : undefined,
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
