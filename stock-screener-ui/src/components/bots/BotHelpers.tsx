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
  Tooltip,
  Box,
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
import { SideBadge, ExitReasonBadge } from "../common/BadgeComponents";
import { TanStackTable } from "../common/TanStackTable";
import type { ColumnDef } from "@tanstack/react-table";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { subscribeToHolidays, isMarketClosedToday } from "../../state/holidays";

import {
  TINT_TEST_TRADE,
  BOT_RUNNING,
  BOT_STOPPED,
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
      elevation={1}
      padding="md"
      radius="md"
      data-testid="portfolio-summary"
      sx={{ p: 1 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text fw={600} size="sm" ta="center">Portfolio Summary</Text></Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Badge color={isGreen ? "teal" : "red"} variant="light" size="sm">
            {isGreen ? "PROFIT" : "LOSS"}
          </Badge>
        </Box>
      </Box>
      <Stack spacing={1} sx={{ gap: 1, p: 1, alignItems: "center" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1, width: "100%" }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Capital</Text>
          <Text fw={600} sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", textAlign: "right" }}>₹{formatNumberShared(portfolio.initial_capital)}</Text>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1, width: "100%" }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Cash</Text>
          <Text fw={600} sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", textAlign: "right" }}>₹{formatNumberShared(portfolio.cash)}</Text>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1, width: "100%" }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Positions</Text>
          <Text fw={600} sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", textAlign: "right" }}>{portfolio.total_positions}</Text>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1, borderRadius: 1, backgroundColor: pnlBg, width: "100%" }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Total P&L</Text>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            <Text fw={600} c={pnlColor} ta="center">
              {formatSignedPnl(portfolio.total_pnl)}
              <Text span size="sm" ml={4}>
                ({portfolio.total_pnl_pct >= 0 ? "+" : ""}
                {portfolio.total_pnl_pct.toFixed(2)}%)
              </Text>
            </Text>
          </Box>
        </Box>
      </Stack>
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
      elevation={1}
      padding="sm"
      radius="md"
      data-testid="strategy-card"
      sx={{ p: 1 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }} mb={1}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Badge color={stratColor} variant="filled" size="sm">
            {strategy.strategy_name}
          </Badge>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Badge color={strategy.status === "running" ? "green" : "gray"} variant="light" size="sm">
            {strategy.status}
          </Badge>
        </Box>
      </Box>

      <Stack spacing={1} sx={{ gap: 1, p: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Positions</Text>
          <Text size="sm" fw={500} sx={{ flex: 1, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            {strategy.positions_count}/{strategy.max_positions}
          </Text>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Capital Used</Text>
          <Text size="sm" fw={500} sx={{ flex: 1, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            ₹{formatNumberShared(strategy.capital_used)} / ₹{formatNumberShared(strategy.allocated_capital)} ({usedPct.toFixed(0)}%)
          </Text>
        </Box>
        <Progress value={Math.min(usedPct, 100)} size="sm" color={progColor} />

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>P&L</Text>
          <Text size="sm" fw={600} c={pnlColor} sx={{ flex: 1, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            {formatSignedPnl(strategy.total_pnl)}
            <Text span size="xs" ml={4}>
              ({isGreen ? "+" : ""}
              {((strategy.total_pnl / Math.max(strategy.allocated_capital, 1)) * 100).toFixed(2)}%)
            </Text>
          </Text>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }}>
          <Text size="sm" c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>Trades</Text>
          <Text size="sm" fw={500} sx={{ flex: 1, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            {strategy.trades_count}
          </Text>
        </Box>
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
      meta: { align: "center" } as any,
      cell: ({ row }) => (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Badge color={getStrategyColor(row.original.strategy_name)} variant="light" size="sm">
            {row.original.strategy_name}
          </Badge>
        </Box>
      ),
    },
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      meta: { align: "center" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text fw={600} ta="center">{row.original.symbol}</Text></Box>,
    },
    {
      id: "side",
      header: "Side",
      accessorKey: "side",
      meta: { align: "center" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><SideBadge side={row.original.side} /></Box>,
    },
    {
      id: "quantity",
      header: "Qty",
      accessorKey: "quantity",
      meta: { align: "center" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text fw={500} ta="center">{row.original.quantity}</Text></Box>,
    },
    {
      id: "entry_price",
      header: "Entry",
      accessorKey: "entry_price",
      meta: { align: "center" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text size="sm" c="dimmed" ta="center">₹{row.original.entry_price.toFixed(2)}</Text></Box>,
    },
    {
      id: "current_price",
      header: "Current",
      accessorKey: "current_price",
      meta: { align: "center" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text size="sm" fw={500} ta="center">₹{row.original.current_price.toFixed(2)}</Text></Box>,
    },
    {
      id: "unrealized_pnl",
      header: "P&L",
      accessorKey: "unrealized_pnl",
      meta: { align: "center" } as any,
      cell: ({ row }) => {
        const p = row.original;
        const pnlColor = getPnLTextColor(p.unrealized_pnl);
        return (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Text c={pnlColor} fw={600} ta="center">
              {formatSignedPnl(p.unrealized_pnl)}
              <Text span size="sm" ml={4}>
                ({p.unrealized_pnl_pct >= 0 ? "+" : ""}
                {p.unrealized_pnl_pct.toFixed(2)}%)
              </Text>
            </Text>
          </Box>
        );
      },
    },
    {
      id: "sl_tp",
      header: "SL/TP",
      meta: { align: "center" } as any,
      cell: ({ row }) => (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Group gap="xs" wrap="nowrap" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
            <Badge color="red" variant="dot" size="sm" />
            <Text size="sm" c="dimmed">₹{row.original.stop_loss.toFixed(2)}</Text>
            <Badge color="green" variant="dot" size="sm" />
            <Text size="sm" c="dimmed">₹{row.original.take_profit.toFixed(2)}</Text>
          </Group>
        </Box>
      ),
      enableSorting: false,
    },
  ];

  return (
    <Card elevation={1} padding="md" radius="md" data-testid="bot-positions" sx={{ p: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }} mb="sm">
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text fw={600} ta="center">Open Positions</Text></Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Badge color={positions.some(p => p.unrealized_pnl >= 0) ? "teal" : "red"} variant="light" size="sm">
            {positions.length} active
          </Badge>
        </Box>
      </Box>
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
      <Card elevation={1} padding="md" radius="md" data-testid="bot-trades" sx={{ p: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1 }} mb="sm">
          <Text fw={600} ta="center">
            Trade History
          </Text>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
          <Text c="dimmed" ta="center">
            No trades yet
          </Text>
        </Box>
      </Card>
    );
  }

  const columns: ColumnDef<BotTrade>[] = [
    {
      id: "strategy_name",
      header: "Strategy",
      accessorKey: "strategy_name",
      meta: { align: "center" } as any,
      cell: ({ row }) => (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Group gap="xs" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
            <Badge color={getStrategyColor(row.original.strategy_name)} variant="light" size="sm">
              {row.original.strategy_name}
            </Badge>
            {row.original.is_test && (
              <Badge color="yellow" size="sm" variant="light">
                TEST
              </Badge>
            )}
          </Group>
        </Box>
      ),
    },
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      meta: { align: "center" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text fw={600} ta="center">{row.original.symbol}</Text></Box>,
    },
    {
      id: "side",
      header: "Side",
      accessorKey: "side",
      meta: { align: "center" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><SideBadge side={row.original.side} /></Box>,
    },
    {
      id: "quantity",
      header: "Qty",
      accessorKey: "quantity",
      meta: { align: "center" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text fw={500} ta="center">{row.original.quantity}</Text></Box>,
    },
    {
      id: "entry_price",
      header: "Entry",
      accessorKey: "entry_price",
      meta: { align: "center" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text size="sm" c="dimmed" ta="center">₹{row.original.entry_price.toFixed(2)}</Text></Box>,
    },
    {
      id: "exit_price",
      header: "Exit",
      accessorKey: "exit_price",
      meta: { align: "center" } as any,
      cell: ({ row }) => (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text size="sm" fw={500} ta="center">₹{row.original.exit_price?.toFixed(2) || "-"}</Text></Box>
      ),
    },
    {
      id: "pnl",
      header: "P&L",
      accessorKey: "pnl",
      meta: { align: "center" } as any,
      cell: ({ row }) => {
        const t = row.original;
        const pnlColor = getPnLTextColor(t.pnl);
        return (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Text c={pnlColor} fw={600} ta="center">
              {formatSignedPnl(t.pnl)}
              <Text span size="sm" ml={4}>
                ({t.pnl_pct >= 0 ? "+" : ""}
                {t.pnl_pct.toFixed(2)}%)
              </Text>
            </Text>
          </Box>
        );
      },
    },
    {
      id: "net_pnl",
      header: "Net P&L",
      accessorKey: "net_pnl",
      meta: { align: "center" } as any,
      cell: ({ row }) => {
        const netPnlColor = getPnLTextColor(row.original.net_pnl);
        return (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Text c={netPnlColor} fw={600} ta="center">
              {formatSignedPnl(row.original.net_pnl)}
            </Text>
          </Box>
        );
      },
    },
    {
      id: "exit_reason",
      header: "Exit Reason",
      accessorKey: "exit_reason",
      meta: { align: "center" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><ExitReasonBadge reason={row.original.exit_reason} /></Box>,
      enableSorting: false,
    },
  ];

  return (
    <Card elevation={1} padding="md" radius="md" data-testid="bot-trades" sx={{ p: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }} mb="sm">
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text fw={600} ta="center">Trade History ({trades.length})</Text></Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
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
        </Box>
      </Box>
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

export function getBotIndicatorColor(running: boolean): string {
  return running ? BOT_RUNNING : BOT_STOPPED;
}
