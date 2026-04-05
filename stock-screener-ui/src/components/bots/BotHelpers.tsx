import {
  Card,
  Text,
  Badge,
  Group,
  Stack,
  Grid,
  Progress,
  Table,
  ActionIcon,
  Box,
} from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import type {
  BotTrade,
  BotPosition,
  PortfolioSummary,
  StrategyStatus,
} from "../../types/bots";
import { formatNumber as formatNumberShared, getPnLTextColor } from "../../utils/ui-helpers";
import { SideBadge, ExitReasonBadge } from "../common/BadgeComponents";

export function PortfolioSummaryCard({ portfolio }: { portfolio: PortfolioSummary }) {
  const pnlColor = getPnLTextColor(portfolio.total_pnl);

  return (
    <Card shadow="sm" padding="md" radius="md" withBorder data-testid="portfolio-summary">
      <Text fw={600} mb="sm">
        Portfolio Summary
      </Text>
      <Grid>
        <Grid.Col span={6}>
          <Stack gap="xs">
            <Stack gap={0}>
              <Text size="sm" c="dimmed">
                Capital
              </Text>
              <Text fw={600}>₹{formatNumberShared(portfolio.initial_capital)}</Text>
            </Stack>
            <Stack gap={0}>
              <Text size="sm" c="dimmed">
                Cash
              </Text>
              <Text fw={600}>₹{formatNumberShared(portfolio.cash)}</Text>
            </Stack>
          </Stack>
        </Grid.Col>
        <Grid.Col span={6}>
          <Stack gap="xs">
            <Stack gap={0}>
              <Text size="sm" c="dimmed">
                Positions
              </Text>
              <Text fw={600}>{portfolio.total_positions}</Text>
            </Stack>
            <Stack gap={0}>
              <Text size="sm" c="dimmed">
                Total P&L
              </Text>
              <Text fw={600} c={pnlColor}>
                {portfolio.total_pnl >= 0 ? "+" : ""}₹{formatNumberShared(portfolio.total_pnl)}
                <Text span size="sm" ml={4}>
                  ({portfolio.total_pnl_pct >= 0 ? "+" : ""}
                  {portfolio.total_pnl_pct.toFixed(2)}%)
                </Text>
              </Text>
            </Stack>
          </Stack>
        </Grid.Col>
      </Grid>
    </Card>
  );
}

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

export function PositionsTable({ positions }: { positions: BotPosition[] }) {
  if (positions.length === 0) return null;

  return (
    <Card shadow="sm" padding="md" radius="md" withBorder data-testid="bot-positions">
      <Text fw={600} mb="sm">
        Open Positions
      </Text>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Strategy</Table.Th>
            <Table.Th>Symbol</Table.Th>
            <Table.Th>Side</Table.Th>
            <Table.Th>Qty</Table.Th>
            <Table.Th>Entry</Table.Th>
            <Table.Th>Current</Table.Th>
            <Table.Th>P&L</Table.Th>
            <Table.Th>SL/TP</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {positions.map((p, idx) => {
            const pnlColor = getPnLTextColor(p.unrealized_pnl);
            return (
              <Table.Tr key={idx}>
                <Table.Td>{p.strategy_name}</Table.Td>
                <Table.Td>
                  <Text fw={600}>{p.symbol}</Text>
                </Table.Td>
                <Table.Td>
                  <SideBadge side={p.side} />
                </Table.Td>
                <Table.Td>{p.quantity}</Table.Td>
                <Table.Td>₹{p.entry_price.toFixed(2)}</Table.Td>
                <Table.Td>₹{p.current_price.toFixed(2)}</Table.Td>
                <Table.Td>
                  <Text c={pnlColor} fw={600}>
                    {p.unrealized_pnl >= 0 ? "+" : ""}₹{formatNumberShared(p.unrealized_pnl)}
                    <Text span size="sm" ml={4}>
                      ({p.unrealized_pnl_pct >= 0 ? "+" : ""}
                      {p.unrealized_pnl_pct.toFixed(2)}%)
                    </Text>
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    SL: ₹{p.stop_loss.toFixed(2)}
                    <br />
                    TP: ₹{p.take_profit.toFixed(2)}
                  </Text>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

export function TradesTable({ trades, onRefresh }: { trades: BotTrade[]; onRefresh: () => void }) {
  if (trades.length === 0) {
    return (
      <Card shadow="sm" padding="md" radius="md" withBorder data-testid="bot-trades">
        <Text fw={600} mb="sm">
          Trade History
        </Text>
        <Text c="dimmed" ta="center">
          No trades yet
        </Text>
      </Card>
    );
  }

  return (
    <Card shadow="sm" padding="md" radius="md" withBorder data-testid="bot-trades">
      <Group justify="space-between" mb="sm">
        <Text fw={600}>Trade History ({trades.length})</Text>
        <ActionIcon
          variant="subtle"
          onClick={onRefresh}
          title="Refresh trades"
          data-testid="refresh-trades-btn"
        >
          <IconRefresh size={16} />
        </ActionIcon>
      </Group>
      <Box style={{ overflowX: "auto" }}>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Strategy</Table.Th>
              <Table.Th>Symbol</Table.Th>
              <Table.Th>Side</Table.Th>
              <Table.Th>Qty</Table.Th>
              <Table.Th>Entry</Table.Th>
              <Table.Th>Exit</Table.Th>
              <Table.Th>P&L</Table.Th>
              <Table.Th>Net P&L</Table.Th>
              <Table.Th>Exit Reason</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {trades.map((t, idx) => {
              const pnlColor = getPnLTextColor(t.pnl);
              const netPnlColor = getPnLTextColor(t.net_pnl);

              return (
                <Table.Tr key={idx} bg={t.is_test ? "rgba(255, 193, 7, 0.1)" : undefined}>
                  <Table.Td>
                    <Group gap="xs">
                      <Text size="sm">{t.strategy_name}</Text>
                      {t.is_test && (
                        <Badge color="yellow" size="sm" variant="light">
                          TEST
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text fw={600}>{t.symbol}</Text>
                  </Table.Td>
                  <Table.Td>
                    <SideBadge side={t.side} />
                  </Table.Td>
                  <Table.Td>{t.quantity}</Table.Td>
                  <Table.Td>₹{t.entry_price.toFixed(2)}</Table.Td>
                  <Table.Td>₹{t.exit_price?.toFixed(2) || "-"}</Table.Td>
                  <Table.Td>
                    <Text c={pnlColor} fw={600}>
                      {t.pnl >= 0 ? "+" : ""}₹{formatNumberShared(t.pnl)}
                      <Text span size="sm" ml={4}>
                        ({t.pnl_pct >= 0 ? "+" : ""}
                        {t.pnl_pct.toFixed(2)}%)
                      </Text>
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text c={netPnlColor} fw={600}>
                      {t.net_pnl >= 0 ? "+" : ""}₹{formatNumberShared(t.net_pnl)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <ExitReasonBadge reason={t.exit_reason} />
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Box>
    </Card>
  );
}
