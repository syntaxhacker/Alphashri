import { memo, useRef, useEffect, useState } from "react";
import {
  Anchor,
  Collapse,
  Table,
  Badge,
  Text,
  Group,
  Flex,
  ActionIcon,
  Grid,
  Stack,
  Textarea,
  Button,
} from "@mantine/core";
import type { PaperTrade } from "../../types/paperTrading";
import {
  formatNumber,
  formatTimeOnly,
  formatDateHeader,
  formatDuration,
  getPnLTextColor,
  sortByField,
  getStrategyTypeFromName,
} from "../../utils/ui-helpers";
import { SideBadge, ExitReasonBadge } from "../common";
import { ClickableSymbol } from "../common";
import { SortableHeader } from "../common/SortableHeader";
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
  sortColumn: string | null;
  sortDirection: "asc" | "desc";
  onSort: (column: string) => void;
}

function DaySummary({
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
  const pnlSign = dayPnl >= 0 ? "+" : "";

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
          {pnlSign}₹{formatNumber(Math.abs(dayPnl))}
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
}

function TradeStats({ trade }: { trade: PaperTrade }) {
  const grossPnl = trade.pnl;
  const grossColor = getPnLTextColor(grossPnl);
  const grossSign = grossPnl >= 0 ? "+" : "";
  const netPnl = trade.net_pnl;
  const netColor = getPnLTextColor(netPnl);
  const netSign = netPnl >= 0 ? "+" : "";

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
    { label: "Gross P&L", value: `${grossSign}₹${formatNumber(Math.abs(grossPnl))}`, color: grossColor },
    { label: "Net P&L", value: `${netSign}₹${formatNumber(Math.abs(netPnl))}`, color: netColor },
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
}

function TradeNotesEditor({ trade }: { trade: PaperTrade }) {
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
          <Text size="xs" c="dimmed">
            Reason
          </Text>
          <Text size="xs" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }} data-testid={`trade-reason-${trade.trade_id}`}>
            {trade.reason || "-"}
          </Text>
        </Stack>
      </Group>
      <Group gap="sm" align="flex-start" grow>
        <Stack gap={1} style={{ flex: 1 }}>
          <Text size="xs" c="dimmed">
            Notes
          </Text>
          <Textarea
            size="xs"
            minRows={2}
            maxRows={4}
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            placeholder="Any additional notes..."
            styles={{ input: { background: "var(--mantine-color-body)" } }}
            data-testid={`trade-notes-${trade.trade_id}`}
          />
        </Stack>
      </Group>
      <Group justify="flex-end">
        <Button
          size="xs"
          variant="light"
          loading={saving}
          onClick={handleSave}
          data-testid={`trade-notes-save-${trade.trade_id}`}
        >
          Save
        </Button>
      </Group>
    </Stack>
  );
}

function TradeDetail({ trade }: { trade: PaperTrade }) {
  return (
    <Stack gap="xs">
      <TradeStats trade={trade} />
      <TradeNotesEditor trade={trade} />
    </Stack>
  );
}

