import { useState, Fragment, useMemo, type ReactNode, type CSSProperties } from "react";
import { Box, ScrollArea } from "@/ui";
import {
  flexRender,
  getCoreRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  getExpandedRowModel,
  useReactTable,
  type SortingState,
  type ExpandedState,
  type ColumnDef,
  type Column,
} from "@tanstack/react-table";
import { TableLoadingState } from "./TableLoadingState";
import { TableEmptyState } from "./TableEmptyState";

/**
 * Column-level metadata understood by TanStackTable.
 * Usage: `meta: { align: "right" }` on a ColumnDef.
 */
export interface TableColumnMeta {
  align?: "left" | "center" | "right";
}

export interface GroupHeaderInfo<T> {
  /** Grouping column value for this group (e.g. the date). */
  value: unknown;
  /** Original data rows in this group. */
  rows: T[];
  isExpanded: boolean;
  toggle: () => void;
}

interface Props<T> {
  data: T[];
  columns: ColumnDef<T>[];
  initialState?: { sorting?: SortingState; expanded?: ExpandedState };
  /** Group rows by these column ids (requires enableGrouping). */
  grouping?: string[];
  /** Enables TanStack row grouping + getGroupedRowModel. */
  enableGrouping?: boolean;
  /** Custom renderer for a full-width group header row. */
  renderGroupHeader?: (group: GroupHeaderInfo<T>) => ReactNode;
  /** Test id for group header rows, keyed by the grouping value. */
  getGroupRowTestId?: (value: unknown) => string | undefined;
  dataTestId?: string;
  loading?: boolean;
  loadingMessage?: string;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  emptyAction?: ReactNode;
  onRowClick?: (row: T) => void;
  getRowClassName?: (row: T) => string | undefined;
  getRowStyle?: (row: T) => CSSProperties | undefined;
  getRowTestId?: (row: T, index: number) => string | undefined;
  enableSorting?: boolean;
  enableSortingRemoval?: boolean;
  stickyHeader?: boolean;
  className?: string;
  style?: CSSProperties;
  getRowCanExpand?: (row: T) => boolean;
  renderSubComponent?: (row: T) => ReactNode;
}

const cellStyle: CSSProperties = {
  padding: "2px 6px",
  fontSize: 11,
  whiteSpace: "nowrap",
  borderBottom: "1px solid var(--mantine-color-default-border)",
};

const baseHeaderStyle: CSSProperties = {
  padding: "4px 6px",
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: "nowrap",
  userSelect: "none",
  borderBottom: "2px solid var(--mantine-color-default-border)",
  background: "var(--mantine-color-body)",
};

/** Returns the explicit column width, or undefined when the column has no size set. */
function getColumnWidth<T>(column: Column<T, unknown>): number | undefined {
  const size = (column.columnDef as { size?: number }).size;
  return typeof size === "number" ? size : undefined;
}

function getColumnMeta<T>(column: Column<T, unknown>): Partial<TableColumnMeta> {
  return (column.columnDef.meta as Partial<TableColumnMeta> | undefined) ?? {};
}

