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
  Tooltip,
} from "@mantine/core";
import {
  IconRefresh,
  IconPlayerPlay,
  IconPlayerStop,
  IconEye,
  IconEdit,
  IconTrash,
} from "@tabler/icons-react";
import type {
  BotTrade,
  BotPosition,
  PortfolioSummary,
  StrategyStatus,
  BotConfig,
} from "../../types/bots";
import { formatNumber as formatNumberShared, formatSignedPnl, getPnLTextColor } from "../../utils/ui-helpers";
import { SideBadge, ExitReasonBadge, StatusBadge } from "../common/BadgeComponents";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { subscribeToHolidays, isMarketClosedToday } from "../../state/holidays";

import { TINT_TEST_TRADE, BOT_RUNNING, BOT_STOPPED, BOT_SELECTED_BG } from "../../config/colors";
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
                {formatSignedPnl(portfolio.total_pnl)}
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
            {formatSignedPnl(strategy.total_pnl)}
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
                    {formatSignedPnl(p.unrealized_pnl)}
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
                <Table.Tr key={idx} bg={t.is_test ? TINT_TEST_TRADE : undefined}>
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
                    {formatSignedPnl(t.pnl)}
                    <Text span size="sm" ml={4}>
                      ({t.pnl_pct >= 0 ? "+" : ""}
                      {t.pnl_pct.toFixed(2)}%)
                    </Text>
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text c={netPnlColor} fw={600}>
                    {formatSignedPnl(t.net_pnl)}
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

interface BotActionButtonsProps {
  bot: BotConfig;
  onView: (bot: BotConfig) => void;
  onStart: (botId: string) => Promise<void>;
  onStop: (botId: string) => Promise<void>;
  onEdit: (bot: BotConfig) => void;
  onDelete: (botId: string) => Promise<void>;
}

export function BotActionButtons({
  bot,
  onView,
  onStart,
  onStop,
  onEdit,
  onDelete,
}: BotActionButtonsProps) {
  useStoreSubscription(subscribeToHolidays);
  const marketClosed = isMarketClosedToday();

  return (
    <Group gap="xs">
      <ActionIcon
        variant="subtle"
        color="blue"
        onClick={() => onView(bot)}
        title="View Status"
        data-testid={`view-bot-status-btn-${bot.id}`}
      >
        <IconEye size={16} />
      </ActionIcon>
      {bot.running ? (
        <ActionIcon
          variant="subtle"
          color="orange"
          onClick={() => onStop(bot.id)}
          title="Stop Bot"
          data-testid={`stop-bot-btn-${bot.id}`}
        >
          <IconPlayerStop size={16} />
        </ActionIcon>
      ) : (
        <Tooltip
          label="Market closed — cannot start bot"
          disabled={!marketClosed}
        >
          <span>
            <ActionIcon
              variant="subtle"
              color="green"
              onClick={() => onStart(bot.id)}
              disabled={!bot.is_active || marketClosed}
              title={marketClosed ? "Market closed" : "Start Bot"}
              data-testid={`start-bot-btn-${bot.id}`}
            >
              <IconPlayerPlay size={16} />
            </ActionIcon>
          </span>
        </Tooltip>
      )}
      <ActionIcon
        variant="subtle"
        color="blue"
        onClick={() => onEdit(bot)}
        title="Edit Bot"
        data-testid={`edit-bot-btn-${bot.id}`}
      >
        <IconEdit size={16} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="red"
        onClick={() => onDelete(bot.id)}
        disabled={bot.running}
        title="Delete Bot"
        data-testid={`delete-bot-btn-${bot.id}`}
      >
        <IconTrash size={16} />
      </ActionIcon>
    </Group>
  );
}

interface BotSummaryCellProps {
  bot: BotConfig;
}

export function BotSummaryCell({ bot }: BotSummaryCellProps) {
  return (
    <Stack gap={4}>
      <Text size="sm">{bot.strategies.length} strategies</Text>
      <Group gap="xs" wrap="wrap">
        {bot.strategies.map((s) => (
          <Badge key={s.id} size="sm" variant="light" color={!s.enable_shorts ? "orange" : undefined}>
            {s.strategy_type}
            {!s.enable_shorts && <span style={{ marginLeft: 2 }}>L</span>}
          </Badge>
        ))}
      </Group>
      {bot.strategies.map((s) => (
        <Text key={`name-${s.id}`} size="xs" c="dimmed">
          {s.name}
        </Text>
      ))}
    </Stack>
  );
}

export function getBotRowStyle(isSelected: boolean, _bot: BotConfig): React.CSSProperties {
  return {
    backgroundColor: isSelected ? BOT_SELECTED_BG : undefined,
  };
}

export function getBotIndicatorColor(running: boolean): string {
  return running ? BOT_RUNNING : BOT_STOPPED;
}

interface BotRowProps {
  bot: BotConfig;
  isSelected: boolean;
  onView: (bot: BotConfig) => void;
  onStart: (botId: string) => Promise<void>;
  onStop: (botId: string) => Promise<void>;
  onEdit: (bot: BotConfig) => void;
  onDelete: (botId: string) => Promise<void>;
}

export function BotRow({
  bot,
  isSelected,
  onView,
  onStart,
  onStop,
  onEdit,
  onDelete,
}: BotRowProps) {
  return (
    <Table.Tr
      key={bot.id}
      style={getBotRowStyle(isSelected, bot)}
      data-testid={`bot-row-${bot.id}`}
      className="bot-row"
    >
      <Table.Td>
        <Group gap="xs">
          <Box
            w={8}
            h={8}
            style={{
              borderRadius: "50%",
              backgroundColor: getBotIndicatorColor(bot.running),
            }}
          />
          <Text fw={500}>{bot.name}</Text>
          {(bot as any).live_trading && (
            <Badge color="red" size="sm" variant="filled">LIVE</Badge>
          )}
          {!bot.is_active && (
            <Badge color="gray" size="sm" variant="light">
              Inactive
            </Badge>
          )}
        </Group>
      </Table.Td>
      <Table.Td>
        <StatusBadge
          running={bot.running}
          pid={bot.pid ?? undefined}
          statusUnknown={bot.status === "UNKNOWN"}
          data-testid={`bot-status-${bot.id}`}
        />
      </Table.Td>
      <Table.Td>
        <BotSummaryCell bot={bot} />
      </Table.Td>
      <Table.Td>{bot.max_total_positions}</Table.Td>
      <Table.Td>{(bot.max_total_capital_pct * 100).toFixed(0)}%</Table.Td>
      <Table.Td>
        <BotActionButtons
          bot={bot}
          onView={onView}
          onStart={onStart}
          onStop={onStop}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </Table.Td>
    </Table.Tr>
  );
}
