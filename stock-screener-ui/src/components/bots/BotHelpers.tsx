import { For, Show } from "solid-js";
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
import { IconRefresh, IconPlayerPlay, IconPlayerStop, IconEye, IconEdit, IconTrash } from "../common/Icons";
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
import type { TableColumnDef as ColumnDef } from "../common/TanStackTable";
import { isMarketClosedToday } from "../../state/holidays";

import {
  TINT_TEST_TRADE,
  BOT_RUNNING,
  BOT_STOPPED,
  TINT_POSITIVE,
  TINT_NEGATIVE,
} from "../../config/colors";

export function PortfolioSummaryCard(props: { portfolio: PortfolioSummary }) {
  const pnlColor = () => getPnLTextColor(props.props.portfolio.total_pnl);
  const pnlBg = () => (props.props.portfolio.total_pnl >= 0 ? TINT_POSITIVE : TINT_NEGATIVE);
  const isGreen = () => props.props.portfolio.total_pnl >= 0;

  return (
    <Card
      elevation={1}
      padding="md"
      radius="md"
      data-testid="portfolio-summary"
      className="p-2"
    >
      <Box className="flex items-center justify-between gap-2 p-2">
        <Box className="flex items-center justify-center"><Text fw={600} size="sm" ta="center">Portfolio Summary</Text></Box>
        <Box className="flex items-center justify-center">
          <Badge color={isGreen ? "success" : "error"} variant="light" size="sm">
            {isGreen() ? "PROFIT" : "LOSS"}
          </Badge>
        </Box>
      </Box>
      <Stack spacing={1} className="flex items-center gap-2 p-2">
        <Box className="flex w-full items-center justify-between gap-2 p-2">
          <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Capital</Text>
          <Text fw={600} className="flex flex-1 items-center justify-end text-right">₹{formatNumberShared(props.portfolio.initial_capital)}</Text>
        </Box>
        <Box className="flex w-full items-center justify-between gap-2 p-2">
          <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Cash</Text>
          <Text fw={600} className="flex flex-1 items-center justify-end text-right">₹{formatNumberShared(props.portfolio.cash)}</Text>
        </Box>
        <Box className="flex w-full items-center justify-between gap-2 p-2">
          <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Positions</Text>
          <Text fw={600} className="flex flex-1 items-center justify-end text-right">{props.portfolio.total_positions}</Text>
        </Box>
        <Box className="flex w-full items-center justify-between gap-2 rounded p-2" style={{ "background-color": pnlBg() }}>
          <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Total P&L</Text>
          <Box className="flex flex-1 items-center justify-end">
            <Text fw={600} c={pnlColor()} ta="center">
              {formatSignedPnl(props.portfolio.total_pnl)}
              <Text span size="sm" ml={4}>
                ({props.props.portfolio.total_pnl_pct >= 0 ? "+" : ""}
                {props.props.portfolio.total_pnl_pct.toFixed(2)}%)
              </Text>
            </Text>
          </Box>
        </Box>
      </Stack>
    </Card>
  );
}

