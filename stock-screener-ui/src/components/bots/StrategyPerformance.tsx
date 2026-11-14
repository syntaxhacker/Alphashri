import { Show, createSignal, onMount } from "solid-js";
import { Text, Paper, Badge, Box, ToolbarRow } from "@/ui";
import * as palette from "@/ui/palette";
import type { TableColumnDef as ColumnDef } from "../common/TanStackTable";
import { TanStackTable } from "../common/TanStackTable";
import { apiGet } from "../../api/utils";

interface StrategyPerf {
  strategy_id: number;
  strategy_name: string;
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  net_pnl: number;
}

interface PerfResponse {
  strategies: StrategyPerf[];
  total_trades: number;
  total_net_pnl: number;
  days: number;
}

const columns: ColumnDef<StrategyPerf>[] = [
  {
    id: "strategy_name",
    accessorKey: "strategy_name",
    header: "Strategy",
    enableSorting: true,
    meta: { align: "left" },
      cell: (info) => (
        <Box className="flex items-center justify-start">
          <Text fw={600} size="sm" ta="left">{info.row.original.strategy_name}</Text>
        </Box>
      ),
  },
  {
    id: "trades",
    accessorKey: "trades",
    header: "Trades",
    enableSorting: true,
    meta: { align: "right" },
    cell: (info) => <Text fw={500} ta="right">{info.row.original.trades}</Text>,
  },
  {
    id: "wins",
    accessorKey: "wins",
    header: "Wins",
    enableSorting: true,
    meta: { align: "right" },
    cell: (info) => (
      <>
        <Badge color="success" variant="dot" size="sm" />
        <Text span ml={4} ta="right">{info.row.original.wins}</Text>
      </>
    ),
  },
  {
    id: "losses",
    accessorKey: "losses",
    header: "Losses",
    enableSorting: true,
    meta: { align: "right" },
    cell: (info) => (
      <>
        <Badge color="error" variant="dot" size="sm" />
        <Text span ml={4} ta="right">{info.row.original.losses}</Text>
      </>
    ),
  },
  {
    id: "win_rate",
    accessorKey: "win_rate",
    header: "Win Rate",
    enableSorting: true,
    meta: { align: "right" },
    cell: (info) => {
      const v = info.row.original.win_rate;
      return <Text fw={500} ta="right">{v}%</Text>;
    },
  },
  {
    id: "net_pnl",
    accessorKey: "net_pnl",
    header: "Net P&L",
    enableSorting: true,
    meta: { align: "right" },
    cell: (info) => {
      const v = info.row.original.net_pnl;
      return (
        <Text fw={600} c={v >= 0 ? "success" : "error"} ta="right">
          {v >= 0 ? "+" : ""}₹{v.toLocaleString()}
        </Text>
      );
    },
  },
];

export function StrategyPerformance() {
  const [data, setData] = createSignal<PerfResponse | null>(null);

  onMount(() => {
    apiGet<PerfResponse>("/api/strategy-performance?days=30")
      .then(setData)
      .catch(() => {});
  });

  const totalWins = () => data()?.strategies.reduce((s, x) => s + x.wins, 0) ?? 0;
  const totalLosses = () => data()?.strategies.reduce((s, x) => s + x.losses, 0) ?? 0;
  const totalWinRate = () =>
    data() && data()!.total_trades > 0 ? ((totalWins() / data()!.total_trades) * 100).toFixed(1) : "0.0";

  return (
    <Show when={data()} fallback={<Box className="p-2"><Text size="xs" c="dimmed">Loading…</Text></Box>}>
      {(d) => (
        <Paper radius="sm" p={0} className="flex h-full min-h-0 flex-col overflow-hidden">
          <ToolbarRow gap={8} wrap={false} className="shrink-0 px-2" style={{ height: "28px", "border-bottom": "1px solid var(--color-fin-border)" }}>
            <Box w={4} h={16} style={{ "border-radius": "2px", "background-color": palette.INFO }} />
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ "font-size": "10px", "letter-spacing": "0.06em", "text-transform": "uppercase" }}>
              Strategy Performance
            </Text>
            <Badge size="xs" variant="light" color="info">last {d().days} days</Badge>
          </ToolbarRow>

          <Box className="flex min-h-0 flex-1 flex-col p-1">
            <TanStackTable<StrategyPerf>
              data={d().strategies}
              columns={columns}
              dense
              bare
              fillContainer
              emptyMessage="No strategy trades in this window"
            />
          </Box>

          <Box className="flex shrink-0 items-center justify-between gap-4 px-2" style={{ height: "34px", "border-top": "1px solid var(--color-fin-border)" }}>
            <Box className="flex items-center gap-4">
              <Box className="flex items-baseline gap-2">
                <Text size="xs" c="dimmed">Total Trades</Text>
                <Text size="sm" fw={700} className="font-mono tabular-nums">{d().total_trades}</Text>
              </Box>
              <Box className="flex items-center gap-2">
                <Text size="xs" c="dimmed">Win / Loss</Text>
                <Badge color="success" variant="filled" size="xs">{totalWins()} W</Badge>
                <Badge color="error" variant="filled" size="xs">{totalLosses()} L</Badge>
                <Text size="xs" fw={700} className="font-mono tabular-nums">({totalWinRate()}%)</Text>
              </Box>
            </Box>
            <Box className="flex items-baseline gap-2">
              <Text size="xs" c="dimmed">Total Net P&L</Text>
              <Text size="sm" fw={700} className="font-mono tabular-nums" c={d().total_net_pnl >= 0 ? "success" : "error"}>
                {d().total_net_pnl >= 0 ? "+" : ""}₹{d().total_net_pnl.toLocaleString()}
              </Text>
            </Box>
          </Box>
        </Paper>
      )}
    </Show>
  );
}
