import { useMemo, useState, useRef, useEffect } from "react";
import {
  Tabs,
  Table,
  Text,
  ScrollArea,
  Group,
  Badge,
  Box,
  Tooltip,
} from "@mantine/core";
import {
  getPnLTextColor,
  formatTimeOnly,
  getNextSortDirection,
  sortByField,
} from "../../utils/ui-helpers";
import { SortableHeader } from "../common/SortableHeader";
import { SideBadge } from "../common/BadgeComponents";
import { getMetricColor, getMetricTextColor } from "../../pages/heatmap/heatmapUtils";
import type {
  StrategyRunnerTrade,
  StrategyRunnerSummary,
  BotSummary,
  SymbolSummary,
  BotInfo,
} from "../../types/strategyRunner";

interface TabsProps {
  trades: StrategyRunnerTrade[];
  summary: StrategyRunnerSummary | null;
  bots: BotInfo[];
}

function formatPF(pf: number): string {
  if (pf === 0) return "\u2014";
  return pf.toFixed(2);
}

/* ───── By Bot Tab ───── */

function ByBotTab({ summary, trades }: { summary: StrategyRunnerSummary | null; trades: StrategyRunnerTrade[] }) {
  const botEntries = useMemo(() => {
    if (summary?.by_bot) {
      return Object.entries(summary.by_bot).map(([name, data]) => ({
        uuid: name,
        name,
        trades: [],
        summary: data.summary,
      }));
    }
    // Group by bot from raw trades if no summary
    const grouped = new Map<string, StrategyRunnerTrade[]>();
    for (const t of trades) {
      const arr = grouped.get(t.bot_uuid) || [];
      arr.push(t);
      grouped.set(t.bot_uuid, arr);
    }
    return Array.from(grouped.entries()).map(([uuid, btrades]) => {
      const winners = btrades.filter((t) => t.pnl > 0).length;
      const losers = btrades.filter((t) => t.pnl <= 0).length;
      const netPnl = btrades.reduce((s, t) => s + t.net_pnl, 0);
      const pf = losers > 0
        ? btrades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) /
          Math.abs(btrades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0))
        : btrades.filter((t) => t.pnl > 0).length > 0 ? Infinity : 0;
      return {
        uuid,
        name: btrades[0]?.bot_name || uuid,
        trades: btrades,
        summary: {
          total_trades: btrades.length,
          winners,
          losers,
          win_rate: btrades.length > 0 ? (winners / btrades.length) * 100 : 0,
          net_pnl: netPnl,
          profit_factor: pf,
        } as BotSummary,
      };
    });
  }, [summary, trades]);

  if (botEntries.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="lg">
        No bot data yet
      </Text>
    );
  }

  return (
    <ScrollArea>
      <Table striped highlightOnHover size="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Bot</Table.Th>
            <Table.Th ta="right">Trades</Table.Th>
            <Table.Th ta="right">Win Rate</Table.Th>
            <Table.Th ta="right">Net P&L</Table.Th>
            <Table.Th ta="right">Profit Factor</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {botEntries.map((entry) => (
            <Table.Tr key={entry.uuid}>
              <Table.Td>
                <Text size="xs" fw={500}>
                  {entry.name}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="xs">{entry.summary.total_trades}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="xs" c={entry.summary.win_rate >= 50 ? "green" : "red"}>
                  {entry.summary.win_rate.toFixed(1)}%
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="xs" fw={500} c={getPnLTextColor(entry.summary.net_pnl)}>
                  {entry.summary.net_pnl >= 0 ? "+" : ""}
                  {entry.summary.net_pnl.toFixed(2)}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text
                  size="xs"
                  c={entry.summary.profit_factor > 1 ? "green" : entry.summary.profit_factor < 1 ? "red" : undefined}
                >
                  {formatPF(entry.summary.profit_factor)}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

/* ───── By Symbol Tab ───── */

function BySymbolTab({ summary, trades, bots }: TabsProps) {
  const symbolEntries = useMemo(() => {
    if (summary?.by_symbol) {
      return Object.entries(summary.by_symbol).map(([symbol, s]) => ({
        symbol,
        ...s,
      }));
    }
    const grouped = new Map<string, StrategyRunnerTrade[]>();
    for (const t of trades) {
      const arr = grouped.get(t.symbol) || [];
      arr.push(t);
      grouped.set(t.symbol, arr);
    }
    return Array.from(grouped.entries()).map(([symbol, strades]) => {
      const winners = strades.filter((t) => t.pnl > 0).length;
      const losers = strades.filter((t) => t.pnl <= 0).length;
      const netPnl = strades.reduce((s, t) => s + t.net_pnl, 0);
      const uniqueBots = new Set(strades.map((t) => t.bot_uuid));
      const pf = losers > 0
        ? strades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) /
          Math.abs(strades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0))
        : strades.filter((t) => t.pnl > 0).length > 0 ? Infinity : 0;
      const botPnlMap = new Map<string, number>();
      for (const t of strades) {
        botPnlMap.set(t.bot_uuid, (botPnlMap.get(t.bot_uuid) || 0) + t.net_pnl);
      }
      let bestBot = "";
      let bestPnl = -Infinity;
      for (const [buuid, bpnl] of botPnlMap) {
        if (bpnl > bestPnl) {
          bestPnl = bpnl;
          bestBot = strades.find((t) => t.bot_uuid === buuid)?.bot_name || buuid;
        }
      }
      return {
        symbol,
        total_trades: strades.length,
        winners,
        losers,
        win_rate: strades.length > 0 ? (winners / strades.length) * 100 : 0,
        net_pnl: netPnl,
        profit_factor: pf,
        bots_traded: uniqueBots.size,
        total_bots: bots.length,
        best_bot: bestBot,
      } as SymbolSummary & { symbol: string };
    });
  }, [summary, trades, bots]);

  if (symbolEntries.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="lg">
        No symbol data yet
      </Text>
    );
  }

  const pnlValues = symbolEntries.map((s) => s.net_pnl);
  const minPnl = Math.min(...pnlValues, 0);
  const maxPnl = Math.max(...pnlValues, 1);

  return (
    <ScrollArea>
      <Table striped highlightOnHover size="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Symbol</Table.Th>
            <Table.Th ta="center">Bots Hit</Table.Th>
            <Table.Th ta="right">Trades</Table.Th>
            <Table.Th ta="right">Win Rate</Table.Th>
            <Table.Th ta="right">Net P&L</Table.Th>
            <Table.Th ta="right">PF</Table.Th>
            <Table.Th>Best Bot</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {symbolEntries.map((entry) => (
            <Table.Tr key={entry.symbol}>
              <Table.Td>
                <Text size="xs" fw={500}>
                  {entry.symbol}
                </Text>
              </Table.Td>
              <Table.Td ta="center">
                <Text size="xs">
                  {entry.bots_traded}/{entry.total_bots}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="xs">{entry.total_trades}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text size="xs" c={entry.win_rate >= 50 ? "green" : "red"}>
                  {entry.win_rate.toFixed(1)}%
                </Text>
              </Table.Td>
              <Table.Td
                ta="right"
                style={{
                  background: getMetricColor(
                    entry.net_pnl,
                    minPnl < 0 ? minPnl : 0,
                    maxPnl,
                  ),
                }}
              >
                <Text
                  size="xs"
                  fw={500}
                  c={getMetricTextColor(entry.net_pnl, minPnl < 0 ? minPnl : 0, maxPnl)}
                >
                  {entry.net_pnl >= 0 ? "+" : ""}
                  {entry.net_pnl.toFixed(2)}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text
                  size="xs"
                  c={
                    entry.profit_factor > 1
                      ? "green"
                      : entry.profit_factor < 1
                        ? "red"
                        : undefined
                  }
                >
                  {formatPF(entry.profit_factor)}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs">{entry.best_bot}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

/* ───── Trade Log Tab ───── */

function TradeLogTab({ trades }: { trades: StrategyRunnerTrade[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const sortedTrades = useMemo(() => {
    if (!sortField) return trades;
    return sortByField(trades, sortField as keyof StrategyRunnerTrade, sortDirection);
  }, [trades, sortField, sortDirection]);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [trades.length]);

  const handleSort = (column: string) => {
    const nextDir = getNextSortDirection(sortField ?? "", column, sortDirection);
    setSortField(column);
    setSortDirection(nextDir);
  };

  const totalColumns = 12;

  if (trades.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="lg">
        No trades yet
      </Text>
    );
  }

  return (
    <Box style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Group gap="sm" mb="xs" style={{ flex: "0 0 auto" }}>
        <Text size="xs" fw={500}>
          Trade Log
        </Text>
        <Text size="xs" c="dimmed">
          {trades.length} trade{trades.length !== 1 ? "s" : ""}
        </Text>
      </Group>

      <ScrollArea style={{ flex: 1 }} h="100%">
        <Table striped highlightOnHover size="xs">
          <Table.Thead>
            <Table.Tr>
              <SortableHeader
                label="Bot"
                columnKey="bot_name"
                sortColumn={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
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
              <Table.Th>Reason</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sortedTrades.map((trade, idx) => (
              <Table.Tr key={`${trade.bot_uuid}-${trade.symbol}-${trade.entry_time}-${idx}`}>
                <Table.Td>
                  <Text size="xs" fw={500}>
                    {trade.bot_name}
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
                <Table.Td>
                  <Text size="xs">{formatTimeOnly(trade.entry_time)}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">
                    {trade.exit_time ? formatTimeOnly(trade.exit_time) : "-"}
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
                  <Badge size="xs" color="gray" variant="light">
                    {trade.reason || "-"}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <div ref={bottomRef} />
      </ScrollArea>
    </Box>
  );
}

/* ───── Correlation Tab ───── */

function CorrelationTab({ summary, trades, bots }: TabsProps) {
  const symbols = useMemo(() => {
    const set = new Set<string>();
    for (const t of trades) set.add(t.symbol);
    if (summary?.by_symbol) {
      for (const sym of Object.keys(summary.by_symbol)) set.add(sym);
    }
    return Array.from(set).sort();
  }, [summary, trades]);

  if (symbols.length === 0 || bots.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="lg">
        Run a comparison to see correlation data
      </Text>
    );
  }

  return (
    <ScrollArea>
      <Table striped highlightOnHover size="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Symbol</Table.Th>
            {bots.map((bot) => (
              <Table.Th key={bot.uuid} ta="center">
                <Text size="xs" fw={500}>
                  {bot.name}
                </Text>
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {symbols.map((symbol) => {
            const cellValues = bots.map((bot) => {
              const botTrades = trades.filter(
                (t) => t.symbol === symbol && t.bot_uuid === bot.uuid,
              );
              if (botTrades.length === 0) return { pf: 0, hasTrades: false };
              const winners = botTrades.filter((t) => t.pnl > 0);
              const losers = botTrades.filter((t) => t.pnl <= 0);
              const pf =
                losers.length > 0
                  ? winners.reduce((s, t) => s + t.pnl, 0) /
                    Math.abs(losers.reduce((s, t) => s + t.pnl, 0))
                  : winners.length > 0
                    ? Infinity
                    : 0;
              return { pf, hasTrades: true };
            });

            const pfValues = cellValues
              .filter((c) => c.hasTrades && isFinite(c.pf))
              .map((c) => c.pf);
            const minPF = pfValues.length > 0 ? Math.min(...pfValues) : 0;
            const maxPF = pfValues.length > 0 ? Math.max(...pfValues, 1) : 1;

            return (
              <Table.Tr key={symbol}>
                <Table.Td>
                  <Text size="xs" fw={500}>
                    {symbol}
                  </Text>
                </Table.Td>
                {cellValues.map((cell, ci) => {
                  if (!cell.hasTrades) {
                    return (
                      <Table.Td key={ci} ta="center" style={{ background: "#f0f0f0" }}>
                        <Text size="xs" c="dimmed">
                          {"\u2014"}
                        </Text>
                      </Table.Td>
                    );
                  }
                  const pfVal = isFinite(cell.pf) ? cell.pf : (cell.pf > 0 ? maxPF : 0);
                  const bgColor =
                    pfVal > 1.5
                      ? "var(--mantine-color-green-2)"
                      : pfVal >= 0.5
                        ? "var(--mantine-color-yellow-2)"
                        : "var(--mantine-color-red-2)";
                  const textColor =
                    pfVal > 1.5
                      ? "var(--mantine-color-green-9)"
                      : pfVal >= 0.5
                        ? "var(--mantine-color-yellow-9)"
                        : "var(--mantine-color-red-9)";
                  return (
                    <Table.Td
                      key={ci}
                      ta="center"
                      style={{ background: bgColor }}
                    >
                      <Text size="xs" fw={500} c={textColor}>
                        {formatPF(cell.pf)}
                      </Text>
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}

/* ───── Exported Tabs Container ───── */

export function StrategyRunnerTabs(props: TabsProps) {
  return (
    <Tabs defaultValue="by_bot">
      <Tabs.List>
        <Tabs.Tab value="by_bot">By Bot</Tabs.Tab>
        <Tabs.Tab value="by_symbol">By Symbol</Tabs.Tab>
        <Tabs.Tab value="trade_log">Trade Log</Tabs.Tab>
        <Tabs.Tab value="correlation">Correlation</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="by_bot" pt="sm">
        <ByBotTab summary={props.summary} trades={props.trades} />
      </Tabs.Panel>

      <Tabs.Panel value="by_symbol" pt="sm">
        <BySymbolTab {...props} />
      </Tabs.Panel>

      <Tabs.Panel value="trade_log" pt="sm" style={{ flex: 1, minHeight: 300 }}>
        <TradeLogTab trades={props.trades} />
      </Tabs.Panel>

      <Tabs.Panel value="correlation" pt="sm">
        <CorrelationTab {...props} />
      </Tabs.Panel>
    </Tabs>
  );
}
