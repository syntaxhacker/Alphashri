import { useState, Fragment, useMemo, type ReactNode, type CSSProperties } from "react";
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";
import { Box, ScrollArea } from "@/ui";
import * as palette from "@/ui/palette";
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
  /**
   * When > 0, only a scroll-position window of this many rows is mounted once
   * the row count exceeds it. Keeps large tables (e.g. the 530+ row 52W-high
   * screener) responsive; the full row model still drives sorting/selection.
   */
  rowWindowSize?: number;
  /**
   * When true the table fills its parent's height (no 65vh cap) instead of
   * being capped — use inside a flex column layout that already has a height.
   */
  fillContainer?: boolean;
}

const ROW_ESTIMATED = 20;
const GROUP_ROW_ESTIMATE = 36;
const EXPANDED_ROW_ESTIMATE = 220;

/** Largest row index whose top offset is <= scrollTop (binary search). */
function findRowIndexForOffset(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= y) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

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
  rowWindowSize = 0,
  fillContainer = false,
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialState?.sorting ?? []);
  const [expanded, setExpanded] = useState<ExpandedState>(initialState?.expanded ?? {});
  const [scrollTop, setScrollTop] = useState(0);

  const hasSizedColumns = useMemo(
    () => columns.some((col) => typeof (col as { size?: number }).size === "number" && (col as { size?: number }).size !== 0),
    [columns],
  );
  const visibleColumnCount = useMemo(
    () => columns.filter((col) => (col as { size?: number }).size !== 0).length,
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

  // Columns whose sample values are all numbers get right-aligned headers
  // and cells by default (text columns stay left). Explicit `meta.align`
  // always wins over this heuristic.
  const numericColumnIds = new Set<string>();
  const sampleRows = table.getRowModel().rows.slice(0, 5);
  if (sampleRows.length > 0) {
    for (const col of table.getAllLeafColumns()) {
      const values = sampleRows
        .map((r) => r.getValue(col.id))
        .filter((v) => v !== null && v !== undefined && v !== "");
      if (values.length > 0 && values.every((v) => typeof v === "number")) {
        numericColumnIds.add(col.id);
      }
    }
  }

  const showLoading = loading && data.length === 0;
  const showEmpty = !loading && data.length === 0;
  const colCount = table.getHeaderGroups()[0]?.headers.length ?? 1;

  // Row windowing: for very large tables only a slice around the scroll
  // position is mounted. The full row model remains active so sorting, grouping
  // and row selection keep working over every row. Group headers and expanded
  // sub-rows have different heights, so we track per-row estimates to keep the
  // scroll spacers accurate.
  const allRows = table.getRowModel().rows;
  const useRowWindow = rowWindowSize > 0 && allRows.length > rowWindowSize;

  const rowHeights: number[] = [];
  for (const row of allRows) {
    if (row.getIsGrouped()) rowHeights.push(GROUP_ROW_ESTIMATE);
    else if (renderSubComponent && row.getIsExpanded()) rowHeights.push(ROW_ESTIMATED + EXPANDED_ROW_ESTIMATE);
    else rowHeights.push(ROW_ESTIMATED);
  }
  const rowOffsets: number[] = [0];
  for (let i = 0; i < rowHeights.length; i++) rowOffsets.push(rowOffsets[i] + rowHeights[i]);
  const totalHeight = rowOffsets[allRows.length] ?? 0;

  const windowStartIndex = useRowWindow ? findRowIndexForOffset(rowOffsets, scrollTop) : 0;
  const rowWindowStart = useRowWindow
    ? Math.min(Math.max(0, windowStartIndex - 4), Math.max(0, allRows.length - rowWindowSize))
    : 0;
  const rowWindowEnd = useRowWindow
    ? Math.min(allRows.length, rowWindowStart + rowWindowSize)
    : allRows.length;
  const renderedRows = useRowWindow ? allRows.slice(rowWindowStart, rowWindowEnd) : allRows;
  const topSpacerHeight = useRowWindow ? rowOffsets[rowWindowStart] : 0;
  const bottomSpacerHeight = useRowWindow ? Math.max(0, totalHeight - rowOffsets[rowWindowEnd]) : 0;

  return (
    <TableContainer component={Paper} elevation={0} className={`paper-tanstack-container ${className || ""}`} id={dataTestId ? `paper-tanstack-${dataTestId}` : undefined} sx={{ borderRadius: 1, display: "flex", flexDirection: "column", overflow: "hidden", maxHeight: fillContainer ? "none" : "65vh", minHeight: fillContainer ? 0 : 200, flex: fillContainer ? 1 : undefined, height: fillContainer ? "100%" : undefined, border: 0, bgcolor: palette.SURFACE }}>
      <ScrollArea className="paper-tanstack-scroll" sx={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", bgcolor: palette.SURFACE }}
        onScrollPositionChange={useRowWindow ? (pos) => setScrollTop(pos.y) : undefined}
      >
        <Box
          component="table"
          data-testid={dataTestId}
          id={dataTestId ? `paper-tanstack-table-${dataTestId}` : undefined}
          style={{ width: "100%", tableLayout: hasSizedColumns ? "fixed" : "auto", minWidth: Math.max(640, visibleColumnCount * 96), ...(style || {}) } as React.CSSProperties}
          sx={{
            width: "100%",
            minWidth: Math.max(640, visibleColumnCount * 96),
            borderCollapse: "collapse",
            bgcolor: palette.SURFACE,
          }}
          className={`paper-tanstack-table ${className || ""}`}
        >
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const width = getColumnWidth(h.column);
                const { align } = getColumnMeta(h.column);
                return (
                    <Box
                    component="th"
                    key={h.id}
                    className="paper-tanstack-header-cell"
                    id={`paper-tanstack-header-${String(h.column.id)}`}
                    sx={{
                      padding: width === 0 ? "0" : "3px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      userSelect: "none",
                      bgcolor: palette.SURFACE_ALT,
                      color: palette.TEXT_MUTED,
                      borderBottom: 1,
                      borderColor: palette.BORDER,
                      width: width !== undefined ? width : undefined,
                      display: width === 0 ? "none" : undefined,
                      textAlign: align ?? (numericColumnIds.has(h.column.id) ? "right" : "left"),
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
                  </Box>
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
            <>
              {useRowWindow && topSpacerHeight > 0 && (
                <tr aria-hidden style={{ height: topSpacerHeight }}>
                  <td colSpan={colCount} style={{ padding: 0, border: "none" }} />
                </tr>
              )}
              {renderedRows.map((row, index) => (
              <Fragment key={`row-group-${row.id}`}>
                {row.getIsGrouped() ? (
                  <Box
                    component="tr"
                    key={row.id}
                    data-testid={getGroupRowTestId?.(row.groupingValue)}
                    onClick={row.getToggleExpandedHandler()}
                    sx={{ cursor: "pointer", bgcolor: palette.SURFACE_ALT }}
                  >
                    <Box component="td" colSpan={colCount} sx={{ padding: 0, border: "none", bgcolor: palette.SURFACE_ALT }}>
                      {renderGroupHeader?.({
                        value: row.groupingValue,
                        rows: row.subRows.map((r) => r.original),
                        isExpanded: row.getIsExpanded(),
                        toggle: row.toggleExpanded,
                      })}
                    </Box>
                  </Box>
                ) : (
                  <>
                    <tr
                      key={row.id}
                      style={{ cursor: onRowClick ? "pointer" : undefined, ...getRowStyle?.(row.original) }}
                      onClick={() => onRowClick?.(row.original)}
                      className={getRowClassName?.(row.original)}
                      data-testid={getRowTestId?.(row.original, index)}
                      data-row="stock"
                    >
                      {row.getVisibleCells().map((cell) => {
                        const width = getColumnWidth(cell.column);
                        const { align } = getColumnMeta(cell.column);
                        return (
                          <Box
                            component="td"
                            key={cell.id}
                            className="paper-tanstack-cell"
                            id={`paper-tanstack-cell-${String(cell.column.id)}-${row.id}`}
                            sx={{
                              padding: width === 0 ? "0" : cell.column.id === "toggle" ? "3px 4px" : "3px 8px",
                              fontSize: 11,
                              lineHeight: 1.2,
                              whiteSpace: "nowrap",
                              height: 20,
                              borderBottom: 1,
                              borderColor: palette.BORDER,
                              bgcolor: palette.SURFACE,
                              width: width !== undefined ? width : undefined,
                              display: width === 0 ? "none" : undefined,
                              textAlign: align ?? (numericColumnIds.has(cell.column.id) ? "right" : "left"),
                              ...(width !== undefined
                                ? { overflow: "hidden", textOverflow: "ellipsis" }
                                : {}),
                            }}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </Box>
                        );
                      })}
                    </tr>
                    {row.getIsExpanded() && renderSubComponent && (
                      <tr key={`${row.id}-expanded`} className="paper-tanstack-expanded-row" id={`paper-expanded-row-${row.id}`} style={{ background: palette.BG }}>
                        <td className="paper-tanstack-expanded-cell" colSpan={row.getVisibleCells().length} style={{ padding: 0, borderTop: `1px solid ${palette.BORDER}`, borderBottom: `1px solid ${palette.BORDER}`, background: palette.BG }}>
                          {renderSubComponent(row.original)}
                        </td>
                      </tr>
                    )}
                  </>
                )}
              </Fragment>
              ))}
              {useRowWindow && bottomSpacerHeight > 0 && (
                <tr aria-hidden style={{ height: bottomSpacerHeight }}>
                  <td colSpan={colCount} style={{ padding: 0, border: "none" }} />
                </tr>
              )}
            </>
          )}
        </tbody>
        </Box>
      </ScrollArea>
    </TableContainer>
  );
}
