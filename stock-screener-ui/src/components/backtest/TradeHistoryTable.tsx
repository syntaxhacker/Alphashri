import { Table, Group, Text, Badge, ActionIcon, ScrollArea, Box } from "@mantine/core";
import { IconX, IconArrowUp, IconArrowDown } from "@tabler/icons-react";
import type { Trade } from "../../types/backtest";
import { formatDateTimeHuman, formatDuration, getPnLTextColor } from "../../utils/ui-helpers";
import { SortableHeader } from "../common/SortableHeader";
import { DataTable } from "../common/DataTable";

export function sortTrades(trades: Trade[], column: string, direction: "asc" | "desc"): Trade[] {
  return [...trades].sort((a, b) => {
    let aVal: number | string = 0;
    let bVal: number | string = 0;

    switch (column) {
      case "entry_time":
        aVal = a.entry_time || "";
        bVal = b.entry_time || "";
        break;
      case "exit_time":
        aVal = a.exit_time || "";
        bVal = b.exit_time || "";
        break;
      case "side":
        aVal = (a as any).side || "LONG";
        bVal = (b as any).side || "LONG";
        break;
      case "quantity":
        aVal = a.quantity;
        bVal = b.quantity;
        break;
      case "entry_price":
        aVal = a.entry_price;
        bVal = b.entry_price;
        break;
      case "exit_price":
        aVal = a.exit_price;
        bVal = b.exit_price;
        break;
      case "level_high":
        aVal = a.or_high ?? a.r1 ?? a["52w_high"] ?? a["52w_high_entry"] ?? 0;
        bVal = b.or_high ?? b.r1 ?? b["52w_high"] ?? b["52w_high_entry"] ?? 0;
        break;
      case "level_low":
        aVal = a.or_low ?? a.s1 ?? 0;
        bVal = b.or_low ?? b.s1 ?? 0;
        break;
      case "net_pnl":
        aVal = a.net_pnl;
        bVal = b.net_pnl;
        break;
      case "net_pnl_pct":
        aVal = a.net_pnl_pct || (a.net_pnl / (a.entry_price * a.quantity)) * 100;
        bVal = b.net_pnl_pct || (b.net_pnl / (b.entry_price * b.quantity)) * 100;
        break;
      case "hold_duration_minutes":
        aVal = a.hold_duration_minutes;
        bVal = b.hold_duration_minutes;
        break;
      case "exit_reason":
        aVal = a.exit_reason || "";
        bVal = b.exit_reason || "";
        break;
      default:
        return 0;
    }

    if (typeof aVal === "string" && typeof bVal === "string") {
      return direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }

    return direction === "asc"
      ? (aVal as number) - (bVal as number)
      : (bVal as number) - (aVal as number);
  });
}

interface TradeHistoryTableProps {
  symbol: string;
  trades: Trade[];
  sortColumn: string;
  sortDirection: "asc" | "desc";
  onSort: (column: string) => void;
  onRowClick: (tradeIndex: number) => void;
  onClose: () => void;
}

