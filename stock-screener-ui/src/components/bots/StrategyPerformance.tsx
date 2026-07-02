import { useEffect, useState } from "react";
import { Table, Text, Title, Group, Paper } from "@/ui";
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

export function StrategyPerformance() {
  const [data, setData] = useState<PerfResponse | null>(null);

  useEffect(() => {
    apiGet<PerfResponse>("/api/strategy-performance?days=30")
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return <Text size="sm" c="dimmed">Loading...</Text>;

  const rows = data.strategies.map((s) => (
    <Table.Tr key={s.strategy_id}>
      <Table.Td>{s.strategy_name}</Table.Td>
      <Table.Td>{s.trades}</Table.Td>
      <Table.Td>{s.wins}</Table.Td>
      <Table.Td>{s.losses}</Table.Td>
      <Table.Td>{s.win_rate}%</Table.Td>
      <Table.Td style={{ color: s.net_pnl >= 0 ? "var(--mantine-color-teal-6)" : "var(--mantine-color-red-6)" }}>
        ₹{s.net_pnl.toLocaleString()}
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <Paper p="md">
      <Title order={4}>Strategy Performance (last {data.days} days)</Title>
      <Table striped highlightOnHover mt="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Strategy</Table.Th>
            <Table.Th>Trades</Table.Th>
            <Table.Th>Wins</Table.Th>
            <Table.Th>Losses</Table.Th>
            <Table.Th>Win Rate</Table.Th>
            <Table.Th>Net P&L</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{rows}</Table.Tbody>
      </Table>
      <Group mt="sm">
        <Text size="sm" fw={700}>Total Trades: {data.total_trades}</Text>
        <Text size="sm" fw={700} c={data.total_net_pnl >= 0 ? "teal" : "red"}>
          Total Net P&L: ₹{data.total_net_pnl.toLocaleString()}
        </Text>
      </Group>
    </Paper>
  );
}
