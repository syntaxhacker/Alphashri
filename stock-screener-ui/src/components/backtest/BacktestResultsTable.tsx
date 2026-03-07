import { Table, Text, Group } from "@mantine/core";
import { IconArrowUp, IconArrowDown } from "@tabler/icons-react";
import type { BacktestResult } from "../../types/backtest";

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

function getPnlColor(value: number): string {
  return value >= 0 ? "green" : "red";
}

function getWinRateColor(value: number): string {
  if (value >= 50) return "green";
  if (value >= 40) return "dimmed";
  return "red";
}

function formatPnl(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}₹${(value / 1000).toFixed(1)}K`;
}

export function BacktestResultsTable({
  results,
  selectedSymbol,
  sortColumn,
  sortDirection,
  onRowClick,
  onSort,
}: BacktestResultsTableProps) {
  const renderHeader = (column: ColumnDef) => {
    const isSorted = sortColumn === column.key;
    const isActive = isSorted && column.sortable;

    return (
      <Table.Th
        key={column.key}
        style={{ cursor: column.sortable ? "pointer" : "default" }}
        onClick={() => column.sortable && onSort(column.key)}
        data-testid={`th-${column.key}`}
      >
        <Group gap={4} wrap="nowrap">
          <Text size="sm" fw={500}>
            {column.label}
          </Text>
          {isActive && (
            <span className={`sort-indicator ${sortDirection}`}>
              {sortDirection === "asc" ? (
                <IconArrowUp size={14} />
              ) : (
                <IconArrowDown size={14} />
              )}
            </span>
          )}
        </Group>
      </Table.Th>
    );
  };

  const renderRow = (result: BacktestResult) => {
    const isSelected = selectedSymbol === result.symbol;
    const pnlColor = getPnlColor(result.net_pnl);
    const wrColor = getWinRateColor(result.win_rate);

    return (
      <Table.Tr
        key={result.symbol}
        style={{
          cursor: "pointer",
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
          <Text c={wrColor}>{result.win_rate.toFixed(0)}%</Text>
        </Table.Td>
        <Table.Td data-testid={`pf-${result.symbol}`}>
          <Text>{result.pf.toFixed(1)}</Text>
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
      <div data-testid="results-empty">
        <Text c="dimmed" ta="center" py="md">
          No results yet. Run a backtest.
        </Text>
      </div>
    );
  }

  return (
    <div data-testid="results-table-wrapper">
      <Table striped highlightOnHover withTableBorder stickyHeader>
        <Table.Thead>
          <Table.Tr>{columns.map(renderHeader)}</Table.Tr>
        </Table.Thead>
        <Table.Tbody data-testid="results-tbody">
          {results.map(renderRow)}
        </Table.Tbody>
      </Table>
    </div>
  );
}