export function StrategyStatusCard(props: {
  strategy: StrategyStatus;
  isRunning: boolean;
}) {
  const usedPct = () => (props.strategy.capital_used / props.strategy.allocated_capital) * 100;
  const pnlColor = () => getPnLTextColor(props.strategy.total_pnl);
  const isGreen = () => props.strategy.total_pnl >= 0;

  return (
    <Card
      elevation={1}
      padding="sm"
      radius="md"
      data-testid="strategy-card"
      className="p-2"
    >
      <Box className="flex items-center justify-between gap-2 p-2" mb={1}>
        <Box className="flex items-center justify-center">
          <Text fw={600} size="sm" ta="center">{props.strategy.strategy_name}</Text>
        </Box>
        <Box className="flex items-center justify-center">
          <Badge color={props.strategy.status === "running" ? "success" : "secondary"} variant="filled" size="sm">
            {props.strategy.status}
          </Badge>
        </Box>
      </Box>

      <Stack spacing={1} className="gap-2 p-2">
        <Box className="flex items-center justify-between gap-2 p-2">
          <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Positions</Text>
          <Text size="sm" fw={500} className="flex flex-1 items-center justify-end text-right">
            {props.strategy.positions_count}/{props.strategy.max_positions}
          </Text>
        </Box>

        <Box className="flex items-center justify-between gap-2 p-2">
          <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Capital Used</Text>
          <Text size="sm" fw={500} className="flex flex-1 items-center justify-end text-right">
            ₹{formatNumberShared(props.strategy.capital_used)} / ₹{formatNumberShared(props.strategy.allocated_capital)} ({usedPct().toFixed(0)}%)
          </Text>
        </Box>
        <Progress value={Math.min(usedPct(), 100)} size="sm" color="primary" />

        <Box className="flex items-center justify-between gap-2 p-2">
          <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">P&L</Text>
          <Text size="sm" fw={600} c={pnlColor()} className="flex flex-1 items-center justify-end text-right">
            {formatSignedPnl(props.strategy.total_pnl)}
            <Text span size="xs" ml={4}>
              ({isGreen() ? "+" : ""}
              {((props.strategy.total_pnl / Math.max(props.strategy.allocated_capital, 1)) * 100).toFixed(2)}%)
            </Text>
          </Text>
        </Box>

        <Box className="flex items-center justify-between gap-2 p-2">
          <Text size="sm" c="dimmed" className="flex items-center min-w-[80px]">Trades</Text>
          <Text size="sm" fw={500} className="flex flex-1 items-center justify-end text-right">
            {props.strategy.trades_count}
          </Text>
        </Box>
      </Stack>
    </Card>
  );
}

