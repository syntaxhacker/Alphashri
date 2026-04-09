import { useRef, useEffect } from "react";
import { Collapse, Table, Badge, Text, Group, Flex, ActionIcon } from "@mantine/core";
import type { PaperTrade } from "../../types/paperTrading";
import {
  formatNumber,
  formatTimeOnly,
  formatDateHeader,
  formatDuration,
  getPnLTextColor,
  sortByField,
} from "../../utils/ui-helpers";
import { SideBadge, ExitReasonBadge } from "../common/BadgeComponents";
import { SortableHeader } from "../common/SortableHeader";

interface DayGroupProps {
  date: string;
  trades: PaperTrade[];
  selectedSymbol: string | null;
  selectedTradeId: string | null;
  onSelectSymbol: (
    symbol: string,
    exitTime?: string,
    tradeId?: string,
    strategyName?: string,
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
      px="xs"
      py={2}
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

function TradeRow({
  trade,
  onSelectSymbol,
  onDeleteTrade,
  selectedTradeId,
}: {
  trade: PaperTrade;
  onSelectSymbol: (s: string, t?: string, tradeId?: string, strategyName?: string) => void;
  onDeleteTrade: (id: string) => void;
  selectedTradeId: string | null;
}) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const isSelected = trade.trade_id === selectedTradeId;

  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isSelected]);

  const pnlColor = getPnLTextColor(trade.net_pnl);

  return (
    <Table.Tr
      ref={rowRef}
      key={trade.trade_id}
      onClick={() =>
        onSelectSymbol(trade.symbol, trade.exit_time, trade.trade_id, trade.strategy_name)
      }
      className={isSelected ? "trade-row-highlighted" : undefined}
      style={{ cursor: "pointer" }}
      data-testid={`trade-row-${trade.trade_id}`}
    >
      <Table.Td>
        <Text fw={600} size="sm">
          {trade.symbol}
        </Text>
      </Table.Td>
      <Table.Td>
        <SideBadge side={trade.side} />
      </Table.Td>
      <Table.Td>{trade.quantity}</Table.Td>
      <Table.Td>₹{trade.entry_price.toFixed(2)}</Table.Td>
      <Table.Td>{formatTimeOnly(trade.entry_time)}</Table.Td>
      <Table.Td>₹{trade.exit_price.toFixed(2)}</Table.Td>
      <Table.Td>{formatTimeOnly(trade.exit_time)}</Table.Td>
      <Table.Td>
        <Text size="sm" c="dimmed">
          {trade.hold_duration_minutes != null ? formatDuration(trade.hold_duration_minutes) : "-"}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text c={pnlColor} fw={600} size="sm">
          ₹{formatNumber(trade.net_pnl)}
        </Text>
      </Table.Td>
      <Table.Td>{trade.bot_name || "-"}</Table.Td>
      <Table.Td>{trade.strategy_name || "default"}</Table.Td>
      <Table.Td>
        <ExitReasonBadge reason={trade.exit_reason} />
      </Table.Td>
      <Table.Td>
        <ActionIcon
          variant="subtle"
          color="red"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteTrade(trade.trade_id);
          }}
          title="Delete Trade"
          data-testid={`delete-trade-btn-${trade.trade_id}`}
        >
          🗑️
        </ActionIcon>
      </Table.Td>
    </Table.Tr>
  );
}

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
                  label="Entry Time"
                  columnKey="entry_time"
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
                  label="Exit Time"
                  columnKey="exit_time"
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
                  label="P&L"
                  columnKey="net_pnl"
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
                <SortableHeader
                  label="Strategy"
                  columnKey="strategy_name"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
                <SortableHeader
                  label="Type"
                  columnKey="exit_reason"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
                <Table.Th>Actions</Table.Th>
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
