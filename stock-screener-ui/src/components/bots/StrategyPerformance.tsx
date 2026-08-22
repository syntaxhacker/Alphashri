import { useEffect, useState } from "react";
import { Text, Title, Group, Paper, Badge, Box } from "@/ui";
import { type ColumnDef } from "@tanstack/react-table";
import { TanStackTable } from "../common/TanStackTable";
import { apiGet } from "../../api/utils";

const STRATEGY_COLORS: Record<string, string> = {
  ORB: "blue",
  SR_BREAKOUT: "violet",
  EMA_CROSS: "cyan",
  WEEK_52_CHASER: "orange",
  WEEK_52_TARGET: "teal",
  BLIND_52W: "pink",
};

function getStrategyColor(name: string): string {
  for (const [key, color] of Object.entries(STRATEGY_COLORS)) {
    if (name.toUpperCase().includes(key)) return color;
  }
  return "gray";
}

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
    accessorKey: "strategy_name",
    header: "Strategy",
    enableSorting: true,
    cell: ({ row }) => (
      <Badge color={getStrategyColor(row.original.strategy_name)} variant="light" size="sm">
        {row.original.strategy_name}
      </Badge>
    ),
  },
  {
    accessorKey: "trades",
    header: "Trades",
    enableSorting: true,
    cell: ({ getValue }) => <Text fw={500}>{getValue<number>()}</Text>,
  },
  {
    accessorKey: "wins",
    header: "Wins",
    enableSorting: true,
    cell: ({ getValue }) => (
      <>
        <Badge color="green" variant="dot" size="sm" />
        <Text span ml={4}>{getValue<number>()}</Text>
      </>
    ),
  },
  {
    accessorKey: "losses",
    header: "Losses",
    enableSorting: true,
    cell: ({ getValue }) => (
      <>
        <Badge color="red" variant="dot" size="sm" />
        <Text span ml={4}>{getValue<number>()}</Text>
      </>
    ),
  },
  {
    accessorKey: "win_rate",
    header: "Win Rate",
    enableSorting: true,
    cell: ({ getValue }) => {
      const v = getValue<number>();
      return <Text fw={500} c={v >= 50 ? "teal" : "orange"}>{v}%</Text>;
    },
  },
  {
    accessorKey: "net_pnl",
    header: "Net P&L",
    enableSorting: true,
    cell: ({ getValue }) => {
      const v = getValue<number>();
      return (
        <Text fw={600} c={v >= 0 ? "teal" : "red"}>
          {v >= 0 ? "+" : ""}₹{v.toLocaleString()}
        </Text>
      );
    },
  },
];

export function StrategyPerformance() {
  const [data, setData] = useState<PerfResponse | null>(null);

  useEffect(() => {
    apiGet<PerfResponse>("/api/strategy-performance?days=30")
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return <Text size="sm" c="dimmed">Loading...</Text>;

  const totalWins = data.strategies.reduce((s, x) => s + x.wins, 0);
  const totalLosses = data.strategies.reduce((s, x) => s + x.losses, 0);
  const totalWinRate = data.total_trades > 0 ? ((totalWins / data.total_trades) * 100).toFixed(1) : "0.0";

  return (
    <Paper p="md" withBorder radius="md">
      <Group gap="xs" mb="md">
        <Box w={4} h={24} style={{ borderRadius: 2, backgroundColor: "var(--mantine-color-cyan-6)" }} />
        <Title order={4}>Strategy Performance</Title>
        <Badge size="sm" variant="light" color="cyan">last {data.days} days</Badge>
      </Group>
      <TanStackTable<StrategyPerf>
        data={data.strategies}
        columns={columns}
      />
      <Paper
        p="sm"
        mt="sm"
        withBorder
        radius="sm"
        style={{
          // Theme-aware tint: light shade in light mode, dark shade in dark mode
          // (shade-0 vars are near-white and look broken in dark mode).
          background: `light-dark(var(--mantine-color-${data.total_net_pnl >= 0 ? "teal" : "red"}-0), var(--mantine-color-${data.total_net_pnl >= 0 ? "teal" : "red"}-9))`,
          borderLeft: `4px solid var(--mantine-color-${data.total_net_pnl >= 0 ? "teal" : "red"}-6)`,
        }}
      >
        <Group justify="space-between">
          <Group gap="lg">
            <div>
              <Text size="xs" c="dimmed">Total Trades</Text>
              <Text fw={700} size="lg">{data.total_trades}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">Win / Loss</Text>
              <Group gap="xs">
                <Badge color="green" variant="light" size="sm">{totalWins} W</Badge>
                <Badge color="red" variant="light" size="sm">{totalLosses} L</Badge>
                <Text size="sm" c="dimmed">({totalWinRate}%)</Text>
              </Group>
            </div>
          </Group>
          <div style={{ textAlign: "right" }}>
            <Text size="xs" c="dimmed">Total Net P&L</Text>
            <Text fw={700} size="lg" c={data.total_net_pnl >= 0 ? "teal" : "red"}>
              {data.total_net_pnl >= 0 ? "+" : ""}₹{data.total_net_pnl.toLocaleString()}
            </Text>
          </div>
        </Group>
      </Paper>
    </Paper>
  );
}
