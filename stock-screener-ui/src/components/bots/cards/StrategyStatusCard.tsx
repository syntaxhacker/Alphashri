import { Card, Text, Badge, Group, Stack, Progress } from "@mantine/core";
import type { StrategyStatus } from "../../../types/bots";
import { formatNumber as formatNumberShared, getPnLTextColor } from "../../../utils/ui-helpers";

export function StrategyStatusCard({
  strategy,
  isRunning: _isRunning,
}: {
  strategy: StrategyStatus;
  isRunning: boolean;
}) {
  const usedPct = (strategy.capital_used / strategy.allocated_capital) * 100;
  const pnlColor = getPnLTextColor(strategy.total_pnl);

  return (
    <Card shadow="xs" padding="sm" radius="md" withBorder data-testid="strategy-card">
      <Group justify="space-between" mb="xs">
        <Text fw={600} size="sm">
          {strategy.strategy_name}
        </Text>
        <Badge color={strategy.status === "running" ? "green" : "gray"} variant="light" size="sm">
          {strategy.status}
        </Badge>
      </Group>

      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Positions
          </Text>
          <Text size="sm">
            {strategy.positions_count}/{strategy.max_positions}
          </Text>
        </Group>

        <Stack gap={0}>
          <Group justify="space-between" mb={4}>
            <Text size="sm" c="dimmed">
              Capital Used
            </Text>
            <Text size="sm">
              ₹{formatNumberShared(strategy.capital_used)} / ₹
              {formatNumberShared(strategy.allocated_capital)} ({usedPct.toFixed(0)}%)
            </Text>
          </Group>
          <Progress value={Math.min(usedPct, 100)} size="sm" color="blue" />
        </Stack>

        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            P&L
          </Text>
          <Text size="sm" fw={600} c={pnlColor}>
            {strategy.total_pnl >= 0 ? "+" : ""}₹{formatNumberShared(strategy.total_pnl)}
          </Text>
        </Group>

        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Trades
          </Text>
          <Text size="sm">{strategy.trades_count}</Text>
        </Group>
      </Stack>
    </Card>
  );
}
