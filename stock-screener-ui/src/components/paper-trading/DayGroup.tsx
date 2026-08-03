import { memo, useCallback, useRef, useEffect, useState, useMemo } from "react";
import {
  Anchor,
  Collapse,
  Badge,
  Text,
  Group,
  Flex,
  ActionIcon,
  Grid,
  Stack,
  Textarea,
  Button,
  Box,
} from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import type { PaperTrade } from "../../types/paperTrading";
import {
  formatNumber,
  formatSignedPnl,
  formatTimeOnly,
  formatDateHeader,
  formatDuration,
  getPnLTextColor,
  getStrategyTypeFromName,
} from "../../utils/ui-helpers";
import { SideBadge, ExitReasonBadge } from "../common";
import { ClickableSymbol } from "../common";
import { TanStackTable } from "../common/TanStackTable";
import { setFilterStrategy, setFilterBot, updateTradeNotesAction } from "../../state/paperTrading";

interface DayGroupProps {
  date: string;
  trades: PaperTrade[];
  selectedSymbol: string | null;
  selectedTradeId: string | null;
  onSelectSymbol: (
    symbol: string,
    exitTime?: string,
    tradeId?: string,
    strategyType?: string,
    strategyId?: number,
    entryTime?: string,
  ) => void;
  onDeleteTrade: (tradeId: string) => void;
  expanded: boolean;
  onToggle: () => void;
  tableStyles: Record<string, any>;
}

const DaySummary = memo(function DaySummary({
  date,
  trades,
  onToggle,
}: {
  date: string;
  trades: PaperTrade[];
  onToggle: () => void;
}) {
  const dayPnl = trades.reduce((sum, t) => sum + t.net_pnl, 0);
  const wins = trades.filter((t) => t.net_pnl > 0).length;
  const losses = trades.filter((t) => t.net_pnl < 0).length;
  const pnlColor = getPnLTextColor(dayPnl);

  return (
    <Group
      justify="space-between"
      px={4}
      py={1}
      onClick={onToggle}
      style={{ cursor: "pointer" }}
      data-testid={`day-header-${date}`}
    >
      <Group gap="xs">
        <Text size="xs" fw={600} c="dimmed" tt="uppercase">
          {formatDateHeader(date)}
        </Text>
      </Group>
      <Group gap="xs">
        <Text size="xs" c={pnlColor} fw={600}>
          {formatSignedPnl(dayPnl)}
        </Text>
        <Badge color={wins > 0 ? "green" : "gray"} variant="light" size="xs">
          ▲{wins}
        </Badge>
        <Badge color={losses > 0 ? "red" : "gray"} variant="light" size="xs">
          ▼{losses}
        </Badge>
      </Group>
    </Group>
  );
});

const TradeStats = memo(function TradeStats({ trade }: { trade: PaperTrade }) {
  const grossPnl = trade.pnl;
  const grossColor = getPnLTextColor(grossPnl);
  const netPnl = trade.net_pnl;
  const netColor = getPnLTextColor(netPnl);

  const entryContext = [
    { label: "Trade ID", value: `#${trade.trade_id}` },
    { label: "Entry Time", value: formatTimeOnly(trade.entry_time) },
    { label: "Peak", value: `₹${trade.peak_price?.toFixed(2) ?? "-"}` },
    { label: "Low", value: `₹${trade.low_price?.toFixed(2) ?? "-"}` },
    { label: "Hold", value: trade.hold_duration_minutes != null ? formatDuration(trade.hold_duration_minutes) : "-" },
  ];

  const exitContext = [
    { label: "Exit Time", value: formatTimeOnly(trade.exit_time) },
    { label: "Exit Price", value: trade.exit_price != null ? `₹${trade.exit_price.toFixed(2)}` : "-" },
    { label: "Costs", value: `₹${formatNumber(trade.costs)}` },
    { label: "Gross P&L", value: formatSignedPnl(grossPnl), color: grossColor },
    { label: "Net P&L", value: formatSignedPnl(netPnl), color: netColor },
  ];

  return (
    <Grid gutter={2}>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Stack gap={2}>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">Entry</Text>
          {entryContext.map((item) => (
            <Group key={item.label} gap="xs" justify="space-between">
              <Text size="xs" c="dimmed">{item.label}</Text>
              <Text size="sm" fw={500} c={item.color}>{item.value}</Text>
            </Group>
          ))}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Stack gap={2}>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">Exit</Text>
          {exitContext.map((item) => (
            <Group key={item.label} gap="xs" justify="space-between">
              <Text size="xs" c="dimmed">{item.label}</Text>
              <Text size="sm" fw={500} c={item.color}>{item.value}</Text>
            </Group>
          ))}
          <Group gap="xs" justify="space-between">
            <Text size="xs" c="dimmed">Exit Reason</Text>
            <ExitReasonBadge reason={trade.exit_reason} />
          </Group>
        </Stack>
      </Grid.Col>
    </Grid>
  );
});

