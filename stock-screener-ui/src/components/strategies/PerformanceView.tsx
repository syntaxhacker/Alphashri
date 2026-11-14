import { Switch, Match, createMemo } from "solid-js";
import { Text, Group, Stack, Badge, Loader, Box } from "@/ui";
import type { TableColumnDef } from "../common/TanStackTable";
import { IconAlertCircle } from "../common/Icons";
import * as palette from "@/ui/palette";
import type { PerformanceViewProps } from "./types";
import type { StrategyPerformance } from "../../types/strategies";
import { CompactStat, CompactStatGrid } from "../common/compact";
import { TanStackTable } from "../common/TanStackTable";

export function PerformanceView(props: PerformanceViewProps) {
  const totalTrades = createMemo(() => props.performance.reduce((sum, p) => sum + p.total_trades, 0));
  const totalWinners = createMemo(() => props.performance.reduce((sum, p) => sum + p.winners, 0));
  const totalLosers = createMemo(() => props.performance.reduce((sum, p) => sum + p.losers, 0));
  const overallWinRate = createMemo(() =>
    totalTrades() > 0 ? (totalWinners() / totalTrades()) * 100 : 0,
  );
  const totalPnl = createMemo(() => props.performance.reduce((sum, p) => sum + p.net_pnl, 0));

  const columns = createMemo<TableColumnDef<StrategyPerformance>[]>(() => [
    {
      id: "strategy_name",
      header: "Strategy",
      accessorKey: "strategy_name",
      meta: { align: "left" },
      cell: (ctx) => (
        <Box className="flex items-center justify-start">
          <Text fw={500} size="sm" ta="left">
            {ctx.row.original.strategy_name}
          </Text>
        </Box>
      ),
    },
    {
      id: "total_trades",
      header: "Total Trades",
      accessorKey: "total_trades",
      meta: { align: "right" },
      cell: (ctx) => (
        <Text size="sm" ta="right" class="font-mono tabular-nums">
          {ctx.row.original.total_trades}
        </Text>
      ),
    },
    {
      id: "wl",
      header: "W / L",
      accessorFn: (row) => `${row.winners}/${row.losers}`,
      meta: { align: "right" },
      cell: (ctx) => (
        <Group gap={4} className="flex items-center justify-end gap-2">
          <Text size="sm" c="info" class="font-mono tabular-nums">
            {ctx.row.original.winners}
          </Text>
          <Text size="sm" c="dimmed">
            /
          </Text>
          <Text size="sm" c="error" class="font-mono tabular-nums">
            {ctx.row.original.losers}
          </Text>
        </Group>
      ),
    },
    {
      id: "win_rate",
      header: "Win Rate",
      accessorKey: "win_rate",
      meta: { align: "right" },
      cell: (ctx) => {
        const winRate = ctx.row.original.win_rate;
        return (
          <Badge size="sm" color={winRate >= 50 ? "success" : "error"} variant="filled">
            <span class="font-mono tabular-nums">{winRate.toFixed(1)}%</span>
          </Badge>
        );
      },
    },
    {
      id: "net_pnl",
      header: "Net P&L",
      accessorKey: "net_pnl",
      meta: { align: "right" },
      cell: (ctx) => {
        const val = ctx.row.original.net_pnl;
        return (
          <span
            class="font-mono tabular-nums"
            style={{
              color: val >= 0 ? palette.INFO : palette.NEGATIVE,
              "font-weight": 500,
              "font-size": "13px",
            }}
          >
            {val >= 0 ? "+" : ""}
            {val.toFixed(2)}
          </span>
        );
      },
    },
  ]);

  const loading = (
    <Box className="performance-view-loading p-2" data-testid="performance-loading-state">
      <Group gap="xs" align="center">
        <Loader size="sm" data-testid="strategies-loading" />
        <Text fw={600} size="sm">
          Loading performance
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        Collecting trade outcomes and win-rate data
      </Text>
    </Box>
  );

  const empty = (
    <Box className="performance-view-empty p-2" data-testid="performance-empty-state">
      <Group gap="xs" align="center">
        <IconAlertCircle size={18} />
        <Text fw={600} size="sm">
          No performance data
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        Strategies need executed trades before performance can be shown.
      </Text>
    </Box>
  );

  return (
    <Switch>
      <Match when={props.isLoading}>{loading}</Match>
      <Match when={props.performance.length === 0}>{empty}</Match>
      <Match when={!props.isLoading && props.performance.length > 0}>
        <Stack
          spacing={1}
          gap="sm"
          className="performance-view p-2"
          id="performance-view"
          data-testid="performance-view"
        >
          <CompactStatGrid className="gap-2 p-2">
            <CompactStat
              label="Total Trades"
              value={totalTrades()}
              hint={`${totalWinners()} winners / ${totalLosers()} losers`}
              className="performance-card performance-card-trades"
              testId="performance-card-trades"
            />
            <CompactStat
              label="Win Rate"
              value={`${overallWinRate().toFixed(1)}%`}
              tone={overallWinRate() >= 50 ? "positive" : "negative"}
              className="performance-card performance-card-winrate"
              testId="performance-card-winrate"
            />
            <CompactStat
              label="Total P&L"
              value={`${totalPnl() >= 0 ? "+" : ""}${totalPnl().toFixed(2)}`}
              hint="Net P&L across all strategies"
              tone={totalPnl() >= 0 ? "positive" : "negative"}
              className="performance-card performance-card-pnl"
              testId="performance-card-pnl"
            />
            <CompactStat
              label="Active Strategies"
              value={props.performance.length}
              hint="With trade data"
              className="performance-card performance-card-strategies"
              testId="performance-card-strategies"
            />
          </CompactStatGrid>

          <Box className="performance-table-card min-h-0" data-testid="performance-table-card">
            <Box className="flex items-center justify-center p-2">
              <TanStackTable<StrategyPerformance>
                data={props.performance}
                columns={columns()}
                onRowClick={(row) => props.onSelectStrategy(row.strategy_id)}
                dataTestId="performance-table"
                stickyHeader={false}
              />
            </Box>
          </Box>
        </Stack>
      </Match>
    </Switch>
  );
}
