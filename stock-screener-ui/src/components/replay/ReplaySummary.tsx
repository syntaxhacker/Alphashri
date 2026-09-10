import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { TanStackTable } from "../common/TanStackTable";
import { CompactPanel } from "../common/compact";
import { getPnLTextColor } from "../../utils/ui-helpers";
import type { ReplaySummary } from "../../types/replay";

interface ReplaySummaryProps {
  summary: ReplaySummary | null;
}

interface BreakdownRow {
  name: string;
  trades: number;
  win_rate: number;
  net_pnl: number;
  profit_factor: number | null;
  isTotal: boolean;
}

export function ReplaySummaryPanel({ summary }: ReplaySummaryProps) {
  const breakdown = summary?.strategy_breakdown || {};
  const entries = Object.entries(breakdown);

  const rows: BreakdownRow[] = [
    ...entries.map(([name, s]) => ({
      name,
      trades: s.trades,
      win_rate: s.win_rate,
      net_pnl: s.net_pnl,
      profit_factor: s.profit_factor,
      isTotal: false,
    })),
    {
      name: "Total",
      trades: summary?.total_trades ?? 0,
      win_rate: summary?.win_rate ?? 0,
      net_pnl: summary?.net_pnl ?? 0,
      profit_factor: summary?.profit_factor ?? 0,
      isTotal: true,
    },
  ];

  const columns = useMemo<ColumnDef<BreakdownRow>[]>(
    () => [
      {
        id: "name",
        header: "Strategy",
        accessorKey: "name",
        cell: (info) => (
          <span style={{ fontWeight: info.row.original.isTotal ? 700 : 500, fontSize: 11 }}>
            {info.getValue<string>()}
          </span>
        ),
      },
      {
        id: "trades",
        header: "Trades",
        accessorKey: "trades",
        cell: (info) => (
          <span
            style={{
              fontWeight: info.row.original.isTotal ? 700 : 400,
              fontSize: 11,
              textAlign: "right",
              display: "block",
            }}
          >
            {info.getValue<number>()}
          </span>
        ),
      },
      {
        id: "win_rate",
        header: "Win Rate",
        accessorKey: "win_rate",
        cell: (info) => (
          <span
            style={{
              fontWeight: info.row.original.isTotal ? 700 : 400,
              fontSize: 11,
              textAlign: "right",
              display: "block",
            }}
          >
            {info.getValue<number>().toFixed(1)}%
          </span>
        ),
      },
      {
        id: "net_pnl",
        header: "Net P&L",
        accessorKey: "net_pnl",
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <span
              style={{
                fontWeight: 500,
                fontSize: 11,
                textAlign: "right",
                display: "block",
                color:
                  getPnLTextColor(val) === "success"
                    ? "var(--mui-palette-success-main)"
                    : "var(--mui-palette-error-main)",
              }}
            >
              {val >= 0 ? "+" : ""}
              {val.toFixed(2)}
            </span>
          );
        },
      },
      {
        id: "profit_factor",
        header: "PF",
        accessorKey: "profit_factor",
        cell: (info) => {
          const val = info.getValue<number | null>();
          const color =
            val != null && val > 1
              ? "var(--mui-palette-success-main)"
              : val != null && val < 1
                ? "var(--mui-palette-error-main)"
                : "var(--mui-palette-secondary-main)";
          return (
            <span
              style={{
                fontWeight: info.row.original.isTotal ? 700 : 400,
                fontSize: 11,
                textAlign: "right",
                display: "block",
                color,
              }}
            >
              {val != null ? val.toFixed(2) : "N/A"}
            </span>
          );
        },
      },
    ],
    [],
  );

  if (!summary) return null;

  return (
    <CompactPanel title="Per-Strategy Breakdown" data-testid="replay-summary">
      <TanStackTable<BreakdownRow>
        data={rows}
        columns={columns}
        dataTestId="replay-summary-table"
        enableSorting={false}
        stickyHeader={false}
        getRowClassName={(row) => (row.isTotal ? "replay-summary-total" : undefined)}
      />
    </CompactPanel>
  );
}
