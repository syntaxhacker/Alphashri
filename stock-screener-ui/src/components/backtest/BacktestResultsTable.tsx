import { useMemo } from "react";
import { Box, Text, Group } from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import type { BacktestResult } from "../../types/backtest";
import { getPnLTextColor, getWinRateColor, formatPnl } from "../../utils/ui-helpers";
import { TanStackTable } from "../common/TanStackTable";

interface BacktestResultsTableProps {
  results: BacktestResult[];
  selectedSymbol: string | null;
  sortColumn: string;
  sortDirection: "asc" | "desc";
  onRowClick: (symbol: string) => void;
  onSort: (column: string) => void;
}

export function BacktestResultsTable({
  results,
  selectedSymbol,
  sortColumn,
  sortDirection,
  onRowClick,
  onSort,
}: BacktestResultsTableProps) {
  const columns = useMemo<ColumnDef<BacktestResult>[]>(
    () => [
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "symbol",
        cell: (info) => (
          <Text fw={500} data-testid={`symbol-${info.getValue<string>()}`}>
            {info.getValue<string>()}
          </Text>
        ),
      },
      {
        id: "net_pnl",
        header: "Net PnL",
        accessorKey: "net_pnl",
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <Text c={getPnLTextColor(val)} fw={500} data-testid={`net-pnl-${info.row.original.symbol}`}>
              {formatPnl(val)}
            </Text>
          );
        },
      },
      {
        id: "trades",
        header: "Trades",
        accessorKey: "trades",
        cell: (info) => (
          <Text data-testid={`trades-${info.row.original.symbol}`}>
            {info.getValue<number>()}
          </Text>
        ),
      },
      {
        id: "win_rate",
        header: "WR%",
        accessorKey: "win_rate",
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <Text c={getWinRateColor(val)} data-testid={`wr-${info.row.original.symbol}`}>
              {(val ?? 0).toFixed(0)}%
            </Text>
          );
        },
      },
      {
        id: "pf",
        header: "PF",
        accessorKey: "pf",
        cell: (info) => (
          <Text data-testid={`pf-${info.row.original.symbol}`}>
            {(info.getValue<number>() ?? 0).toFixed(1)}
          </Text>
        ),
      },
      {
        id: "tp_sl",
        header: "TP/SL",
        enableSorting: false,
        accessorFn: (row) => `${row.tp_exits}/${row.sl_exits}`,
        cell: (info) => {
          const row = info.row.original;
          return (
            <Group gap={2} data-testid={`tpsl-${row.symbol}`}>
              <Text c="green" size="sm">
                {row.tp_exits}
              </Text>
              <Text size="sm">/</Text>
              <Text c="red" size="sm">
                {row.sl_exits}
              </Text>
            </Group>
          );
        },
      },
    ],
    [],
  );

  if (!results || results.length === 0) {
    return (
      <Box className="results-empty" data-testid="results-empty">
        <Text c="dimmed" ta="center" py="md">
          No results yet. Run a backtest.
        </Text>
      </Box>
    );
  }

  return (
    <Box id="results-table" className="backtest-results-table" data-testid="results-table-wrapper">
      <TanStackTable<BacktestResult>
        data={results}
        columns={columns}
        dataTestId="results-table"
        enableSorting
        initialState={{ sorting: [{ id: sortColumn, desc: sortDirection === "desc" }] }}
        getRowTestId={(row) => `result-row-${row.symbol}`}
        getRowStyle={(row) => ({
          backgroundColor:
            selectedSymbol === row.symbol ? "var(--mantine-color-blue-light)" : undefined,
        })}
        onRowClick={(row) => onRowClick(row.symbol)}
      />
    </Box>
  );
}
