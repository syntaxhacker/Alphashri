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
        meta: { align: "center" } as any,
        cell: (info) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Text fw={500} data-testid={`symbol-${info.getValue<string>()}`} ta="center">
              {info.getValue<string>()}
            </Text>
          </Box>
        ),
      },
      {
        id: "net_pnl",
        header: "Net PnL",
        accessorKey: "net_pnl",
        meta: { align: "center" } as any,
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Text c={getPnLTextColor(val)} fw={500} data-testid={`net-pnl-${info.row.original.symbol}`} ta="center">
                {formatPnl(val)}
              </Text>
            </Box>
          );
        },
      },
      {
        id: "trades",
        header: "Trades",
        accessorKey: "trades",
        meta: { align: "center" } as any,
        cell: (info) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Text data-testid={`trades-${info.row.original.symbol}`} ta="center">
              {info.getValue<number>()}
            </Text>
          </Box>
        ),
      },
      {
        id: "win_rate",
        header: "WR%",
        accessorKey: "win_rate",
        meta: { align: "center" } as any,
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Text c={getWinRateColor(val)} data-testid={`wr-${info.row.original.symbol}`} ta="center">
                {(val ?? 0).toFixed(0)}%
              </Text>
            </Box>
          );
        },
      },
      {
        id: "pf",
        header: "PF",
        accessorKey: "pf",
        meta: { align: "center" } as any,
        cell: (info) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Text data-testid={`pf-${info.row.original.symbol}`} ta="center">
              {(info.getValue<number>() ?? 0).toFixed(1)}
            </Text>
          </Box>
        ),
      },
      {
        id: "tp_sl",
        header: "TP/SL",
        enableSorting: false,
        meta: { align: "center" } as any,
        accessorFn: (row) => `${row.tp_exits}/${row.sl_exits}`,
        cell: (info) => {
          const row = info.row.original;
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Group gap={2} data-testid={`tpsl-${row.symbol}`} sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
                <Text c="success" size="sm">
                  {row.tp_exits}
                </Text>
                <Text size="sm">/</Text>
                <Text c="error" size="sm">
                  {row.sl_exits}
                </Text>
              </Group>
            </Box>
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
            selectedSymbol === row.symbol ? "rgba(var(--mui-palette-primary-mainChannel) / 0.08)" : undefined,
        })}
        onRowClick={(row) => onRowClick(row.symbol)}
      />
    </Box>
  );
}
