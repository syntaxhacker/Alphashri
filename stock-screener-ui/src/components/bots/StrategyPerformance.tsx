import { Show, createSignal, onMount } from "solid-js";
import { alpha, Text, Title, Group, Paper, Badge, Box } from "@/ui";
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
    <Show when={data()} fallback={<Text size="sm" c="dimmed">Loading...</Text>}>
      {(d) => (

    <Paper elevation={1} p="sm" radius="sm">
      <Box className="flex items-center justify-between gap-2 p-2" mb="sm">
        <Box className="flex items-center gap-2">
          <Box w={4} h={24} style={{ borderRadius: 2, backgroundColor: palette.INFO }} />
          <Title order={4} ta="center">Strategy Performance</Title>
          <Badge size="sm" variant="light" color="info">last {d().days} days</Badge>
        </Box>
      </Box>
      <TanStackTable<StrategyPerf>
        data={d().strategies}
        columns={columns}
      />
      <Paper
        elevation={1}
        p="sm"
        mt="sm"
        radius="sm"
        style={{
          backgroundColor: alpha(d().total_net_pnl >= 0 ? palette.POSITIVE : palette.NEGATIVE, 0.16),
          borderLeft: `4px solid ${d().total_net_pnl >= 0 ? palette.POSITIVE : palette.NEGATIVE}`,
        }}
      >
        <Box className="flex items-center justify-between gap-2 p-2">
          <Group gap="md" align="flex-start" className="items-start">
            <Box className="flex flex-col gap-2 items-start">
              <Text size="xs" c="dimmed">Total Trades</Text>
              <Text fw={700} size="lg">{d().total_trades}</Text>
            </Box>
            <Box className="flex flex-col gap-2 items-start">
              <Text size="xs" c="dimmed">Win / Loss</Text>
              <Group gap="md" className="items-center">
                <Badge color="success" variant="filled" size="sm">{totalWins()} W</Badge>
                <Badge color="error" variant="filled" size="sm">{totalLosses()} L</Badge>
                <Text size="sm" fw={700}>({totalWinRate()}%)</Text>
              </Group>
            </Box>
          </Group>
          <Box className="flex flex-col gap-2 items-start">
            <Text size="xs" c="dimmed">Total Net P&L</Text>
            <Text fw={700} size="lg" c={d().total_net_pnl >= 0 ? "success" : "error"}>
              {d().total_net_pnl >= 0 ? "+" : ""}₹{d().total_net_pnl.toLocaleString()}
            </Text>
          </Box>
        </Box>
      </Paper>
    </Paper>
      )}
    </Show>
  );
}
