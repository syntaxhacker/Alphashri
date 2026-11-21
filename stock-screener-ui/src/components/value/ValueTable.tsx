import { createMemo } from "solid-js";
import type { ValueRow } from "../../api/valueScan";
import { TanStackTable } from "../common/TanStackTable";
import { buildValueColumns } from "./valueColumns";

interface ValueTableProps {
  rows: ValueRow[];
  loading?: boolean;
  onRowClick?: (row: ValueRow) => void;
  onSymbolClick?: (symbol: string, exchange?: string) => void;
}

export function ValueTable(props: ValueTableProps) {
  const columns = createMemo(() => buildValueColumns(props.onSymbolClick));
  return (
    <TanStackTable<ValueRow>
      data={props.rows}
      columns={columns()}
      dataTestId="value-table"
      loading={props.loading}
      loadingMessage="Scanning for deep value…"
      emptyMessage="No deep-value matches for these filters"
      enableSorting
      stickyHeader
      onRowClick={props.onRowClick}
      getRowTestId={(row) => `value-row-${row.symbol}`}
    />
  );
}
