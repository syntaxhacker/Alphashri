import { useMemo } from "react";
import { Text, Group, Stack, Badge, Loader, Box } from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { IconAlertCircle } from "@tabler/icons-react";
import type { PerformanceViewProps } from "./types";
import type { StrategyPerformance } from "../../types/strategies";
import { CompactPanel, CompactStat, CompactStatGrid } from "../common/compact";
import { TanStackTable } from "../common/TanStackTable";

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
            <Loader size="sm" data-testid="strategies-loading" />
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

  const totalTrades = performance.reduce((sum, p) => sum + p.total_trades, 0);
  const totalWinners = performance.reduce((sum, p) => sum + p.winners, 0);
  const totalLosers = performance.reduce((sum, p) => sum + p.losers, 0);
  const overallWinRate = totalTrades > 0 ? (totalWinners / totalTrades) * 100 : 0;
  const totalPnl = performance.reduce((sum, p) => sum + p.net_pnl, 0);

  const columns = useMemo<ColumnDef<StrategyPerformance>[]>(
    () => [
      {
        id: "strategy_name",
        header: "Strategy",
        accessorKey: "strategy_name",
        meta: { align: "center" } as any,
        cell: (info) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text fw={500} size="sm" ta="center">
            {info.getValue<string>()}
          </Text></Box>
        ),
      },
      {
        id: "total_trades",
        header: "Total Trades",
        accessorKey: "total_trades",
        meta: { align: "center" } as any,
        cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text size="sm" ta="center">{info.getValue<number>()}</Text></Box>,
      },
      {
        id: "wl",
        header: "W / L",
        accessorFn: (row) => `${row.winners}/${row.losers}`,
        meta: { align: "center" } as any,
        cell: (info) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Group gap={4} sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
            <Text size="sm" c="info">
              {info.row.original.winners}
            </Text>
            <Text size="sm" c="dimmed">
              /
            </Text>
            <Text size="sm" c="error">
              {info.row.original.losers}
            </Text>
          </Group>
          </Box>
        ),
      },
      {
        id: "win_rate",
        header: "Win Rate",
        accessorKey: "win_rate",
        meta: { align: "center" } as any,
        cell: (info) => {
          const winRate = info.getValue<number>();
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Badge size="sm" color={winRate >= 50 ? "info" : "error"} variant="light">
              {winRate.toFixed(1)}%
            </Badge>
            </Box>
          );
        },
      },
      {
        id: "net_pnl",
        header: "Net P&L",
        accessorKey: "net_pnl",
        meta: { align: "center" } as any,
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: val >= 0 ? "var(--mui-palette-info-main)" : "var(--mui-palette-error-main)", fontWeight: 500, fontSize: 13 }}>
              {val >= 0 ? "+" : ""}
              {val.toFixed(2)}
            </span>
            </Box>
          );
        },
      },
    ],
    [],
  );

  return (
    <Stack
      spacing={1}
      gap="sm"
      className="performance-view"
      id="performance-view"
      data-testid="performance-view"
      sx={{ gap: 1, p: 1 }}
    >
      <CompactStatGrid sx={{ gap: 1, p: 1 }}>
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
        scrollable
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
          <TanStackTable<StrategyPerformance>
            data={performance}
            columns={columns}
            onRowClick={(row) => onSelectStrategy(row.strategy_id)}
            dataTestId="performance-table"
            stickyHeader={false}
          />
        </Box>
      </CompactPanel>
    </Stack>
  );
}
