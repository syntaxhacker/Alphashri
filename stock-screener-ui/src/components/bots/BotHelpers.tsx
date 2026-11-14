import { For, Show, type JSX } from "solid-js";
import {
  Card,
  Text,
  Badge,
  Group,
  Stack,
  Progress,
  ActionIcon,
  ToolbarRow,
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

const STAT_LABEL: JSX.CSSProperties = { "font-size": "10px", "letter-spacing": "0.04em", "text-transform": "uppercase" };
const SECTION_LABEL: JSX.CSSProperties = { "font-size": "10px", "letter-spacing": "0.06em", "text-transform": "uppercase" };

function StatLine(props: { label: string; value: JSX.Element; tone?: string }) {
  return (
    <Box className="flex items-center justify-between gap-2" style={{ "min-height": "18px" }}>
      <Text size="xs" c="dimmed" tt="uppercase" style={STAT_LABEL}>{props.label}</Text>
      <Text size="xs" fw={600} class="font-mono tabular-nums text-right" c={props.tone}>{props.value}</Text>
    </Box>
  );
}

export function PortfolioSummaryCard(props: { portfolio: PortfolioSummary }) {
  const pnlColor = () => getPnLTextColor(props.portfolio.total_pnl);
  const pnlBg = () => (props.portfolio.total_pnl >= 0 ? TINT_POSITIVE : TINT_NEGATIVE);
  const isGreen = () => props.portfolio.total_pnl >= 0;

  return (
    <Card
      padding="xs"
      data-testid="portfolio-summary"
      className="shrink-0"
    >
      <ToolbarRow gap={8} wrap={false} className="px-2" style={{ height: "24px" }}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={SECTION_LABEL}>
          Portfolio Summary
        </Text>
        <Badge className="ml-auto" color={isGreen() ? "success" : "error"} variant="light" size="xs">
          {isGreen() ? "PROFIT" : "LOSS"}
        </Badge>
      </ToolbarRow>
      <Box className="grid grid-cols-2 gap-x-4 px-2 pb-1">
        <StatLine label="Capital" value={`₹${formatNumberShared(props.portfolio.initial_capital)}`} />
        <StatLine label="Cash" value={`₹${formatNumberShared(props.portfolio.cash)}`} />
        <StatLine label="Positions" value={String(props.portfolio.total_positions)} />
        <Box className="flex items-center justify-between gap-2 rounded px-1" style={{ "background-color": pnlBg(), "min-height": "18px" }}>
          <Text size="xs" c="dimmed" tt="uppercase" style={STAT_LABEL}>Total P&L</Text>
          <Text size="xs" fw={600} c={pnlColor()} class="font-mono tabular-nums">
            {formatSignedPnl(props.portfolio.total_pnl)}
            <Text span size="xs" ml={4}>
              ({props.portfolio.total_pnl_pct >= 0 ? "+" : ""}
              {props.portfolio.total_pnl_pct.toFixed(2)}%)
            </Text>
          </Text>
        </Box>
      </Box>
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
      padding="xs"
      data-testid="strategy-card"
      className="min-w-0"
    >
      <ToolbarRow gap={8} wrap={false} className="px-2" style={{ height: "24px", "border-bottom": "1px solid var(--color-fin-border)" }}>
        <Text size="xs" fw={700} truncate data-testid="strategy-card-name">{props.strategy.strategy_name}</Text>
        <Badge className="ml-auto" color={props.strategy.status === "running" ? "success" : "secondary"} variant="filled" size="xs">
          {props.strategy.status}
        </Badge>
      </ToolbarRow>
      <Box className="flex flex-col gap-0.5 px-2 py-1">
        <StatLine label="Positions" value={`${props.strategy.positions_count}/${props.strategy.max_positions}`} />
        <StatLine
          label="Capital Used"
          value={`₹${formatNumberShared(props.strategy.capital_used)} / ₹${formatNumberShared(props.strategy.allocated_capital)} (${usedPct().toFixed(0)}%)`}
        />
        <Progress value={Math.min(usedPct(), 100)} size="xs" color="primary" />
        <StatLine
          label="P&L"
          tone={pnlColor()}
          value={
            <>
              {formatSignedPnl(props.strategy.total_pnl)}
              <Text span size="xs" ml={4}>
                ({isGreen() ? "+" : ""}
                {((props.strategy.total_pnl / Math.max(props.strategy.allocated_capital, 1)) * 100).toFixed(2)}%)
              </Text>
            </>
          }
        />
        <StatLine label="Trades" value={String(props.strategy.trades_count)} />
      </Box>
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
          <Text c={pnlColor} fw={600} ta="right">
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
      <Card padding="xs" data-testid="bot-positions" className="flex min-h-0 flex-col">
        <ToolbarRow gap={8} wrap={false} className="shrink-0 px-2" style={{ height: "26px", "border-bottom": "1px solid var(--color-fin-border)" }}>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={SECTION_LABEL}>Open Positions</Text>
          <Badge color="primary" variant="light" size="xs">
            {props.positions.length} active
          </Badge>
        </ToolbarRow>
        <TanStackTable
          data={props.positions}
          columns={columns}
          dataTestId="bot-positions-table"
          emptyMessage="No open positions"
          dense
          bare
          fillContainer
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
          <Text c={pnlColor} fw={600} ta="right">
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
        <Card padding="xs" data-testid="bot-trades" className="flex min-h-0 flex-col">
          <ToolbarRow gap={8} wrap={false} className="shrink-0 px-2" style={{ height: "26px", "border-bottom": "1px solid var(--color-fin-border)" }}>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={SECTION_LABEL}>Trade History</Text>
            <Badge size="xs" variant="light" color="secondary">0</Badge>
          </ToolbarRow>
          <Box className="flex flex-1 items-center justify-center p-2">
            <Text size="xs" c="dimmed">No trades yet</Text>
          </Box>
        </Card>
      }
    >
      <Card padding="xs" data-testid="bot-trades" className="flex min-h-0 flex-1 flex-col">
        <ToolbarRow gap={8} wrap={false} className="shrink-0 px-2" style={{ height: "26px", "border-bottom": "1px solid var(--color-fin-border)" }}>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={SECTION_LABEL}>
            Trade History ({props.trades.length})
          </Text>
          <Box className="ml-auto flex items-center gap-2">
            <Badge color="success" variant="filled" size="xs">{wins()} W</Badge>
            <Badge color="error" variant="filled" size="xs">{losses()} L</Badge>
            <ActionIcon
              variant="subtle"
              onClick={props.onRefresh}
              title="Refresh trades"
              data-testid="refresh-trades-btn"
            >
              <IconRefresh size={14} />
            </ActionIcon>
          </Box>
        </ToolbarRow>
        <TanStackTable
          data={props.trades}
          columns={columns}
          dataTestId="bot-trades-table"
          dense
          bare
          fillContainer
          getRowStyle={(row) => row.is_test ? { backgroundColor: TINT_TEST_TRADE } : undefined}
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
      <Text size="xs" c="dimmed">{props.bot.strategies.length} strategies</Text>
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