export function TradeHistoryTable({
  symbol,
  trades,
  sortColumn,
  sortDirection,
  onSort,
  onRowClick,
  onClose,
}: TradeHistoryTableProps) {
  if (!trades || trades.length === 0) return null;

  const sortedTrades = sortTrades(trades, sortColumn, sortDirection);
  const totalPnl = trades.reduce((sum, t) => sum + t.net_pnl, 0);
  const wins = trades.filter((t) => t.net_pnl > 0).length;
  const winRate = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : "0";
  const has52w =
    (trades[0]?.["52w_high"] !== undefined && trades[0]?.["52w_high"] !== null) ||
    (trades[0]?.["52w_high_entry"] !== undefined && trades[0]?.["52w_high_entry"] !== null);

  const getTradeIndex = (trade: Trade) => trades.indexOf(trade);

  return (
    <Box
      id="trade-history-table"
      className="trade-history-panel"
      data-testid="trade-history-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <Group justify="space-between" p="sm" flex="0 0 auto" data-testid="trade-history-header">
        <Text fw={600} size="sm">
          📋 {symbol} Trades ({trades.length})
        </Text>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={onClose}
          data-testid="close-trade-history-btn"
          title="Close"
        >
          <IconX size={14} />
        </ActionIcon>
      </Group>

      <Group gap="md" p="xs" data-testid="trade-history-summary">
        <Text size="sm" data-testid="trade-summary-pnl">
          P&L:{" "}
          <Text component="span" fw={600} c={getPnLTextColor(totalPnl)}>
            ₹{totalPnl.toFixed(0)}
          </Text>
        </Text>
        <Text size="sm" data-testid="trade-summary-wr">
          WR: {winRate}%
        </Text>
        <Text size="sm" data-testid="trade-summary-wins">
          Wins: {wins}/{trades.length}
        </Text>
      </Group>

      <ScrollArea
        flex={1}
        type="auto"
        offsetScrollbars
        style={{ minHeight: 0 }}
        className="trade-history-scroll"
      >
        <DataTable
          dataTestId="trade-history-table"
          className="trade-history-table"
          id="trade-history-data-table"
          style={{ minWidth: "100%" }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>
                <Text size="sm" fw={500}>
                  #
                </Text>
              </Table.Th>
              <SortableHeader
                label="Entry"
                columnKey="entry_time"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortableHeader
                label="Exit"
                columnKey="exit_time"
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
                label={has52w ? "52W High" : "Level Hi"}
                columnKey="level_high"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              {!has52w && (
                <SortableHeader
                  label="Level Lo"
                  columnKey="level_low"
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
              )}
              <SortableHeader
                label="Exit"
                columnKey="exit_price"
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
                label="%"
                columnKey="net_pnl_pct"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={onSort}
                testId="th-pnl-pct"
              />
              <SortableHeader
                label="Hold"
                columnKey="hold_duration_minutes"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={onSort}
                testId="th-hold-duration"
              />
              <SortableHeader
                label="Type"
                columnKey="exit_reason"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={onSort}
                testId="th-exit-reason"
              />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody data-testid="trade-history-tbody">
            {sortedTrades.map((t) => {
              const originalIndex = getTradeIndex(t);
              const tradeNumber = originalIndex + 1;
              const pnlPct = t.net_pnl_pct || (t.net_pnl / (t.entry_price * t.quantity)) * 100;
              const side = (t as any).side || "LONG";
              const levelHigh = t.or_high ?? t.r1 ?? t["52w_high"] ?? t["52w_high_entry"] ?? 0;
              const levelLow = t.or_low ?? t.s1 ?? 0;

              return (
                <Table.Tr
                  key={originalIndex}
                  onClick={() => onRowClick(originalIndex)}
                  style={{ cursor: "pointer" }}
                  data-trade-number={tradeNumber}
                  title="Click to zoom to this trade"
                  bg={t.net_pnl >= 0 ? undefined : "rgba(255, 0, 0, 0.05)"}
                >
                  <Table.Td>
                    <Text size="sm">{tradeNumber}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{formatDateTimeHuman(t.entry_time)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{formatDateTimeHuman(t.exit_time)}</Text>
                  </Table.Td>
                  <Table.Td>
                    {side === "LONG" ? (
                      <Text size="sm" c="green">
                        <IconArrowUp size={12} style={{ marginRight: 2 }} />
                        LONG
                      </Text>
                    ) : (
                      <Text size="sm" c="red">
                        <IconArrowDown size={12} style={{ marginRight: 2 }} />
                        SHORT
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{t.quantity ?? 0}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">₹{(t.entry_price ?? 0).toFixed(0)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">₹{levelHigh.toFixed(2)}</Text>
                  </Table.Td>
                  {!has52w && (
                    <Table.Td>
                      <Text size="sm">₹{levelLow.toFixed(2)}</Text>
                    </Table.Td>
                  )}
                  <Table.Td>
                    <Text size="sm">₹{(t.exit_price ?? 0).toFixed(0)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={600} c={getPnLTextColor(t.net_pnl ?? 0)}>
                      ₹{(t.net_pnl ?? 0).toFixed(0)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c={getPnLTextColor(pnlPct)}>
                      {pnlPct >= 0 ? "+" : ""}
                      {pnlPct.toFixed(2)}%
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{formatDuration(t.hold_duration_minutes ?? 0)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      size="sm"
                      color={
                        t.exit_reason === "TP"
                          ? "green"
                          : t.exit_reason === "SL"
                            ? "red"
                            : t.exit_reason === "TRAILING_STOP"
                              ? "orange"
                              : "gray"
                      }
                    >
                      {t.exit_reason ?? "EOD"}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </DataTable>
      </ScrollArea>
    </Box>
  );
}