export function PositionsTable(props: { positions: BotPosition[] }) {
  const columns: ColumnDef<BotPosition>[] = [
    {
      id: "strategy_name",
      header: "Strategy",
      accessorKey: "strategy_name",
      meta: { align: "left" },
      cell: ({ row }) => (
        <Box className="flex items-center justify-start">
          <Text fw={600} size="sm" ta="left">{row.original.strategy_name}</Text>
        </Box>
      ),
    },
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      meta: { align: "left" },
      cell: ({ row }) => <Box className="flex items-center justify-start"><Text fw={600} ta="left">{row.original.symbol}</Text></Box>,
    },
    {
      id: "side",
      header: "Side",
      accessorKey: "side",
      meta: { align: "center" },
      cell: ({ row }) => <Box className="flex items-center justify-center"><SideBadge side={row.original.side} /></Box>,
    },
    {
      id: "quantity",
      header: "Qty",
      accessorKey: "quantity",
      meta: { align: "right" },
      cell: ({ row }) => <Text fw={500} ta="right">{row.original.quantity}</Text>,
    },
    {
      id: "entry_price",
      header: "Entry",
      accessorKey: "entry_price",
      meta: { align: "right" },
      cell: ({ row }) => <Text size="sm" ta="right">₹{row.original.entry_price.toFixed(2)}</Text>,
    },
    {
      id: "current_price",
      header: "Current",
      accessorKey: "current_price",
      meta: { align: "right" },
      cell: ({ row }) => <Text size="sm" fw={500} ta="right">₹{row.original.current_price.toFixed(2)}</Text>,
    },
    {
      id: "unrealized_pnl",
      header: "P&L",
      accessorKey: "unrealized_pnl",
      meta: { align: "right" },
      cell: ({ row }) => {
        const p = row.original;
        const pnlColor = getPnLTextColor(p.unrealized_pnl);
        return (
          <Text c={pnlColor()} fw={600} ta="right">
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
      meta: { align: "center" },
      cell: ({ row }) => (
        <Box className="flex items-center justify-center">
          <Group gap="xs" wrap="nowrap" className="flex items-center justify-center gap-2">
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
    <Show when={props.positions.length > 0}>
      <Card elevation={1} padding="md" radius="md" data-testid="bot-positions" className="p-2">
        <Box className="flex items-center justify-between gap-2 p-2" mb="sm">
          <Box className="flex items-center justify-center"><Text fw={600} ta="center">Open Positions</Text></Box>
          <Box className="flex items-center justify-center">
            <Badge color="primary" variant="light" size="sm">
              {props.positions.length} active
            </Badge>
          </Box>
        </Box>
        <TanStackTable
          data={props.positions}
          columns={columns}
          dataTestId="bot-positions-table"
          emptyMessage="No open positions"
        />
      </Card>
    </Show>
  );
}

export function TradesTable(props: { trades: BotTrade[]; onRefresh: () => void }) {
  const columns: ColumnDef<BotTrade>[] = [
    {
      id: "strategy_name",
      header: "Strategy",
      accessorKey: "strategy_name",
      meta: { align: "left" },
      cell: ({ row }) => (
        <Box className="flex items-center justify-start">
          <Group gap={4} className="flex items-center justify-start gap-2">
            <Text fw={600} size="sm" ta="left">{row.original.strategy_name}</Text>
            <Show when={row.original.is_test}>
              <Badge color="warning" size="sm" variant="light">
                TEST
              </Badge>
            </Show>
          </Group>
        </Box>
      ),
    },
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      meta: { align: "left" },
      cell: ({ row }) => <Box className="flex items-center justify-start"><Text fw={600} ta="left">{row.original.symbol}</Text></Box>,
    },
    {
      id: "side",
      header: "Side",
      accessorKey: "side",
      meta: { align: "center" },
      cell: ({ row }) => <Box className="flex items-center justify-center"><SideBadge side={row.original.side} /></Box>,
    },
    {
      id: "quantity",
      header: "Qty",
      accessorKey: "quantity",
      meta: { align: "right" },
      cell: ({ row }) => <Text fw={500} ta="right">{row.original.quantity}</Text>,
    },
    {
      id: "entry_price",
      header: "Entry",
      accessorKey: "entry_price",
      meta: { align: "right" },
      cell: ({ row }) => <Text size="sm" ta="right">₹{row.original.entry_price.toFixed(2)}</Text>,
    },
    {
      id: "exit_price",
      header: "Exit",
      accessorKey: "exit_price",
      meta: { align: "right" },
      cell: ({ row }) => <Text size="sm" fw={500} ta="right">₹{row.original.exit_price?.toFixed(2) || "-"}</Text>,
    },
    {
      id: "pnl",
      header: "P&L",
      accessorKey: "pnl",
      meta: { align: "right" },
      cell: ({ row }) => {
        const t = row.original;
        const pnlColor = getPnLTextColor(t.pnl);
        return (
          <Text c={pnlColor()} fw={600} ta="right">
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
      meta: { align: "right" },
      cell: ({ row }) => {
        const netPnlColor = getPnLTextColor(row.original.net_pnl);
        return (
          <Text c={netPnlColor} fw={600} ta="right">
            {formatSignedPnl(row.original.net_pnl)}
          </Text>
        );
      },
    },
    {
      id: "exit_reason",
      header: "Exit Reason",
      accessorKey: "exit_reason",
      meta: { align: "left" },
      cell: ({ row }) => <Box className="flex items-center justify-start"><ExitReasonBadge reason={row.original.exit_reason} /></Box>,
      enableSorting: false,
    },
  ];

  const wins = () => props.trades.filter((t) => t.pnl >= 0).length;
  const losses = () => props.trades.filter((t) => t.pnl < 0).length;

  return (
    <Show
      when={props.trades.length > 0}
      fallback={
        <Card elevation={1} padding="md" radius="md" data-testid="bot-trades" className="p-2">
          <Box className="flex items-center justify-center p-2" mb="sm">
            <Text fw={600} ta="center">
              Trade History
            </Text>
          </Box>
          <Box className="flex items-center justify-center p-2">
            <Text c="dimmed" ta="center">
              No trades yet
            </Text>
          </Box>
        </Card>
      }
    >
      <Card elevation={1} padding="md" radius="md" data-testid="bot-trades" className="p-2">
        <Box className="flex items-center justify-between gap-2 p-2" mb="sm">
          <Box className="flex items-center justify-center"><Text fw={600} ta="center">Trade History ({props.trades.length})</Text></Box>
          <Box className="flex items-center justify-center gap-2">
            <Badge
              color="success"
              variant="filled"
              size="sm"
            >
              {wins()} W
            </Badge>
            <Badge
              color="error"
              variant="filled"
              size="sm"
            >
              {losses()} L
            </Badge>
            <ActionIcon
              variant="subtle"
              onClick={props.onRefresh}
              title="Refresh trades"
              data-testid="refresh-trades-btn"
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Box>
        </Box>
        <TanStackTable
          data={props.trades}
          columns={columns}
          dataTestId="bot-trades-table"
          getRowStyle={(row) => row.is_test ? { "background-color": TINT_TEST_TRADE } : undefined}
        />
      </Card>
    </Show>
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

export function BotActionButtons(props: BotActionButtonsProps) {
  const marketClosed = () => isMarketClosedToday();

  return (
    <Group gap="xs" align="center">
      <ActionIcon
        variant="subtle"
        color="primary"
        onClick={() => props.onView(props.bot)}
        title="View Status"
        data-testid={`view-bot-status-btn-${props.bot.id}`}
      >
        <IconEye size={16} />
      </ActionIcon>
      <Show when={props.bot.running}
        fallback={
          <Tooltip
            label="Market closed — cannot start bot"
            disabled={!marketClosed()}
          >
            <span>
              <ActionIcon
                variant="subtle"
                color="success"
                onClick={() => props.onStart(props.bot.id)}
                disabled={!props.bot.is_active || marketClosed()}
                title={marketClosed() ? "Market closed" : "Start Bot"}
                data-testid={`start-bot-btn-${props.bot.id}`}
              >
                <IconPlayerPlay size={16} />
              </ActionIcon>
            </span>
          </Tooltip>
        }
      >
        <ActionIcon
          variant="subtle"
          color="warning"
          onClick={() => props.onStop(props.bot.id)}
          title="Stop Bot"
          data-testid={`stop-bot-btn-${props.bot.id}`}
        >
          <IconPlayerStop size={16} />
        </ActionIcon>
      </Show>
      <ActionIcon
        variant="subtle"
        color="primary"
        onClick={() => props.onEdit(props.bot)}
        title="Edit Bot"
        data-testid={`edit-bot-btn-${props.bot.id}`}
      >
        <IconEdit size={16} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="error"
        onClick={() => props.onDelete(props.bot.id)}
        disabled={props.bot.running}
        title="Delete Bot"
        data-testid={`delete-bot-btn-${props.bot.id}`}
      >
        <IconTrash size={16} />
      </ActionIcon>
    </Group>
  );
}

interface BotSummaryCellProps {
  bot: BotConfig;
}

export function BotSummaryCell(props: BotSummaryCellProps) {
  return (
    <Stack gap={0.5}>
      <Text size="xs" c="text.secondary">{props.bot.strategies.length} strategies</Text>
      <Group gap={0.5} wrap="wrap" align="center">
        <For each={props.bot.strategies}>{(s) => (
          <Badge size="xs" variant="light" color={s.enable_shorts ? "info" : "success"}>
            {s.name}
          </Badge>
        )}</For>
      </Group>
    </Stack>
  );
}

export function getBotIndicatorColor(running: boolean): string {
  return running ? BOT_RUNNING : BOT_STOPPED;
}