export function TanStackTable<T>({
  data,
  columns,
  initialState,
  dataTestId,
  loading = false,
  loadingMessage,
  emptyMessage = "No data",
  emptyIcon,
  emptyAction,
  onRowClick,
  getRowClassName,
  getRowStyle,
  getRowTestId,
  enableSorting = true,
  // Matches TanStack's default: a third click on a sorted column clears sorting.
  // Pass false for tables that should only toggle asc/desc (e.g. experiments).
  enableSortingRemoval = true,
  stickyHeader = true,
  className,
  style,
  grouping,
  enableGrouping = false,
  renderGroupHeader,
  getGroupRowTestId,
  getRowCanExpand,
  renderSubComponent,
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialState?.sorting ?? []);
  const [expanded, setExpanded] = useState<ExpandedState>(initialState?.expanded ?? {});

  const hasSizedColumns = useMemo(
    () => columns.some((col) => typeof (col as { size?: number }).size === "number"),
    [columns],
  );

  const table = useReactTable<T>({
    data,
    columns,
    state: enableGrouping ? { sorting, expanded, grouping: grouping ?? [] } : { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getGroupedRowModel: enableGrouping ? getGroupedRowModel() : undefined,
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    // Override TanStack's injected default size (150) so unsized columns are
    // distinguishable from columns with an explicit `size` in column defs.
    defaultColumn: { size: undefined },
    enableSorting,
    enableSortingRemoval,
    // Keep day-group / row expansion state controlled by the caller instead of
    // letting TanStack reset it whenever data or columns change (its default
    // autoResetExpanded resets to the table's captured initialState, which is
    // {}-initialized and collapses every day group on refetch).
    autoResetExpanded: false,
    getRowCanExpand: getRowCanExpand ? (row) => getRowCanExpand(row.original) : undefined,
  });

  const showLoading = loading && data.length === 0;
  const showEmpty = !loading && data.length === 0;
  const colCount = table.getHeaderGroups()[0]?.headers.length ?? 1;

  return (
    <ScrollArea style={{ height: "100%" }}>
      <Box
        component="table"
        data-testid={dataTestId}
        style={{
          width: "100%",
          borderCollapse: "collapse",
          tableLayout: hasSizedColumns ? "fixed" : "auto",
          ...style,
        }}
        className={className}
      >
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const width = getColumnWidth(h.column);
                const { align } = getColumnMeta(h.column);
                return (
                  <th
                    key={h.id}
                    style={{
                      ...baseHeaderStyle,
                      width: width !== undefined ? width : undefined,
                      textAlign: align,
                      cursor: h.column.getCanSort() ? "pointer" : "default",
                      position: stickyHeader ? "sticky" : undefined,
                      top: stickyHeader ? 0 : undefined,
                      zIndex: stickyHeader ? 1 : undefined,
                    }}
                    onClick={h.column.getToggleSortingHandler()}
                    colSpan={h.colSpan}
                  >
                    {h.isPlaceholder ? null : (
                      <>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {h.column.getIsSorted() === "asc" && " ▲"}
                        {h.column.getIsSorted() === "desc" && " ▼"}
                      </>
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {showLoading ? (
            <tr>
              <td colSpan={colCount}>
                <TableLoadingState message={loadingMessage} />
              </td>
            </tr>
          ) : showEmpty ? (
            <tr>
              <td colSpan={colCount}>
                <TableEmptyState message={emptyMessage} icon={emptyIcon} action={emptyAction} />
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row, index) => (
              <Fragment key={`row-group-${row.id}`}>
                {row.getIsGrouped() ? (
                  <tr
                    key={row.id}
                    data-testid={getGroupRowTestId?.(row.groupingValue)}
                    onClick={row.getToggleExpandedHandler()}
                    style={{ cursor: "pointer", background: "var(--mantine-color-body)" }}
                  >
                    <td colSpan={colCount} style={{ padding: 0, border: "none", background: "var(--mantine-color-body)" }}>
                      {renderGroupHeader?.({
                        value: row.groupingValue,
                        rows: row.subRows.map((r) => r.original),
                        isExpanded: row.getIsExpanded(),
                        toggle: row.toggleExpanded,
                      })}
                    </td>
                  </tr>
                ) : (
                  <>
                    <tr
                      key={row.id}
                      style={{ cursor: onRowClick ? "pointer" : undefined, ...getRowStyle?.(row.original) }}
                      onClick={() => onRowClick?.(row.original)}
                      className={getRowClassName?.(row.original)}
                      data-testid={getRowTestId?.(row.original, index)}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const width = getColumnWidth(cell.column);
                        const { align } = getColumnMeta(cell.column);
                        return (
                          <td
                            key={cell.id}
                            style={{
                              ...cellStyle,
                              width: width !== undefined ? width : undefined,
                              textAlign: align,
                              ...(width !== undefined
                                ? { overflow: "hidden", textOverflow: "ellipsis" }
                                : null),
                            }}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                    {row.getIsExpanded() && renderSubComponent && (
                      <tr key={`${row.id}-expanded`}>
                        <td colSpan={row.getVisibleCells().length} style={{ padding: 0, border: "none" }}>
                          {renderSubComponent(row.original)}
                        </td>
                      </tr>
                    )}
                  </>
                )}
              </Fragment>
            ))
          )}
        </tbody>
      </Box>
    </ScrollArea>
  );
}