const TradeNotesEditor = memo(function TradeNotesEditor({ trade }: { trade: PaperTrade }) {
  const [reason, setReason] = useState(trade.reason || "");
  const [notes, setNotes] = useState(trade.notes || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await updateTradeNotesAction(trade.trade_id, notes, reason);
    setSaving(false);
  };

  return (
    <Stack gap={2}>
      <Group gap="xs" align="flex-start" grow>
        <Stack gap={1} style={{ flex: 1 }}>
          <Text size="xs" c="dimmed">Reason</Text>
          <Text size="xs" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }} data-testid={`trade-reason-${trade.trade_id}`}>
            {trade.reason || "-"}
          </Text>
        </Stack>
      </Group>
      <Group gap="sm" align="flex-start" grow>
        <Stack gap={1} style={{ flex: 1 }}>
          <Text size="xs" c="dimmed">Notes</Text>
          <Textarea
            size="xs"
            minRows={2}
            maxRows={4}
            value={notes}
            onChange={(val) => setNotes(val)}
            placeholder="Any additional notes..."
            styles={{ input: { background: "var(--mantine-color-body)" } }}
            data-testid={`trade-notes-${trade.trade_id}`}
          />
        </Stack>
      </Group>
      <Group justify="flex-end">
        <Button size="xs" variant="light" loading={saving} onClick={handleSave} data-testid={`trade-notes-save-${trade.trade_id}`}>
          Save
        </Button>
      </Group>
    </Stack>
  );
});

const TradeDetail = memo(function TradeDetail({ trade }: { trade: PaperTrade }) {
  return (
    <Stack gap="xs">
      <TradeStats trade={trade} />
      <TradeNotesEditor trade={trade} />
    </Stack>
  );
});

