import { Box, Table, Text, Group } from "@mantine/core";
import type { BacktestResult } from "../../types/backtest";
import { getPnLTextColor, getWinRateColor, formatPnl } from "../../utils/ui-helpers";
import { SortableHeader } from "../common/SortableHeader";
import { DataTable } from "../common/DataTable";
import { TableEmptyState } from "../common/TableEmptyState";

interface BacktestResultsTableProps {
  results: BacktestResult[];
  selectedSymbol: string | null;
  sortColumn: string;
  sortDirection: "asc" | "desc";
  onRowClick: (symbol: string) => void;
  onSort: (column: string) => void;
}

interface ColumnDef {
  key: string;
  label: string;
  sortable: boolean;
}

const columns: ColumnDef[] = [
  { key: "symbol", label: "Symbol", sortable: true },
  { key: "net_pnl", label: "Net PnL", sortable: true },
  { key: "trades", label: "Trades", sortable: true },
  { key: "win_rate", label: "WR%", sortable: true },
  { key: "pf", label: "PF", sortable: true },
  { key: "tp_sl", label: "TP/SL", sortable: false },
];

export function BacktestResultsTable({
  results,
  selectedSymbol,
  sortColumn,
  sortDirection,
  onRowClick,
  onSort,
}: BacktestResultsTableProps) {
  const renderRow = (result: BacktestResult) => {
    const isSelected = selectedSymbol === result.symbol;
    const pnlColor = getPnLTextColor(result.net_pnl);
    const wrColor = getWinRateColor(result.win_rate);

    return (
      <Table.Tr
        key={result.symbol}
        style={{
          backgroundColor: isSelected ? "var(--mantine-color-blue-light)" : undefined,
        }}
        onClick={() => onRowClick(result.symbol)}
        data-testid={`result-row-${result.symbol}`}
      >
        <Table.Td data-testid={`symbol-${result.symbol}`}>
          <Text fw={500}>{result.symbol}</Text>
        </Table.Td>
        <Table.Td data-testid={`net-pnl-${result.symbol}`}>
          <Text c={pnlColor} fw={500}>
            {formatPnl(result.net_pnl)}
          </Text>
        </Table.Td>
        <Table.Td data-testid={`trades-${result.symbol}`}>
          <Text>{result.trades}</Text>
        </Table.Td>
        <Table.Td data-testid={`wr-${result.symbol}`}>
          <Text c={wrColor}>{(result.win_rate ?? 0).toFixed(0)}%</Text>
        </Table.Td>
        <Table.Td data-testid={`pf-${result.symbol}`}>
          <Text>{(result.pf ?? 0).toFixed(1)}</Text>
        </Table.Td>
        <Table.Td data-testid={`tpsl-${result.symbol}`}>
          <Group gap={2}>
            <Text c="green" size="sm">
              {result.tp_exits}
            </Text>
            <Text size="sm">/</Text>
            <Text c="red" size="sm">
              {result.sl_exits}
            </Text>
          </Group>
        </Table.Td>
      </Table.Tr>
    );
  };

  if (!results || results.length === 0) {
    return (
      <TableEmptyState message="No results yet. Run a backtest." />
    );
  }

  return (
    <Box id="results-table" className="backtest-results-table" data-testid="results-table-wrapper">
      <DataTable withTableBorder stickyHeader className="results-table">
        <Table.Thead>
          <Table.Tr>
            {columns.map((column) => (
              <SortableHeader
                key={column.key}
                label={column.label}
                columnKey={column.key}
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={onSort}
                sortable={column.sortable}
                testId={`th-${column.key}`}
              />
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody data-testid="results-tbody">{results.map(renderRow)}</Table.Tbody>
      </DataTable>
    </Box>
  );
}
