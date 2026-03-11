import { useEffect } from "react";
import {
  Box,
  Card,
  Text,
  Badge,
  Button,
  Group,
  Stack,
  Grid,
  Progress,
  Table,
  ActionIcon,
  Loader,
} from "@mantine/core";
import { IconRefresh, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import type {
  BotConfig,
  BotStatus,
  BotTrade,
  BotPosition,
  PortfolioSummary,
  StrategyStatus,
} from "../../types/bots";
import {
  loadBotStatus,
  loadBotTrades,
  startBotAction,
  stopBotAction,
  startAutoRefresh,
  stopAutoRefresh,
} from "../../state/bots";

interface BotStatusPanelProps {
  bot: BotConfig;
  status: BotStatus | null;
  trades: BotTrade[];
  onStart: (botId: string) => Promise<void>;
  onStop: (botId: string) => Promise<void>;
}

function formatNumber(num: number): string {
  if (Math.abs(num) >= 100000) {
    return (num / 100000).toFixed(1) + "L";
  } else if (Math.abs(num) >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toFixed(0);
}

function formatExitReason(reason: string): string {
  const reasons: Record<string, string> = {
    target: "Target",
    stop_loss: "Stop Loss",
    signal: "Signal",
    manual: "Manual",
    timeout: "Timeout",
  };
  return reasons[reason] || reason;
}

function PortfolioSummaryCard({ portfolio }: { portfolio: PortfolioSummary }) {
  const pnlColor = portfolio.total_pnl >= 0 ? "green" : "red";
  const dailyPnlColor = portfolio.daily_pnl >= 0 ? "green" : "red";

  return (
    <Card shadow="sm" padding="md" radius="md" withBorder data-testid="portfolio-summary">
      <Text fw={600} mb="sm">
        Portfolio Summary
      </Text>
      <Grid>
        <Grid.Col span={6}>
          <Stack gap="xs">
            <div>
              <Text size="xs" c="dimmed">
                Capital
              </Text>
              <Text fw={600}>₹{formatNumber(portfolio.initial_capital)}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Cash
              </Text>
              <Text fw={600}>₹{formatNumber(portfolio.cash)}</Text>
            </div>
          </Stack>
        </Grid.Col>
        <Grid.Col span={6}>
          <Stack gap="xs">
            <div>
              <Text size="xs" c="dimmed">
                Positions
              </Text>
              <Text fw={600}>{portfolio.total_positions}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                Total P&L
              </Text>
              <Text fw={600} c={pnlColor}>
                {portfolio.total_pnl >= 0 ? "+" : ""}₹{formatNumber(portfolio.total_pnl)}
                <Text span size="xs" ml={4}>
                  ({portfolio.total_pnl_pct >= 0 ? "+" : ""}
                  {portfolio.total_pnl_pct.toFixed(2)}%)
                </Text>
              </Text>
            </div>
          </Stack>
        </Grid.Col>
      </Grid>
    </Card>
  );
}

function StrategyStatusCard({
  strategy,
  isRunning,
}: {
  strategy: StrategyStatus;
  isRunning: boolean;
}) {
  const usedPct = (strategy.capital_used / strategy.allocated_capital) * 100;
  const pnlColor = strategy.total_pnl >= 0 ? "green" : "red";

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
          <Text size="xs" c="dimmed">
            Positions
          </Text>
          <Text size="xs">
            {strategy.positions_count}/{strategy.max_positions}
          </Text>
        </Group>

        <div>
          <Group justify="space-between" mb={4}>
            <Text size="xs" c="dimmed">
              Capital Used
            </Text>
            <Text size="xs">
              ₹{formatNumber(strategy.capital_used)} / ₹{formatNumber(strategy.allocated_capital)} (
              {usedPct.toFixed(0)}%)
            </Text>
          </Group>
          <Progress value={Math.min(usedPct, 100)} size="sm" color="blue" />
        </div>

        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            P&L
          </Text>
          <Text size="xs" fw={600} c={pnlColor}>
            {strategy.total_pnl >= 0 ? "+" : ""}₹{formatNumber(strategy.total_pnl)}
          </Text>
        </Group>

        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            Trades
          </Text>
          <Text size="xs">{strategy.trades_count}</Text>
        </Group>
      </Stack>
    </Card>
  );
}

function PositionsTable({ positions }: { positions: BotPosition[] }) {
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
            const pnlColor = p.unrealized_pnl >= 0 ? "green" : "red";
            return (
              <Table.Tr key={idx}>
                <Table.Td>{p.strategy_name}</Table.Td>
                <Table.Td>
                  <Text fw={600}>{p.symbol}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge color={p.side === "BUY" ? "green" : "red"} variant="light" size="sm">
                    {p.side}
                  </Badge>
                </Table.Td>
                <Table.Td>{p.quantity}</Table.Td>
                <Table.Td>₹{p.entry_price.toFixed(2)}</Table.Td>
                <Table.Td>₹{p.current_price.toFixed(2)}</Table.Td>
                <Table.Td>
                  <Text c={pnlColor} fw={600}>
                    {p.unrealized_pnl >= 0 ? "+" : ""}₹{formatNumber(p.unrealized_pnl)}
                    <Text span size="xs" ml={4}>
                      ({p.unrealized_pnl_pct >= 0 ? "+" : ""}
                      {p.unrealized_pnl_pct.toFixed(2)}%)
                    </Text>
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
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

function TradesTable({ trades, onRefresh }: { trades: BotTrade[]; onRefresh: () => void }) {
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
              const pnlColor = t.pnl >= 0 ? "green" : "red";
              const netPnlColor = t.net_pnl >= 0 ? "green" : "red";

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
                    <Badge color={t.side === "BUY" ? "green" : "red"} variant="light" size="sm">
                      {t.side}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{t.quantity}</Table.Td>
                  <Table.Td>₹{t.entry_price.toFixed(2)}</Table.Td>
                  <Table.Td>₹{t.exit_price?.toFixed(2) || "-"}</Table.Td>
                  <Table.Td>
                    <Text c={pnlColor} fw={600}>
                      {t.pnl >= 0 ? "+" : ""}₹{formatNumber(t.pnl)}
                      <Text span size="xs" ml={4}>
                        ({t.pnl_pct >= 0 ? "+" : ""}
                        {t.pnl_pct.toFixed(2)}%)
                      </Text>
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text c={netPnlColor} fw={600}>
                      {t.net_pnl >= 0 ? "+" : ""}₹{formatNumber(t.net_pnl)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={
                        t.exit_reason === "target"
                          ? "green"
                          : t.exit_reason === "stop_loss"
                            ? "red"
                            : "gray"
                      }
                      variant="light"
                      size="sm"
                    >
                      {formatExitReason(t.exit_reason)}
                    </Badge>
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

export function BotStatusPanel({ bot, status, trades, onStart, onStop }: BotStatusPanelProps) {
  const handleRefresh = async () => {
    await Promise.all([loadBotStatus(bot.id), loadBotTrades(bot.id)]);
  };

  const handleStart = async () => {
    await onStart(bot.id);
    await loadBotStatus(bot.id);
    await loadBotTrades(bot.id);
    startAutoRefresh(bot.id, 5000);
  };

  const handleStop = async () => {
    await onStop(bot.id);
    stopAutoRefresh();
    await loadBotStatus(bot.id);
  };

  const handleRefreshTrades = async () => {
    await loadBotTrades(bot.id);
  };

  return (
    <Box data-testid="bot-status-panel" data-bot-id={bot.id}>
      <Stack gap="md">
        {/* Bot Header */}
        <Card shadow="sm" padding="md" radius="md" withBorder>
          <Group justify="space-between">
            <div>
              <Text fw={700} size="lg">
                {bot.name}
              </Text>
              <Badge color={status?.running ? "green" : "gray"} variant="light" mt={4}>
                {status?.running ? `● Running (PID ${status.pid})` : "○ Stopped"}
              </Badge>
            </div>
            <Group gap="xs">
              {status?.running ? (
                <Button
                  leftSection={<IconPlayerStop size={16} />}
                  variant="light"
                  color="orange"
                  onClick={handleStop}
                  data-testid="stop-bot-btn"
                >
                  Stop Bot
                </Button>
              ) : (
                <Button
                  leftSection={<IconPlayerPlay size={16} />}
                  variant="light"
                  color="green"
                  onClick={handleStart}
                  data-testid="start-bot-btn"
                >
                  Start Bot
                </Button>
              )}
              <Button
                leftSection={<IconRefresh size={16} />}
                variant="subtle"
                onClick={handleRefresh}
                data-testid="refresh-bot-status-btn"
              >
                Refresh
              </Button>
            </Group>
          </Group>
        </Card>

        {/* Portfolio Summary */}
        {status?.portfolio ? (
          <PortfolioSummaryCard portfolio={status.portfolio} />
        ) : (
          <Card shadow="sm" padding="md" radius="md" withBorder>
            <Text c="dimmed" ta="center">
              Start the bot to see live portfolio data
            </Text>
          </Card>
        )}

        {/* Strategies Status */}
        {status?.strategies && (
          <div data-testid="strategies-status">
            <Text fw={600} mb="sm">
              Strategy Status
            </Text>
            <Grid>
              {Object.values(status.strategies).map((s) => (
                <Grid.Col key={s.strategy_id} span={{ base: 12, sm: 6, md: 4 }}>
                  <StrategyStatusCard strategy={s} isRunning={status?.running ?? false} />
                </Grid.Col>
              ))}
            </Grid>
          </div>
        )}

        {/* Positions */}
        {status?.positions && status.positions.length > 0 && (
          <PositionsTable positions={status.positions} />
        )}

        {/* Trade History */}
        <TradesTable trades={trades} onRefresh={handleRefreshTrades} />

        {/* Last Update */}
        {status?.last_update && (
          <Text size="xs" c="dimmed" ta="center">
            Last update: {new Date(status.last_update).toLocaleTimeString()}
          </Text>
        )}
      </Stack>
    </Box>
  );
}
