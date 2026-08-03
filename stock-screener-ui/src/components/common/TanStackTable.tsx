import { useState, Fragment, type ReactNode, type CSSProperties } from "react";
import { Box, ScrollArea } from "@/ui";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getExpandedRowModel,
  useReactTable,
  type SortingState,
  type ExpandedState,
  type ColumnDef,
} from "@tanstack/react-table";
import { TableLoadingState } from "./TableLoadingState";
import { TableEmptyState } from "./TableEmptyState";

interface Props<T> {
  data: T[];
  columns: ColumnDef<T>[];
  initialState?: { sorting?: SortingState };
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
  stickyHeader?: boolean;
  className?: string;
  style?: CSSProperties;
  enableColumnResizing?: boolean;
  enableColumnVisibility?: boolean;
  enablePagination?: boolean;
  enableFiltering?: boolean;
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

export function TanStackTable<T extends Record<string, unknown>>({
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
  stickyHeader = true,
  className,
  style,
  getRowCanExpand,
  renderSubComponent,
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialState?.sorting ?? []);
  const [expanded, setExpanded] = useState<ExpandedState>({});

  const table = useReactTable<T>({
    data,
    columns,
    state: { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    enableSorting,
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
        style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", ...style }}
        className={className}
      >
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  style={{
                    ...baseHeaderStyle,
                    width: h.column.getSize() !== 150 ? h.column.getSize() : undefined,
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
              ))}
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
                <tr
                  key={row.id}
                  style={{ cursor: onRowClick ? "pointer" : undefined, ...getRowStyle?.(row.original) }}
                  onClick={() => onRowClick?.(row.original)}
                  className={getRowClassName?.(row.original)}
                  data-testid={getRowTestId?.(row.original, index)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} style={{ ...cellStyle, width: cell.column.getSize() !== 150 ? cell.column.getSize() : undefined }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
                {row.getIsExpanded() && renderSubComponent && (
                  <tr key={`${row.id}-expanded`}>
                    <td colSpan={row.getVisibleCells().length} style={{ padding: 0, border: "none" }}>
                      {renderSubComponent(row.original)}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))
          )}
        </tbody>
      </Box>
    </ScrollArea>
  );
}
