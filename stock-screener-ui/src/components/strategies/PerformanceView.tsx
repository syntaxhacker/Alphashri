import {
  Table,
  Text,
  Group,
  Stack,
  Alert,
  Badge,
  Progress,
  Card,
  SimpleGrid,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconTrendingUp, IconTrendingDown } from "@tabler/icons-react";
import type { PerformanceViewProps } from "./types";

export function PerformanceView({
  performance,
  strategies,
  onSelectStrategy,
  isLoading,
}: PerformanceViewProps) {
  if (isLoading) {
    return (
      <Stack align="center" gap="md" mt="xl" className="performance-view-loading">
        <div className="spinner" data-testid="strategies-loading" />
        <Text size="sm" c="dimmed">
          Loading performance data...
        </Text>
      </Stack>
    );
  }

  if (performance.length === 0) {
    return (
      <Alert
        icon={<IconAlertCircle size={16} />}
        title="No Performance Data"
        color="yellow"
        mt="xl"
        className="performance-view-empty"
        data-testid="performance-empty-state"
      >
        No performance data available. Strategies need to have executed trades to show performance.
      </Alert>
    );
  }

  // Calculate summary stats
  const totalTrades = performance.reduce((sum, p) => sum + p.total_trades, 0);
  const totalWinners = performance.reduce((sum, p) => sum + p.winners, 0);
  const totalLosers = performance.reduce((sum, p) => sum + p.losers, 0);
  const overallWinRate = totalTrades > 0 ? (totalWinners / totalTrades) * 100 : 0;
  const totalPnl = performance.reduce((sum, p) => sum + p.net_pnl, 0);

  const rows = performance.map((perf) => {
    const winRate = perf.total_trades > 0 ? perf.win_rate : 0;
    const pnlClass = perf.net_pnl >= 0 ? "positive" : "negative";
    const pnlColor = perf.net_pnl >= 0 ? "teal" : "red";

    return (
      <Table.Tr
        key={perf.strategy_id}
        style={{ cursor: "pointer" }}
        onClick={() => onSelectStrategy(perf.strategy_id)}
        data-testid={`performance-row-${perf.strategy_id}`}
      >
        <Table.Td>
          <Text fw={500} size="sm">
            {perf.strategy_name}
          </Text>
        </Table.Td>
        <Table.Td>
          <Text size="sm">{perf.total_trades}</Text>
        </Table.Td>
        <Table.Td>
          <Group gap={4}>
            <Text size="sm" c="teal">
              {perf.winners}
            </Text>
            <Text size="sm" c="dimmed">
              /
            </Text>
            <Text size="sm" c="red">
              {perf.losers}
            </Text>
          </Group>
        </Table.Td>
        <Table.Td>
          <Badge size="sm" color={winRate >= 50 ? "teal" : "red"} variant="light">
            {winRate.toFixed(1)}%
          </Badge>
        </Table.Td>
        <Table.Td>
          <Text size="sm" c={pnlColor} fw={500}>
            {perf.net_pnl >= 0 ? "+" : ""}
            {perf.net_pnl.toFixed(2)}
          </Text>
        </Table.Td>
      </Table.Tr>
    );
  });

  return (
    <Stack gap="md" className="performance-view" id="performance-view" data-testid="performance-view">
      <Title order={4}>Performance Summary</Title>

      <SimpleGrid
        cols={{ base: 1, sm: 2, lg: 4 }}
        spacing="md"
        className="performance-summary-cards"
        data-testid="performance-summary-cards"
      >
        <Card
          shadow="sm"
          padding="md"
          radius="sm"
          withBorder
          className="performance-card performance-card-trades"
          data-testid="performance-card-trades"
        >
          <Stack gap={4}>
            <Text size="sm" c="dimmed" tt="uppercase" fw={700}>
              Total Trades
            </Text>
            <Text size="xl" fw={500}>
              {totalTrades}
            </Text>
            <Group gap={4}>
              <Text size="sm" c="teal">
                {totalWinners} W
              </Text>
              <Text size="sm" c="red">
                {totalLosers} L
              </Text>
            </Group>
          </Stack>
        </Card>

        <Card
          shadow="sm"
          padding="md"
          radius="sm"
          withBorder
          className="performance-card performance-card-winrate"
          data-testid="performance-card-winrate"
        >
          <Stack gap={4}>
            <Text size="sm" c="dimmed" tt="uppercase" fw={700}>
              Win Rate
            </Text>
            <Text size="xl" fw={500} c={overallWinRate >= 50 ? "teal" : "red"}>
              {overallWinRate.toFixed(1)}%
            </Text>
            <Progress
              value={overallWinRate}
              color={overallWinRate >= 50 ? "teal" : "red"}
              size="sm"
            />
          </Stack>
        </Card>

        <Card
          shadow="sm"
          padding="md"
          radius="sm"
          withBorder
          className="performance-card performance-card-pnl"
          data-testid="performance-card-pnl"
        >
          <Stack gap={4}>
            <Text size="sm" c="dimmed" tt="uppercase" fw={700}>
              Total P&L
            </Text>
            <Text size="xl" fw={500} c={totalPnl >= 0 ? "teal" : "red"}>
              {totalPnl >= 0 ? "+" : ""}
              {totalPnl.toFixed(2)}
            </Text>
            <Group gap={4}>
              {totalPnl >= 0 ? (
                <IconTrendingUp size={14} color="var(--mantine-color-teal-6)" />
              ) : (
                <IconTrendingDown size={14} color="var(--mantine-color-red-6)" />
              )}
              <Text size="sm" c="dimmed">
                Net P&L
              </Text>
            </Group>
          </Stack>
        </Card>

        <Card
          shadow="sm"
          padding="md"
          radius="sm"
          withBorder
          className="performance-card performance-card-strategies"
          data-testid="performance-card-strategies"
        >
          <Stack gap={4}>
            <Text size="sm" c="dimmed" tt="uppercase" fw={700}>
              Active Strategies
            </Text>
            <Text size="xl" fw={500}>
              {performance.length}
            </Text>
            <Text size="sm" c="dimmed">
              With trade data
            </Text>
          </Stack>
        </Card>
      </SimpleGrid>

      <Card
        shadow="sm"
        padding="md"
        radius="sm"
        withBorder
        className="performance-table-card"
        data-testid="performance-table-card"
      >
        <Title order={5} mb="md">
          Strategy Performance
        </Title>
        <Table
          striped
          highlightOnHover
          withTableBorder
          className="performance-table"
          id="performance-table"
          data-testid="performance-table"
        >
          <Table.Thead className="performance-table-header" data-testid="performance-table-header">
            <Table.Tr>
              <Table.Th>Strategy</Table.Th>
              <Table.Th>Total Trades</Table.Th>
              <Table.Th>W / L</Table.Th>
              <Table.Th>Win Rate</Table.Th>
              <Table.Th>Net P&L</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="performance-table-body" data-testid="performance-table-body">
            {rows}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  );
}
