import { memo } from "react";
import {
  Card,
  Text,
  Badge,
  Group,
  Stack,
  Grid,
  Progress,
  ActionIcon,
  Box,
  Tooltip,
} from "@/ui";
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
import { TanStackTable } from "../common/TanStackTable";
import type { ColumnDef } from "@tanstack/react-table";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { subscribeToHolidays, isMarketClosedToday } from "../../state/holidays";

import {
  TINT_TEST_TRADE,
  BOT_RUNNING,
  BOT_STOPPED,
  BOT_SELECTED_BG,
  TINT_POSITIVE,
  TINT_NEGATIVE,
} from "../../config/colors";

const STRATEGY_COLORS: Record<string, string> = {
  ORB: "blue",
  SR_BREAKOUT: "violet",
  EMA_CROSS: "cyan",
  WEEK_52_CHASER: "orange",
  WEEK_52_TARGET: "teal",
  BLIND_52W: "pink",
};

function getStrategyColor(type: string): string {
  return STRATEGY_COLORS[type] || "gray";
}

export function PortfolioSummaryCard({ portfolio }: { portfolio: PortfolioSummary }) {
  const pnlColor = getPnLTextColor(portfolio.total_pnl);
  const pnlBg = portfolio.total_pnl >= 0 ? TINT_POSITIVE : TINT_NEGATIVE;
  const isGreen = portfolio.total_pnl >= 0;

  return (
    <Card
      shadow="sm"
      padding="md"
      radius="md"
      withBorder
      data-testid="portfolio-summary"
      style={{ borderLeft: `4px solid var(--mantine-color-${isGreen ? "teal" : "red"}-6)` }}
    >
      <Group justify="space-between" mb="sm">
        <Text fw={600}>Portfolio Summary</Text>
        <Badge color={isGreen ? "teal" : "red"} variant="light" size="sm">
          {isGreen ? "PROFIT" : "LOSS"}
        </Badge>
      </Group>
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
            <Stack gap={0} p="xs" style={{ borderRadius: 4, backgroundColor: pnlBg }}>
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
  const stratColor = getStrategyColor(strategy.strategy_name);
  const progColor = usedPct > 80 ? "red" : usedPct > 50 ? "orange" : stratColor;
  const isGreen = strategy.total_pnl >= 0;

  return (
    <Card
      shadow="xs"
      padding="sm"
      radius="md"
      withBorder
      data-testid="strategy-card"
      style={{ borderTop: `3px solid var(--mantine-color-${stratColor}-6)` }}
    >
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Badge color={stratColor} variant="filled" size="sm">
            {strategy.strategy_name}
          </Badge>
        </Group>
        <Badge color={strategy.status === "running" ? "green" : "gray"} variant="light" size="sm">
          {strategy.status}
        </Badge>
      </Group>

      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Positions
          </Text>
          <Text size="sm" fw={500}>
            {strategy.positions_count}/{strategy.max_positions}
          </Text>
        </Group>

        <Stack gap={0}>
          <Group justify="space-between" mb={4}>
            <Text size="sm" c="dimmed">
              Capital Used
            </Text>
            <Text size="sm" fw={500}>
              ₹{formatNumberShared(strategy.capital_used)} / ₹
              {formatNumberShared(strategy.allocated_capital)} ({usedPct.toFixed(0)}%)
            </Text>
          </Group>
          <Progress value={Math.min(usedPct, 100)} size="sm" color={progColor} />
        </Stack>

        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            P&L
          </Text>
          <Text size="sm" fw={600} c={pnlColor}>
            {formatSignedPnl(strategy.total_pnl)}
            <Text span size="xs" ml={4}>
              ({isGreen ? "+" : ""}
              {((strategy.total_pnl / Math.max(strategy.allocated_capital, 1)) * 100).toFixed(2)}%)
            </Text>
          </Text>
        </Group>

        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Trades
          </Text>
          <Text size="sm" fw={500}>
            {strategy.trades_count}
          </Text>
        </Group>
      </Stack>
    </Card>
  );
}

export function PositionsTable({ positions }: { positions: BotPosition[] }) {
  if (positions.length === 0) return null;

  const columns: ColumnDef<BotPosition>[] = [
    {
      id: "strategy_name",
      header: "Strategy",
      accessorKey: "strategy_name",
      cell: ({ row }) => (
        <Badge color={getStrategyColor(row.original.strategy_name)} variant="light" size="sm">
          {row.original.strategy_name}
        </Badge>
      ),
    },
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      cell: ({ row }) => <Text fw={600}>{row.original.symbol}</Text>,
    },
    {
      id: "side",
      header: "Side",
      accessorKey: "side",
      cell: ({ row }) => <SideBadge side={row.original.side} />,
    },
    {
      id: "quantity",
      header: "Qty",
      accessorKey: "quantity",
      cell: ({ row }) => <Text fw={500}>{row.original.quantity}</Text>,
    },
    {
      id: "entry_price",
      header: "Entry",
      accessorKey: "entry_price",
      cell: ({ row }) => <Text size="sm" c="dimmed">₹{row.original.entry_price.toFixed(2)}</Text>,
    },
    {
      id: "current_price",
      header: "Current",
      accessorKey: "current_price",
      cell: ({ row }) => <Text size="sm" fw={500}>₹{row.original.current_price.toFixed(2)}</Text>,
    },
    {
      id: "unrealized_pnl",
      header: "P&L",
      accessorKey: "unrealized_pnl",
      cell: ({ row }) => {
        const p = row.original;
        const pnlColor = getPnLTextColor(p.unrealized_pnl);
        return (
          <Text c={pnlColor} fw={600}>
            {formatSignedPnl(p.unrealized_pnl)}
            <Text span size="sm" ml={4}>
              ({p.unrealized_pnl_pct >= 0 ? "+" : ""}
              {p.unrealized_pnl_pct.toFixed(2)}%)
            </Text>
          </Text>
        );
      },
    },
    {
      id: "sl_tp",
      header: "SL/TP",
      cell: ({ row }) => (
        <Group gap="xs" wrap="nowrap">
          <Badge color="red" variant="dot" size="sm" />
          <Text size="sm" c="dimmed">₹{row.original.stop_loss.toFixed(2)}</Text>
          <Badge color="green" variant="dot" size="sm" />
          <Text size="sm" c="dimmed">₹{row.original.take_profit.toFixed(2)}</Text>
        </Group>
      ),
      enableSorting: false,
    },
  ];

  return (
    <Card shadow="sm" padding="md" radius="md" withBorder data-testid="bot-positions">
      <Group justify="space-between" mb="sm">
        <Text fw={600}>Open Positions</Text>
        <Badge color={positions.some(p => p.unrealized_pnl >= 0) ? "teal" : "red"} variant="light" size="sm">
          {positions.length} active
        </Badge>
      </Group>
      <TanStackTable
        data={positions}
        columns={columns}
        dataTestId="bot-positions-table"
        emptyMessage="No open positions"
      />
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

  const columns: ColumnDef<BotTrade>[] = [
    {
      id: "strategy_name",
      header: "Strategy",
      accessorKey: "strategy_name",
      cell: ({ row }) => (
        <Group gap="xs">
          <Badge color={getStrategyColor(row.original.strategy_name)} variant="light" size="sm">
            {row.original.strategy_name}
          </Badge>
          {row.original.is_test && (
            <Badge color="yellow" size="sm" variant="light">
              TEST
            </Badge>
          )}
        </Group>
      ),
    },
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      cell: ({ row }) => <Text fw={600}>{row.original.symbol}</Text>,
    },
    {
      id: "side",
      header: "Side",
      accessorKey: "side",
      cell: ({ row }) => <SideBadge side={row.original.side} />,
    },
    {
      id: "quantity",
      header: "Qty",
      accessorKey: "quantity",
      cell: ({ row }) => <Text fw={500}>{row.original.quantity}</Text>,
    },
    {
      id: "entry_price",
      header: "Entry",
      accessorKey: "entry_price",
      cell: ({ row }) => <Text size="sm" c="dimmed">₹{row.original.entry_price.toFixed(2)}</Text>,
    },
    {
      id: "exit_price",
      header: "Exit",
      accessorKey: "exit_price",
      cell: ({ row }) => (
        <Text size="sm" fw={500}>₹{row.original.exit_price?.toFixed(2) || "-"}</Text>
      ),
    },
    {
      id: "pnl",
      header: "P&L",
      accessorKey: "pnl",
      cell: ({ row }) => {
        const t = row.original;
        const pnlColor = getPnLTextColor(t.pnl);
        return (
          <Text c={pnlColor} fw={600}>
            {formatSignedPnl(t.pnl)}
            <Text span size="sm" ml={4}>
              ({t.pnl_pct >= 0 ? "+" : ""}
              {t.pnl_pct.toFixed(2)}%)
            </Text>
          </Text>
        );
      },
    },
    {
      id: "net_pnl",
      header: "Net P&L",
      accessorKey: "net_pnl",
      cell: ({ row }) => {
        const netPnlColor = getPnLTextColor(row.original.net_pnl);
        return (
          <Text c={netPnlColor} fw={600}>
            {formatSignedPnl(row.original.net_pnl)}
          </Text>
        );
      },
    },
    {
      id: "exit_reason",
      header: "Exit Reason",
      accessorKey: "exit_reason",
      cell: ({ row }) => <ExitReasonBadge reason={row.original.exit_reason} />,
      enableSorting: false,
    },
  ];

  return (
    <Card shadow="sm" padding="md" radius="md" withBorder data-testid="bot-trades">
      <Group justify="space-between" mb="sm">
        <Text fw={600}>Trade History ({trades.length})</Text>
        <Group gap="xs">
          <Badge
            color="green"
            variant="light"
            size="sm"
          >
            {trades.filter(t => t.pnl >= 0).length} W
          </Badge>
          <Badge
            color="red"
            variant="light"
            size="sm"
          >
            {trades.filter(t => t.pnl < 0).length} L
          </Badge>
          <ActionIcon
            variant="subtle"
            onClick={onRefresh}
            title="Refresh trades"
            data-testid="refresh-trades-btn"
          >
            <IconRefresh size={16} />
          </ActionIcon>
        </Group>
      </Group>
      <TanStackTable
        data={trades}
        columns={columns}
        dataTestId="bot-trades-table"
        getRowStyle={(row) => row.is_test ? { backgroundColor: TINT_TEST_TRADE } : undefined}
      />
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

export const BotActionButtons = memo(function BotActionButtons({
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
});

interface BotSummaryCellProps {
  bot: BotConfig;
}

export function BotSummaryCell({ bot }: BotSummaryCellProps) {
  return (
    <Stack gap={4}>
      <Text size="sm">{bot.strategies.length} strategies</Text>
      <Group gap="xs" wrap="wrap">
        {bot.strategies.map((s) => (
          <Badge
            key={s.id}
            size="sm"
            variant="light"
            color={getStrategyColor(s.strategy_type)}
            style={!s.enable_shorts ? { borderLeft: "3px solid var(--mantine-color-orange-6)" } : undefined}
          >
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
    <tr
      key={bot.id}
      style={getBotRowStyle(isSelected, bot)}
      data-testid={`bot-row-${bot.id}`}
      className="bot-row"
    >
      <td>
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
          {bot.live_trading && (
            <Badge color="red" size="sm" variant="filled">LIVE</Badge>
          )}
          {!bot.is_active && (
            <Badge color="gray" size="sm" variant="light">
              Inactive
            </Badge>
          )}
        </Group>
      </td>
      <td>
        <StatusBadge
          running={bot.running}
          pid={bot.pid ?? undefined}
          statusUnknown={bot.status === "UNKNOWN"}
          data-testid={`bot-status-${bot.id}`}
        />
      </td>
      <td>
        <BotSummaryCell bot={bot} />
      </td>
      <td>{bot.max_total_positions}</td>
      <td>{(bot.max_total_capital_pct * 100).toFixed(0)}%</td>
      <td>
        <BotActionButtons
          bot={bot}
          onView={onView}
          onStart={onStart}
          onStop={onStop}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </td>
    </tr>
  );
}
