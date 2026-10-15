import { memo } from "react";
import {
  Card,
  Text,
  Badge,
  Group,
  Stack,
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
          <Badge color={isGreen ? "success" : "error"} variant="light" size="sm">
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
          <Text fw={600} size="sm" ta="center">{strategy.strategy_name}</Text>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Badge color={strategy.status === "running" ? "success" : "secondary"} variant="filled" size="sm">
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
        <Progress value={Math.min(usedPct, 100)} size="sm" color="primary" />

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
      meta: { align: "left" } as any,
      cell: ({ row }) => (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
          <Text fw={600} size="sm" ta="left">{row.original.strategy_name}</Text>
        </Box>
      ),
    },
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      meta: { align: "left" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}><Text fw={600} ta="left">{row.original.symbol}</Text></Box>,
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
      meta: { align: "right" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}><Text fw={500} ta="right">{row.original.quantity}</Text></Box>,
    },
    {
      id: "entry_price",
      header: "Entry",
      accessorKey: "entry_price",
      meta: { align: "right" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}><Text size="sm" ta="right">₹{row.original.entry_price.toFixed(2)}</Text></Box>,
    },
    {
      id: "current_price",
      header: "Current",
      accessorKey: "current_price",
      meta: { align: "right" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}><Text size="sm" fw={500} ta="right">₹{row.original.current_price.toFixed(2)}</Text></Box>,
    },
    {
      id: "unrealized_pnl",
      header: "P&L",
      accessorKey: "unrealized_pnl",
      meta: { align: "right" } as any,
      cell: ({ row }) => {
        const p = row.original;
        const pnlColor = getPnLTextColor(p.unrealized_pnl);
        return (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            <Text c={pnlColor} fw={600} ta="right">
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
            <Badge color="error" variant="dot" size="sm" />
            <Text size="sm">₹{row.original.stop_loss.toFixed(2)}</Text>
            <Badge color="success" variant="dot" size="sm" />
            <Text size="sm">₹{row.original.take_profit.toFixed(2)}</Text>
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
          <Badge color="primary" variant="light" size="sm">
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
      meta: { align: "left" } as any,
      cell: ({ row }) => (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
          <Group gap={4} sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 1 }}>
            <Text fw={600} size="sm" ta="left">{row.original.strategy_name}</Text>
            {row.original.is_test && (
              <Badge color="warning" size="sm" variant="light">
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
      meta: { align: "left" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}><Text fw={600} ta="left">{row.original.symbol}</Text></Box>,
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
      meta: { align: "right" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}><Text fw={500} ta="right">{row.original.quantity}</Text></Box>,
    },
    {
      id: "entry_price",
      header: "Entry",
      accessorKey: "entry_price",
      meta: { align: "right" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}><Text size="sm" ta="right">₹{row.original.entry_price.toFixed(2)}</Text></Box>,
    },
    {
      id: "exit_price",
      header: "Exit",
      accessorKey: "exit_price",
      meta: { align: "right" } as any,
      cell: ({ row }) => (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}><Text size="sm" fw={500} ta="right">₹{row.original.exit_price?.toFixed(2) || "-"}</Text></Box>
      ),
    },
    {
      id: "pnl",
      header: "P&L",
      accessorKey: "pnl",
      meta: { align: "right" } as any,
      cell: ({ row }) => {
        const t = row.original;
        const pnlColor = getPnLTextColor(t.pnl);
        return (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            <Text c={pnlColor} fw={600} ta="right">
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
      meta: { align: "right" } as any,
      cell: ({ row }) => {
        const netPnlColor = getPnLTextColor(row.original.net_pnl);
        return (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            <Text c={netPnlColor} fw={600} ta="right">
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
      meta: { align: "left" } as any,
      cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}><ExitReasonBadge reason={row.original.exit_reason} /></Box>,
      enableSorting: false,
    },
  ];

  return (
    <Card elevation={1} padding="md" radius="md" data-testid="bot-trades" sx={{ p: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }} mb="sm">
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text fw={600} ta="center">Trade History ({trades.length})</Text></Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
          <Badge
            color="success"
            variant="filled"
            size="sm"
          >
            {trades.filter(t => t.pnl >= 0).length} W
          </Badge>
          <Badge
            color="error"
            variant="filled"
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
    <Group gap="xs" align="center">
      <ActionIcon
        variant="subtle"
        color="primary"
        onClick={() => onView(bot)}
        title="View Status"
        data-testid={`view-bot-status-btn-${bot.id}`}
      >
        <IconEye size={16} />
      </ActionIcon>
      {bot.running ? (
        <ActionIcon
          variant="subtle"
          color="warning"
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
              color="success"
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
        color="primary"
        onClick={() => onEdit(bot)}
        title="Edit Bot"
        data-testid={`edit-bot-btn-${bot.id}`}
      >
        <IconEdit size={16} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="error"
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
    <Stack gap={0.5}>
      <Text size="xs" c="text.secondary">{bot.strategies.length} strategies</Text>
      <Group gap={0.5} wrap="wrap" align="center">
        {bot.strategies.map((s) => (
          <Badge key={s.id} size="xs" variant="light" color={s.enable_shorts ? "info" : "success"}>
            {s.name}
          </Badge>
        ))}
      </Group>
    </Stack>
  );
}

export function getBotIndicatorColor(running: boolean): string {
  return running ? BOT_RUNNING : BOT_STOPPED;
}
