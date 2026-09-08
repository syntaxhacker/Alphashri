import { useEffect, useState } from "react";
import { alpha } from "@mui/material/styles";
import { Text, Title, Group, Paper, Badge, Box } from "@/ui";
import { type ColumnDef } from "@tanstack/react-table";
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
    accessorKey: "strategy_name",
    header: "Strategy",
    enableSorting: true,
    meta: { align: "left" } as any,
      cell: ({ row }) => (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
          <Text fw={600} size="sm" ta="left">{row.original.strategy_name}</Text>
        </Box>
      ),
  },
  {
    accessorKey: "trades",
    header: "Trades",
    enableSorting: true,
    meta: { align: "right" } as any,
    cell: ({ getValue }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}><Text fw={500} ta="right">{getValue<number>()}</Text></Box>,
  },
  {
    accessorKey: "wins",
    header: "Wins",
    enableSorting: true,
    meta: { align: "right" } as any,
    cell: ({ getValue }) => (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1 }}>
        <Badge color="success" variant="dot" size="sm" />
        <Text span ml={4} ta="right">{getValue<number>()}</Text>
      </Box>
    ),
  },
  {
    accessorKey: "losses",
    header: "Losses",
    enableSorting: true,
    meta: { align: "right" } as any,
    cell: ({ getValue }) => (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1 }}>
        <Badge color="error" variant="dot" size="sm" />
        <Text span ml={4} ta="right">{getValue<number>()}</Text>
      </Box>
    ),
  },
  {
    accessorKey: "win_rate",
    header: "Win Rate",
    enableSorting: true,
    meta: { align: "right" } as any,
    cell: ({ getValue }) => {
      const v = getValue<number>();
      return <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}><Text fw={500} ta="right">{v}%</Text></Box>;
    },
  },
  {
    accessorKey: "net_pnl",
    header: "Net P&L",
    enableSorting: true,
    meta: { align: "right" } as any,
    cell: ({ getValue }) => {
      const v = getValue<number>();
      return (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}><Text fw={600} c={v >= 0 ? "success" : "error"} ta="right">
          {v >= 0 ? "+" : ""}₹{v.toLocaleString()}
        </Text></Box>
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
    <Paper elevation={1} p="sm" radius="sm" sx={{ p: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }} mb="sm">
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
          <Box w={4} h={24} sx={(theme) => ({ borderRadius: 2, backgroundColor: theme.palette.info.main })} />
          <Title order={4} ta="center">Strategy Performance</Title>
          <Badge size="sm" variant="light" color="info">last {data.days} days</Badge>
        </Box>
      </Box>
      <TanStackTable<StrategyPerf>
        data={data.strategies}
        columns={columns}
      />
      <Paper
        elevation={1}
        p="sm"
        mt="sm"
        radius="sm"
        sx={(theme) => ({
          p: 1,
          background: alpha(data.total_net_pnl >= 0 ? theme.palette.success.main : theme.palette.error.main, 0.16),
          borderLeft: `4px solid ${data.total_net_pnl >= 0 ? theme.palette.success.main : theme.palette.error.main}`,
        })}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }}>
          <Group gap={8} align="flex-start" sx={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
            <Box sx={{ display: "flex", gap: 1, flexDirection: "column", alignItems: "flex-start" }}>
              <Text size="xs" c="dimmed">Total Trades</Text>
              <Text fw={700} size="lg">{data.total_trades}</Text>
            </Box>
            <Box sx={{ display: "flex", gap: 1, flexDirection: "column", alignItems: "flex-start" }}>
              <Text size="xs" c="dimmed">Win / Loss</Text>
              <Group gap={8} sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <Badge color="success" variant="filled" size="sm">{totalWins} W</Badge>
                <Badge color="error" variant="filled" size="sm">{totalLosses} L</Badge>
                <Text size="sm" fw={700}>({totalWinRate}%)</Text>
              </Group>
            </Box>
          </Group>
          <Box sx={{ display: "flex", gap: 1, flexDirection: "column", alignItems: "flex-start" }}>
            <Text size="xs" c="dimmed">Total Net P&L</Text>
            <Text fw={700} size="lg" c={data.total_net_pnl >= 0 ? "success" : "error"}>
              {data.total_net_pnl >= 0 ? "+" : ""}₹{data.total_net_pnl.toLocaleString()}
            </Text>
          </Box>
        </Box>
      </Paper>
    </Paper>
  );
}
