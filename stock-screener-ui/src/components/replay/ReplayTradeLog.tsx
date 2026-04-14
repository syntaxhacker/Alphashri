import { useRef, useEffect, useMemo, useCallback, useState } from "react";
import { Table, Text, Select, ScrollArea, Group, Badge, Box, Anchor } from "@mantine/core";
import {
  getPnLTextColor,
  formatTimeOnly,
  formatDuration,
  getNextSortDirection,
  sortByField,
} from "../../utils/ui-helpers";
import { SortableHeader } from "../common/SortableHeader";
import { SideBadge } from "../common/BadgeComponents";
import type { ReplayTrade } from "../../types/replay";

const EXIT_REASON_COLORS: Record<string, string> = {
  TP: "green",
  SL: "red",
  EOD: "orange",
  FORCE_CLOSE: "gray",
};

function getExitBadgeColor(reason: string): string {
  return EXIT_REASON_COLORS[reason] ?? "gray";
}

interface ReplayTradeLogProps {
  trades: ReplayTrade[];
  strategyFilter: string;
  setStrategyFilter: (filter: string) => void;
  isRunning: boolean;
  highlightedTradeId: number | null;
  onTradeClick?: (trade: ReplayTrade) => void;
}

function formatHoldDuration(entryTime: string, exitTime: string): string {
  if (!entryTime || !exitTime) return "-";
  try {
    const entry = new Date(entryTime);
    const exit = new Date(exitTime);
    const diffMs = exit.getTime() - entry.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins <= 0) return "0m";
    return formatDuration(diffMins);
  } catch {
    return "-";
  }
}

export function ReplayTradeLog({
  trades,
  strategyFilter,
  setStrategyFilter,
  isRunning,
  highlightedTradeId,
  onTradeClick,
}: ReplayTradeLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [symbolFilter, setSymbolFilter] = useState("ALL");
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const strategyOptions = useMemo(() => {
    const names = new Set(trades.map((t) => t.strategy));
    return [
      { value: "ALL", label: "All Strategies" },
      ...Array.from(names)
        .sort()
        .map((name) => ({ value: name, label: name })),
    ];
  }, [trades]);

  const symbolOptions = useMemo(() => {
    const symbols = new Set(trades.map((t) => t.symbol));
    return [
      { value: "ALL", label: "All Symbols" },
      ...Array.from(symbols)
        .sort()
        .map((s) => ({ value: s, label: s })),
    ];
  }, [trades]);

  const filteredTrades = useMemo(() => {
    let result =
      strategyFilter === "ALL" ? trades : trades.filter((t) => t.strategy === strategyFilter);
    if (symbolFilter !== "ALL") {
      result = result.filter((t) => t.symbol === symbolFilter);
    }
    return result;
  }, [trades, strategyFilter, symbolFilter]);

  const sortedTrades = useMemo(() => {
    if (!sortField) return filteredTrades;
    return sortByField(filteredTrades, sortField as keyof ReplayTrade, sortDirection);
  }, [filteredTrades, sortField, sortDirection]);

  useEffect(() => {
    if (isRunning && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [filteredTrades.length, isRunning]);

  const handleRowClick = useCallback(
    (trade: ReplayTrade) => {
      if (onTradeClick) {
        onTradeClick(trade);
      }
    },
    [onTradeClick],
  );

  const handleSort = useCallback(
    (column: string) => {
      const nextDir = getNextSortDirection(sortField ?? "", column, sortDirection);
      setSortField(column);
      setSortDirection(nextDir);
    },
    [sortField, sortDirection],
  );

  const totalColumns = 13;

  return (
    <Box
      data-testid="replay-trade-log"
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      <Group gap="sm" mb="xs" style={{ flex: "0 0 auto" }}>
        <Text size="xs" fw={500}>
          Trade Log
        </Text>
        <Select
          size="xs"
          w={160}
          data={strategyOptions}
          value={strategyFilter}
          onChange={(v) => setStrategyFilter(v ?? "ALL")}
          allowDeselect={false}
        />
        <Select
          size="xs"
          w={130}
          data={symbolOptions}
          value={symbolFilter}
          onChange={(v) => setSymbolFilter(v ?? "ALL")}
          allowDeselect={false}
        />
        <Text size="xs" c="dimmed">
          {filteredTrades.length} trade{filteredTrades.length !== 1 ? "s" : ""}
        </Text>
      </Group>

      <ScrollArea style={{ flex: 1 }} h="100%">
        <Table
          striped
          highlightOnHover
          size="xs"
          className="trade-history-table"
          style={{ cursor: onTradeClick ? "pointer" : undefined }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={30}>#</Table.Th>
              <SortableHeader
                label="Symbol"
                columnKey="symbol"
                sortColumn={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortableHeader
                label="Side"
                columnKey="side"
                sortColumn={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <Table.Th ta="center">Qty</Table.Th>
              <SortableHeader
                label="Entry"
                columnKey="entry_time"
                sortColumn={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortableHeader
                label="Exit"
                columnKey="exit_time"
                sortColumn={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <Table.Th>Hold</Table.Th>
              <Table.Th ta="right">Entry</Table.Th>
              <Table.Th ta="right">Exit</Table.Th>
              <SortableHeader
                label="P&L"
                columnKey="pnl"
                sortColumn={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortableHeader
                label="Net"
                columnKey="net_pnl"
                sortColumn={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <Table.Th>Strategy</Table.Th>
              <Table.Th>Reason</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sortedTrades.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={totalColumns}>
                  <Text c="dimmed" ta="center" py="md">
                    No trades yet
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              sortedTrades.map((trade, idx) => (
                <Table.Tr
                  key={trade.id}
                  onClick={() => handleRowClick(trade)}
                  className={highlightedTradeId === trade.id ? "trade-row-highlighted" : undefined}
                >
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {idx + 1}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" fw={500}>
                      {trade.symbol}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <SideBadge side={trade.side} size="xs" />
                  </Table.Td>
                  <Table.Td ta="center">
                    <Text size="xs">{trade.quantity}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{formatTimeOnly(trade.entry_time)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{trade.exit_time ? formatTimeOnly(trade.exit_time) : "-"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {formatHoldDuration(trade.entry_time, trade.exit_time)}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="xs">{trade.entry_price.toFixed(2)}</Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="xs">{trade.exit_price.toFixed(2)}</Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="xs" fw={500} c={getPnLTextColor(trade.pnl)}>
                      {trade.pnl >= 0 ? "+" : ""}
                      {trade.pnl.toFixed(2)}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="xs" fw={500} c={getPnLTextColor(trade.net_pnl)}>
                      {trade.net_pnl >= 0 ? "+" : ""}
                      {trade.net_pnl.toFixed(2)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Anchor
                      component="button"
                      size="xs"
                      onClick={() => setStrategyFilter(trade.strategy)}
                    >
                      {trade.strategy}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" color={getExitBadgeColor(trade.exit_reason)} variant="light">
                      {trade.exit_reason}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
        <div ref={bottomRef} />
      </ScrollArea>
    </Box>
  );
}