export const DayGroup = memo(function DayGroup({
  date,
  trades,
  selectedSymbol,
  selectedTradeId,
  onSelectSymbol,
  expanded,
  onToggle,
}: DayGroupProps) {
  const sortedTrades = [...trades].sort((a, b) => b.exit_time.localeCompare(a.exit_time));

  const handleSelectSymbol = useCallback(
    (trade: PaperTrade) => {
      onSelectSymbol(
        trade.symbol,
        trade.exit_time,
        trade.trade_id,
        trade.strategy_type || getStrategyTypeFromName(trade.strategy_name),
        trade.strategy_id,
        trade.entry_time,
      );
    },
    [onSelectSymbol],
  );

  useEffect(() => {
    if (selectedTradeId) {
      const el = document.querySelector(`[data-testid="trade-row-${selectedTradeId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [selectedTradeId]);

  const columns: ColumnDef<PaperTrade>[] = [
    {
      id: "toggle",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            row.toggleExpanded();
          }}
          data-testid={`trade-detail-toggle-${row.original.trade_id}`}
        >
          {row.getIsExpanded() ? "▼" : "▶"}
        </ActionIcon>
      ),
    },
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      cell: ({ row }) => <ClickableSymbol symbol={row.original.symbol} />,
    },
    {
      id: "side",
      header: "Side",
      accessorKey: "side",
      cell: ({ row }) => <SideBadge side={row.original.side} />,
    },
    { id: "quantity", header: "Qty", accessorKey: "quantity", cell: ({ row }) => <>{row.original.quantity}</> },
    {
      id: "entry_price",
      header: "Entry",
      accessorKey: "entry_price",
      cell: ({ row }) => <>₹{row.original.entry_price.toFixed(2)}</>,
    },
    {
      id: "exit_price",
      header: "Exit",
      accessorKey: "exit_price",
      cell: ({ row }) => <>{row.original.exit_price != null ? `₹${row.original.exit_price.toFixed(2)}` : "-"}</>,
    },
    {
      id: "hold_duration_minutes",
      header: "Hold",
      accessorKey: "hold_duration_minutes",
      cell: ({ row }) => (
        <Text size="sm" c="dimmed">
          {row.original.hold_duration_minutes != null ? formatDuration(row.original.hold_duration_minutes) : "-"}
        </Text>
      ),
    },
    {
      id: "stop_loss",
      header: "SL",
      accessorKey: "stop_loss",
      cell: ({ row }) => <>{row.original.stop_loss != null ? `₹${row.original.stop_loss.toFixed(2)}` : "-"}</>,
    },
    {
      id: "take_profit",
      header: "TP",
      accessorKey: "take_profit",
      cell: ({ row }) => (
        <>{row.original.take_profit != null && row.original.take_profit > 0 ? `₹${row.original.take_profit.toFixed(2)}` : "-"}</>
      ),
    },
    {
      id: "pnl_pct",
      header: "P&L%",
      accessorKey: "pnl_pct",
      cell: ({ row }) => {
        const pct = row.original.pnl_pct;
        return (
          <Text c={getPnLTextColor(pct)} fw={600} size="sm">
            {pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "-"}
          </Text>
        );
      },
    },
    {
      id: "net_pnl",
      header: "P&L",
      accessorKey: "net_pnl",
      cell: ({ row }) => (
        <Text c={getPnLTextColor(row.original.net_pnl)} fw={600} size="sm">
          ₹{formatNumber(row.original.net_pnl)}
        </Text>
      ),
    },
    {
      id: "exit_reason",
      header: "Exit",
      accessorKey: "exit_reason",
      enableSorting: false,
      cell: ({ row }) => <ExitReasonBadge reason={row.original.exit_reason} />,
    },
    {
      id: "strategy_name",
      header: "Strategy",
      enableSorting: false,
      cell: ({ row }) => (
        <Anchor
          component="button"
          size="xs"
          onClick={(e) => { e.stopPropagation(); setFilterStrategy(row.original.strategy_id || null); }}
          data-testid={`trade-strategy-filter-${row.original.trade_id}`}
        >
          {row.original.strategy_name || "default"}
        </Anchor>
      ),
    },
    {
      id: "bot_name",
      header: "Bot",
      enableSorting: false,
      cell: ({ row }) => (
        <Anchor
          component="button"
          size="xs"
          onClick={(e) => { e.stopPropagation(); setFilterBot(row.original.bot_id || null); }}
          data-testid={`trade-bot-filter-${row.original.trade_id}`}
        >
          {row.original.bot_name || "-"}
        </Anchor>
      ),
    },
  ];

  return (
    <Flex
      direction="column"
      data-testid={`day-group-${date}`}
      className="paper-day-group"
      id={`day-group-${date}`}
    >
      <DaySummary date={date} trades={trades} onToggle={onToggle} />
      <Collapse in={expanded}>
        <div style={{ overflowX: "auto" }}>
          <TanStackTable<PaperTrade>
            data={sortedTrades}
            columns={columns}
            enableSorting
            getRowCanExpand={() => true}
            renderSubComponent={(trade) => (
              <Box p="xs" style={{ background: "var(--mantine-color-body)" }}>
                <TradeDetail trade={trade} />
              </Box>
            )}
            onRowClick={(trade) => handleSelectSymbol(trade)}
            getRowTestId={(trade) => `trade-row-${trade.trade_id}`}
            getRowClassName={(trade) =>
              selectedTradeId === trade.trade_id ? "trade-row-highlighted" : undefined
            }
          />
        </div>
      </Collapse>
    </Flex>
  );
});
