import { useState, type ReactNode } from "react";
import { Box, ScrollArea } from "@/ui";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type ColumnDef,
} from "@tanstack/react-table";

interface Props<T> {
  data: T[];
  columns: ColumnDef<T>[];
  initialState?: { sorting?: SortingState };
  dataTestId?: string;
}

const cellStyle: React.CSSProperties = {
  padding: "2px 6px",
  fontSize: 11,
  whiteSpace: "nowrap",
  borderBottom: "1px solid var(--mantine-color-default-border)",
};

const headerStyle: React.CSSProperties = {
  padding: "4px 6px",
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: "nowrap",
  cursor: "pointer",
  userSelect: "none",
  borderBottom: "2px solid var(--mantine-color-default-border)",
  background: "var(--mantine-color-body)",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

export function TanStackTable<T extends Record<string, unknown>>({ data, columns, initialState, dataTestId }: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialState?.sorting ?? []);

  const table = useReactTable<T>({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSorting: true,
  });

  return (
    <ScrollArea style={{ height: "100%" }}>
      <Box component="table" data-testid={dataTestId} style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  style={headerStyle}
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
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} style={cellStyle}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Box>
    </ScrollArea>
  );
}
