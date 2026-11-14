import { createMemo, Show } from "solid-js";
import type { TableColumnDef } from "../paper-trading/TanStackTable";
import { TanStackTable } from "../paper-trading/TanStackTable";
import { CompactPanel } from "../common/compact";
import { getPnLTextColor } from "../../utils/ui-helpers";
import * as palette from "@/ui/palette";
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

export function ReplaySummaryPanel(props: ReplaySummaryProps) {
  const rows = createMemo<BreakdownRow[]>(() => {
    const breakdown = props.summary?.strategy_breakdown || {};
    const entries = Object.entries(breakdown);
    return [
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
        trades: props.summary?.total_trades ?? 0,
        win_rate: props.summary?.win_rate ?? 0,
        net_pnl: props.summary?.net_pnl ?? 0,
        profit_factor: props.summary?.profit_factor ?? 0,
        isTotal: true,
      },
    ];
  });

  const columns = createMemo<TableColumnDef<BreakdownRow>[]>(() => [
    {
      id: "name",
      header: "Strategy",
      accessorKey: "name",
      meta: { align: "left" },
      cell: ({ row }) => (
        <span style={{ "font-weight": row.original.isTotal ? 700 : 500, "font-size": "11px" }}>
          {row.original.name}
        </span>
      ),
    },
    {
      id: "trades",
      header: "Trades",
      accessorKey: "trades",
      meta: { align: "right" },
      cell: ({ row }) => (
        <span
          style={{
            "font-weight": row.original.isTotal ? 700 : 400,
            "font-size": "11px",
            "text-align": "right",
            display: "block",
          }}
        >
          {row.original.trades}
        </span>
      ),
    },
    {
      id: "win_rate",
      header: "Win Rate",
      accessorKey: "win_rate",
      meta: { align: "right" },
      cell: ({ row }) => (
        <span
          style={{
            "font-weight": row.original.isTotal ? 700 : 400,
            "font-size": "11px",
            "text-align": "right",
            display: "block",
          }}
        >
          {row.original.win_rate.toFixed(1)}%
        </span>
      ),
    },
    {
      id: "net_pnl",
      header: "Net P&L",
      accessorKey: "net_pnl",
      meta: { align: "right" },
      cell: ({ row }) => {
        const val = row.original.net_pnl;
        return (
          <span
            style={{
              "font-weight": 500,
              "font-size": "11px",
              "text-align": "right",
              display: "block",
              color: getPnLTextColor(val) === "success" ? palette.POSITIVE : palette.NEGATIVE,
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
      meta: { align: "right" },
      cell: ({ row }) => {
        const val = row.original.profit_factor;
        const color =
          val != null && val > 1
            ? palette.POSITIVE
            : val != null && val < 1
              ? palette.NEGATIVE
              : palette.TEXT_MUTED;
        return (
          <span
            style={{
              "font-weight": row.original.isTotal ? 700 : 400,
              "font-size": "11px",
              "text-align": "right",
              display: "block",
              color,
            }}
          >
            {val != null ? val.toFixed(2) : "N/A"}
          </span>
        );
      },
    },
  ]);

  return (
    <Show when={props.summary}>
      <CompactPanel title="Per-Strategy Breakdown" data-testid="replay-summary">
        <TanStackTable<BreakdownRow>
          data={rows()}
          columns={columns()}
          dataTestId="replay-summary-table"
          enableSorting={false}
          stickyHeader={false}
          dense
          getRowClassName={(row) => (row.isTotal ? "replay-summary-total" : undefined)}
        />
      </CompactPanel>
    </Show>
  );
}
