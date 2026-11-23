import type { Accessor, JSX } from "solid-js";

// `solid-js` does not re-export JSX.CSSProperties from its package root.
export type CSSProperties = JSX.CSSProperties;

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
  /**
   * A column that exists in the picker but is not part of the default layout.
   * The picker can turn it on; reset returns it to hidden.
   */
  defaultHidden?: boolean;
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

export interface TableProps<T> {
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

export interface RowFrame<T> {
  row: T;
  index: number;
}

export interface GroupFrame<T> {
  value: unknown;
  rows: T[];
  baseIndex: number;
}

export interface RowSlot<T> {
  kind: "row";
  key: string;
  frame: Accessor<RowFrame<T>>;
  set: (next: RowFrame<T>) => void;
}

export interface GroupSlot<T> {
  kind: "group";
  key: string;
  frame: Accessor<GroupFrame<T>>;
  set: (next: GroupFrame<T>) => void;
}

export type BodySlot<T> = RowSlot<T> | GroupSlot<T>;

export interface ColumnView {
  cellClass: string;
  cellStyle: CSSProperties;
}