const TradeRow = memo(function TradeRow({
  trade,
  onSelectSymbol,
  onDeleteTrade,
  selectedTradeId,
}: {
  trade: PaperTrade;
  onSelectSymbol: (
    s: string,
    t?: string,
    tradeId?: string,
    strategyType?: string,
    strategyId?: number,
    entryTime?: string,
  ) => void;
  onDeleteTrade: (id: string) => void;
  selectedTradeId: string | null;
}) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const isSelected = trade.trade_id === selectedTradeId;
  const [detailExpanded, setDetailExpanded] = useState(false);

  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isSelected]);

  const pnlColor = getPnLTextColor(trade.net_pnl);
  const pnlPctColor = getPnLTextColor(trade.pnl_pct);

  return (
    <>
      <Table.Tr
        ref={rowRef}
        key={trade.trade_id}
        onClick={() =>
          onSelectSymbol(
            trade.symbol,
            trade.exit_time,
            trade.trade_id,
            trade.strategy_type || (getStrategyTypeFromName(trade.strategy_name) ?? undefined),
            trade.strategy_id,
            trade.entry_time,
          )
        }
        className={isSelected ? "trade-row-highlighted" : undefined}
        style={{ cursor: "pointer" }}
        data-testid={`trade-row-${trade.trade_id}`}
      >
        <Table.Td p={0}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setDetailExpanded((v) => !v);
            }}
            data-testid={`trade-detail-toggle-${trade.trade_id}`}
          >
            {detailExpanded ? "▼" : "▶"}
          </ActionIcon>
        </Table.Td>
        <Table.Td>
          <ClickableSymbol symbol={trade.symbol} />
        </Table.Td>
        <Table.Td>
          <SideBadge side={trade.side} />
        </Table.Td>
        <Table.Td>{trade.quantity}</Table.Td>
        <Table.Td>₹{trade.entry_price.toFixed(2)}</Table.Td>
        <Table.Td>{trade.exit_price != null ? `₹${trade.exit_price.toFixed(2)}` : "-"}</Table.Td>
        <Table.Td>
          <Text size="sm" c="dimmed">
            {trade.hold_duration_minutes != null
              ? formatDuration(trade.hold_duration_minutes)
              : "-"}
          </Text>
        </Table.Td>
        <Table.Td>
          <Text size="sm">
            {trade.stop_loss != null ? `₹${trade.stop_loss.toFixed(2)}` : "-"}
          </Text>
        </Table.Td>
        <Table.Td>
          <Text size="sm">
            {trade.take_profit != null && trade.take_profit > 0
              ? `₹${trade.take_profit.toFixed(2)}`
              : "-"}
          </Text>
        </Table.Td>
        <Table.Td>
          <Text c={pnlPctColor} fw={600} size="sm">
            {trade.pnl_pct != null ? `${trade.pnl_pct >= 0 ? "+" : ""}${trade.pnl_pct.toFixed(2)}%` : "-"}
          </Text>
        </Table.Td>
        <Table.Td>
          <Text c={pnlColor} fw={600} size="sm">
            ₹{formatNumber(trade.net_pnl)}
          </Text>
        </Table.Td>
        <Table.Td>
          <ExitReasonBadge reason={trade.exit_reason} />
        </Table.Td>
        <Table.Td>
          <Anchor
            component="button"
            size="xs"
            onClick={(e) => {
              e.stopPropagation();
              setFilterStrategy(trade.strategy_id || null);
            }}
            data-testid={`trade-strategy-filter-${trade.trade_id}`}
          >
            {trade.strategy_name || "default"}
          </Anchor>
        </Table.Td>
        <Table.Td>
          <Anchor
            component="button"
            size="xs"
            onClick={(e) => {
              e.stopPropagation();
              setFilterBot(trade.bot_id || null);
            }}
            data-testid={`trade-bot-filter-${trade.trade_id}`}
          >
            {trade.bot_name || "-"}
          </Anchor>
        </Table.Td>
      </Table.Tr>
      <Table.Tr>
        <Table.Td colSpan={14} p={0}>
          <Collapse in={detailExpanded}>
            <div style={{ padding: "6px 8px", background: "var(--mantine-color-body)" }}>
              <TradeDetail trade={trade} />
            </div>
          </Collapse>
        </Table.Td>
      </Table.Tr>
    </>
  );
});

export function DayGroup({
  date,
  trades,
  selectedSymbol: _selectedSymbol,
  selectedTradeId,
  onSelectSymbol,
  onDeleteTrade,
  expanded,
  onToggle,
  tableStyles,
  sortColumn,
  sortDirection,
  onSort,
}: DayGroupProps) {
  const sortedTrades = sortColumn
    ? sortByField(trades, sortColumn as keyof PaperTrade, sortDirection)
    : [...trades].sort((a, b) => b.exit_time.localeCompare(a.exit_time));

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
          <Table striped highlightOnHover styles={tableStyles}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th p={0} />
                <SortableHeader
                  label="Symbol"
                  columnKey="symbol"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
                <SortableHeader
                  label="Side"
                  columnKey="side"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
                <SortableHeader
                  label="Qty"
                  columnKey="quantity"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
                <SortableHeader
                  label="Entry"
                  columnKey="entry_price"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
                <SortableHeader
                  label="Exit"
                  columnKey="exit_price"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
                <SortableHeader
                  label="Hold"
                  columnKey="hold_duration_minutes"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
                <SortableHeader
                  label="SL"
                  columnKey="stop_loss"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
                <SortableHeader
                  label="TP"
                  columnKey="take_profit"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
                <SortableHeader
                  label="P&L%"
                  columnKey="pnl_pct"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
                <SortableHeader
                  label="P&L"
                  columnKey="net_pnl"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
                <SortableHeader
                  label="Exit"
                  columnKey="exit_reason"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
                <SortableHeader
                  label="Strategy"
                  columnKey="strategy_name"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
                <SortableHeader
                  label="Bot"
                  columnKey="bot_name"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sortedTrades.map((trade) => (
                <TradeRow
                  key={trade.trade_id}
                  trade={trade}
                  onSelectSymbol={onSelectSymbol}
                  onDeleteTrade={onDeleteTrade}
                  selectedTradeId={selectedTradeId}
                />
              ))}
            </Table.Tbody>
          </Table>
        </div>
      </Collapse>
    </Flex>
  );
}
