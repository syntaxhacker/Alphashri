import { useMemo } from "react";
import type { ValueRow } from "../../api/valueScan";
import { TanStackTable } from "../common/TanStackTable";
import { buildValueColumns } from "./valueColumns";

interface ValueTableProps {
  rows: ValueRow[];
  loading?: boolean;
  onRowClick?: (row: ValueRow) => void;
}

export function ValueTable({ rows, loading = false, onRowClick }: ValueTableProps) {
  const columns = useMemo(() => buildValueColumns(), []);
  return (
    <TanStackTable<ValueRow>
      data={rows}
      columns={columns}
      dataTestId="value-table"
      loading={loading}
      loadingMessage="Scanning for deep value…"
      emptyMessage="No deep-value matches for these filters"
      enableSorting
      stickyHeader
      onRowClick={onRowClick}
      getRowTestId={(row) => `value-row-${row.symbol}`}
    />
  );
}
