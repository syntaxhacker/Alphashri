import { Table, Text, Group, Stack, Badge, Progress } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import type { PerformanceViewProps } from "./types";
import { CompactPanel, CompactStat, CompactStatGrid } from "../common/compact";
import { DataTable } from "../common/DataTable";

export function PerformanceView({
  performance,
  onSelectStrategy,
  isLoading,
}: PerformanceViewProps) {
  if (isLoading) {
    return (
      <CompactPanel
        className="performance-view-loading"
        testId="performance-loading-state"
        title={
          <Group gap="xs" wrap="nowrap">
            <div className="spinner" data-testid="strategies-loading" />
            <Text fw={600} size="sm">
              Loading performance
            </Text>
          </Group>
        }
        description="Collecting trade outcomes and win-rate data"
      />
    );
  }

  if (performance.length === 0) {
    return (
      <CompactPanel
        className="performance-view-empty"
        testId="performance-empty-state"
        title={
          <Group gap="xs" wrap="nowrap">
            <IconAlertCircle size={18} />
            <Text fw={600} size="sm">
              No performance data
            </Text>
          </Group>
        }
        description="Strategies need executed trades before performance can be shown."
      />
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
    <Stack
      gap="sm"
      className="performance-view"
      id="performance-view"
      data-testid="performance-view"
    >
      <CompactStatGrid>
        <CompactStat
          label="Total Trades"
          value={totalTrades}
          hint={`${totalWinners} winners / ${totalLosers} losers`}
          className="performance-card performance-card-trades"
          testId="performance-card-trades"
        />

        <CompactStat
          label="Win Rate"
          value={`${overallWinRate.toFixed(1)}%`}
          hint={
            <Progress
              value={overallWinRate}
              color={overallWinRate >= 50 ? "teal" : "red"}
              size="sm"
            />
          }
          tone={overallWinRate >= 50 ? "positive" : "negative"}
          className="performance-card performance-card-winrate"
          testId="performance-card-winrate"
        />

        <CompactStat
          label="Total P&L"
          value={`${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}`}
          hint="Net P&L across all strategies"
          tone={totalPnl >= 0 ? "positive" : "negative"}
          className="performance-card performance-card-pnl"
          testId="performance-card-pnl"
        />

        <CompactStat
          label="Active Strategies"
          value={performance.length}
          hint="With trade data"
          className="performance-card performance-card-strategies"
          testId="performance-card-strategies"
        />
      </CompactStatGrid>

      <CompactPanel
        className="performance-table-card"
        testId="performance-table-card"
        title="Strategy Performance"
        description="Click a row to inspect the strategy's trade history"
      >
        <DataTable
          withTableBorder
          verticalSpacing="xs"
          horizontalSpacing="sm"
          className="performance-table"
          id="performance-table"
          dataTestId="performance-table"
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
        </DataTable>
      </CompactPanel>
    </Stack>
  );
}
