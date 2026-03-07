import { Group, Text } from "@mantine/core";
import type { BacktestTotals } from "../../types/backtest";

interface BacktestSummaryProps {
  totals: BacktestTotals | null;
}

export function BacktestSummary({ totals }: BacktestSummaryProps) {
  if (!totals) return null;

  const pnlColor = totals.net_pnl >= 0 ? "green" : "red";
  const pnlSign = totals.net_pnl >= 0 ? "+" : "";

  return (
    <Group gap="sm" data-testid="results-summary">
      <Group gap={4} data-testid="summary-net-pnl">
        <Text size="xs" c="dimmed">Net PnL</Text>
        <Text size="sm" fw={600} c={pnlColor}>
          {pnlSign}₹{(totals.net_pnl / 1000).toFixed(1)}K
        </Text>
      </Group>
      <Group gap={4} data-testid="summary-costs">
        <Text size="xs" c="dimmed">Costs</Text>
        <Text size="sm" fw={600} c="red">
          ₹{(totals.total_costs / 1000).toFixed(1)}K
        </Text>
      </Group>
      <Group gap={4} data-testid="summary-wr">
        <Text size="xs" c="dimmed">WR</Text>
        <Text size="sm" fw={600}>
          {totals.win_rate.toFixed(0)}%
        </Text>
      </Group>
      <Group gap={4} data-testid="summary-trades">
        <Text size="xs" c="dimmed">Trades</Text>
        <Text size="sm" fw={600}>
          {totals.trades}
        </Text>
      </Group>
    </Group>
  );
}
