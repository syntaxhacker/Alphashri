import { Group, Text } from "@mantine/core";
import type { BacktestTotals } from "../../types/backtest";

interface BacktestSummaryProps {
  totals: BacktestTotals | null;
}

export function BacktestSummary({ totals }: BacktestSummaryProps) {
  if (!totals) return null;

  const netPnl = totals.net_pnl ?? 0;
  const totalCosts = totals.total_costs ?? 0;
  const winRate = totals.win_rate ?? 0;

  const pnlColor = netPnl >= 0 ? "green" : "red";
  const pnlSign = netPnl >= 0 ? "+" : "";

  return (
    <Group id="backtest-summary" className="backtest-summary" gap="sm" data-testid="results-summary">
      <Group gap={4} className="summary-item summary-net-pnl" data-testid="summary-net-pnl">
        <Text size="sm" c="dimmed">
          Net PnL
        </Text>
        <Text size="sm" fw={600} c={pnlColor}>
          {pnlSign}₹{(netPnl / 1000).toFixed(1)}K
        </Text>
      </Group>
      <Group gap={4} className="summary-item summary-costs" data-testid="summary-costs">
        <Text size="sm" c="dimmed">
          Costs
        </Text>
        <Text size="sm" fw={600} c="red">
          ₹{(totalCosts / 1000).toFixed(1)}K
        </Text>
      </Group>
      <Group gap={4} className="summary-item summary-wr" data-testid="summary-wr">
        <Text size="sm" c="dimmed">
          WR
        </Text>
        <Text size="sm" fw={600}>
          {winRate.toFixed(0)}%
        </Text>
      </Group>
      <Group gap={4} className="summary-item summary-trades" data-testid="summary-trades">
        <Text size="sm" c="dimmed">
          Trades
        </Text>
        <Text size="sm" fw={600}>
          {totals.trades ?? 0}
        </Text>
      </Group>
    </Group>
  );
}
