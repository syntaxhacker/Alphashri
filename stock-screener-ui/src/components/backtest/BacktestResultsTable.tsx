import { createMemo, Show } from "solid-js";
import { Text, Box, Group } from "@/ui";
import type { TableColumnDef } from "../paper-trading/TanStackTable";
import type { BacktestResult } from "../../types/backtest";
import { getPnLTextColor, getWinRateColor, formatPnl } from "../../utils/ui-helpers";
import { TanStackTable } from "../paper-trading/TanStackTable";
interface BacktestResultsTableProps {
  results: BacktestResult[];
  selectedSymbol: string | null;
  sortColumn: string;
  sortDirection: "asc" | "desc";
  onRowClick: (symbol: string) => void;
  onSort: (column: string) => void;
}

export function BacktestResultsTable(props: BacktestResultsTableProps) {
  const columns = createMemo<TableColumnDef<BacktestResult>[]>(() => [
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      meta: { align: "center" },
      cell: ({ row }) => (
        <div class="flex items-center justify-center">
          <Text fw={500} data-testid={`symbol-${row.original.symbol}`} ta="center">
            {row.original.symbol}
          </Text>
        </div>
      ),
    },
    {
      id: "net_pnl",
      header: "Net PnL",
      accessorKey: "net_pnl",
      meta: { align: "center" },
      cell: ({ row }) => {
        const val = row.original.net_pnl;
        return (
          <div class="flex items-center justify-center">
            <Text c={getPnLTextColor(val)} fw={500} data-testid={`net-pnl-${row.original.symbol}`} ta="center" className="font-mono tabular-nums">
              {formatPnl(val)}
            </Text>
          </div>
        );
      },
    },
    {
      id: "trades",
      header: "Trades",
      accessorKey: "trades",
      meta: { align: "center" },
      cell: ({ row }) => (
        <div class="flex items-center justify-center">
          <Text data-testid={`trades-${row.original.symbol}`} ta="center" className="font-mono tabular-nums">
            {row.original.trades}
          </Text>
        </div>
      ),
    },
    {
      id: "win_rate",
      header: "WR%",
      accessorKey: "win_rate",
      meta: { align: "center" },
      cell: ({ row }) => {
        const val = row.original.win_rate;
        return (
          <div class="flex items-center justify-center">
            <Text c={getWinRateColor(val)} data-testid={`wr-${row.original.symbol}`} ta="center" className="font-mono tabular-nums">
              {(val ?? 0).toFixed(0)}%
            </Text>
          </div>
        );
      },
    },
    {
      id: "pf",
      header: "PF",
      accessorKey: "pf",
      meta: { align: "center" },
      cell: ({ row }) => (
        <div class="flex items-center justify-center">
          <Text data-testid={`pf-${row.original.symbol}`} ta="center" className="font-mono tabular-nums">
            {(row.original.pf ?? 0).toFixed(1)}
          </Text>
        </div>
      ),
    },
    {
      id: "tp_sl",
      header: "TP/SL",
      enableSorting: false,
      meta: { align: "center" },
      accessorFn: (row) => `${row.tp_exits}/${row.sl_exits}`,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div class="flex items-center justify-center">
            <Group gap={2} data-testid={`tpsl-${r.symbol}`} className="flex items-center justify-center gap-2">
              <Text c="success" size="sm" className="font-mono tabular-nums">
                {r.tp_exits}
              </Text>
              <Text size="sm">/</Text>
              <Text c="error" size="sm" className="font-mono tabular-nums">
                {r.sl_exits}
              </Text>
            </Group>
          </div>
        );
      },
    },
  ]);

  return (
    <Show
      when={props.results && props.results.length > 0}
      fallback={
        <Box className="results-empty" data-testid="results-empty">
          <Text c="dimmed" ta="center" py="md">
            No results yet. Run a backtest.
          </Text>
        </Box>
      }
    >
      <Box id="results-table" className="backtest-results-table" data-testid="results-table-wrapper">
        <TanStackTable<BacktestResult>
          data={props.results}
          columns={columns()}
          dataTestId="results-table"
          enableSorting
          initialState={{ sorting: [{ id: props.sortColumn, desc: props.sortDirection === "desc" }] }}
          getRowTestId={(row) => `result-row-${row.symbol}`}
          getRowClassName={(row) => (props.selectedSymbol === row.symbol ? "result-row-selected" : undefined)}
          getRowStyle={(row) => ({
            backgroundColor: row.symbol === props.selectedSymbol ? "rgba(88, 166, 255, 0.08)" : undefined,
          })}
          onRowClick={(row) => props.onRowClick(row.symbol)}
        />
      </Box>
    </Show>
  );
}
