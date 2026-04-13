import { useRef, useEffect, useMemo, useCallback } from "react";
import { Table, Text, Select, ScrollArea, Group, Badge, Box } from "@mantine/core";
import { getPnLTextColor, formatTimeOnly } from "../../utils/ui-helpers";
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

export function ReplayTradeLog({
  trades,
  strategyFilter,
  setStrategyFilter,
  isRunning,
  highlightedTradeId,
  onTradeClick,
}: ReplayTradeLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const strategyOptions = useMemo(() => {
    const names = new Set(trades.map((t) => t.strategy));
    return [
      { value: "ALL", label: "All Strategies" },
      ...Array.from(names)
        .sort()
        .map((name) => ({ value: name, label: name })),
    ];
  }, [trades]);

  const filteredTrades =
    strategyFilter === "ALL" ? trades : trades.filter((t) => t.strategy === strategyFilter);

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
              <Table.Th>Entry</Table.Th>
              <Table.Th>Exit</Table.Th>
              <Table.Th>Strategy</Table.Th>
              <Table.Th>Symbol</Table.Th>
              <Table.Th>Side</Table.Th>
              <Table.Th ta="right">Entry</Table.Th>
              <Table.Th ta="right">Exit</Table.Th>
              <Table.Th ta="right">P&L</Table.Th>
              <Table.Th ta="right">Net</Table.Th>
              <Table.Th>Reason</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filteredTrades.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={10}>
                  <Text c="dimmed" ta="center" py="md">
                    No trades yet
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              filteredTrades.map((trade, idx) => (
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
                    <Text size="xs">{formatTimeOnly(trade.entry_time)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{trade.exit_time ? formatTimeOnly(trade.exit_time) : "-"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{trade.strategy}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" fw={500}>
                      {trade.symbol}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c={trade.side === "BUY" ? "green" : "red"} fw={500}>
                      {trade.side}
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
