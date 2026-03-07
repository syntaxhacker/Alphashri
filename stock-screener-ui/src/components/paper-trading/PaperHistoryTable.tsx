import React, { useState, useEffect, useMemo } from "react";
import {
  Table,
  Select,
  Badge,
  ActionIcon,
  Text,
  Group,
  Card,
  Stack,
  Loader,
  Collapse,
  SegmentedControl,
  Button,
  Box,
} from "@mantine/core";
import {
  getPaperTradingState,
  subscribe as subscribeToPaperTrading,
  setSelectedSymbol,
  setFilterStrategy,
  setFilterBot,
  setFilterFromDate,
  setFilterToDate,
  deleteTradeAction,
} from "../../state/paperTrading";
import { fetchPaperChart, refreshHistoryData } from "../../api/paperTrading";
import type { PaperTrade } from "../../types/paperTrading";

function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) {
    return "0";
  }
  if (Math.abs(num) >= 100000) {
    return (num / 100000).toFixed(1) + "L";
  }
  if (Math.abs(num) >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toFixed(0);
}

function formatTradeTimeOnly(isoStr: string): string {
  if (!isoStr) return "-";
  const date = new Date(isoStr);
  if (Number.isNaN(date.getTime())) return isoStr;

  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getUniqueStrategies(trades: PaperTrade[]): string[] {
  const strategies = new Set<string>();
  for (const trade of trades) {
    if (trade.strategy_name) {
      strategies.add(trade.strategy_name);
    }
  }
  return Array.from(strategies).sort();
}

function getUniqueBots(trades: PaperTrade[]): Array<{ id: string; name: string }> {
  const botsMap = new Map<string, string>();
  for (const trade of trades) {
    if (trade.bot_id && trade.bot_name) {
      botsMap.set(trade.bot_id, trade.bot_name);
    }
  }
  return Array.from(botsMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function filterByRange(
  trades: PaperTrade[],
  fromDate: string | null,
  toDate: string | null,
): PaperTrade[] {
  const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
  const to = toDate ? new Date(`${toDate}T23:59:59`) : null;

  return trades.filter((t) => {
    const tradeDate = new Date(t.exit_time);
    if (from && tradeDate < from) return false;
    if (to && tradeDate > to) return false;
    return true;
  });
}

function groupTradesByDate(trades: PaperTrade[]): Record<string, PaperTrade[]> {
  const groups: Record<string, PaperTrade[]> = {};

  for (const trade of trades) {
    const date = trade.exit_time.split("T")[0];
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(trade);
  }

  for (const date of Object.keys(groups)) {
    groups[date].sort((a, b) => b.exit_time.localeCompare(a.exit_time));
  }

  return groups;
}

function formatDateHeader(date: string): string {
  const dateObj = new Date(date);
  return dateObj.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

interface DayGroupProps {
  date: string;
  trades: PaperTrade[];
  selectedSymbol: string | null;
  onSelectSymbol: (symbol: string, exitTime?: string) => void;
  onDeleteTrade: (tradeId: string) => void;
  expanded: boolean;
  onToggle: () => void;
}

function DayGroup({
  date,
  trades,
  selectedSymbol,
  onSelectSymbol,
  onDeleteTrade,
  expanded,
  onToggle,
}: DayGroupProps) {
  const dayPnl = trades.reduce((sum, t) => sum + t.net_pnl, 0);
  const wins = trades.filter((t) => t.net_pnl > 0).length;
  const losses = trades.filter((t) => t.net_pnl < 0).length;
  const pnlColor = dayPnl >= 0 ? "green" : "red";
  const pnlSign = dayPnl >= 0 ? "+" : "";

  return (
    <Card shadow="xs" padding="xs" withBorder data-testid={`day-group-${date}`}>
      <Group
        justify="space-between"
        onClick={onToggle}
        style={{ cursor: "pointer" }}
        data-testid={`day-header-${date}`}
      >
        <Group gap="xs">
          <Text size="sm" fw={600}>
            {formatDateHeader(date)}
          </Text>
        </Group>
        <Group gap="md">
          <Text size="sm" c={pnlColor} fw={600}>
            {pnlSign}₹{formatNumber(Math.abs(dayPnl))}
          </Text>
          <Badge color={wins > 0 ? "green" : "gray"} variant="light" size="sm">
            ▲{wins}
          </Badge>
          <Badge color={losses > 0 ? "red" : "gray"} variant="light" size="sm">
            ▼{losses}
          </Badge>
        </Group>
      </Group>

      <Collapse in={expanded}>
        <Table striped highlightOnHover mt="xs" withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Symbol</Table.Th>
              <Table.Th>Side</Table.Th>
              <Table.Th>Qty</Table.Th>
              <Table.Th>Entry</Table.Th>
              <Table.Th>Exit</Table.Th>
              <Table.Th>P&L</Table.Th>
              <Table.Th>Bot</Table.Th>
              <Table.Th>Strategy</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th>Time</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {trades.map((trade) => {
              const tradePnlColor = trade.net_pnl >= 0 ? "green" : "red";
              const sideColor = trade.side === "BUY" ? "green" : "red";

              return (
                <Table.Tr
                  key={trade.trade_id}
                  onClick={() => onSelectSymbol(trade.symbol, trade.exit_time)}
                  style={{ cursor: "pointer" }}
                  data-testid={`trade-row-${trade.trade_id}`}
                >
                  <Table.Td>
                    <Text fw={600}>{trade.symbol}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={sideColor} variant="light" size="sm">
                      {trade.side === "BUY" ? "▲" : "▼"} {trade.side}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{trade.quantity}</Table.Td>
                  <Table.Td>₹{trade.entry_price.toFixed(2)}</Table.Td>
                  <Table.Td>₹{trade.exit_price.toFixed(2)}</Table.Td>
                  <Table.Td>
                    <Text c={tradePnlColor} fw={600}>
                      ₹{formatNumber(trade.net_pnl)}
                    </Text>
                  </Table.Td>
                  <Table.Td>{trade.bot_name || "-"}</Table.Td>
                  <Table.Td>{trade.strategy_name || "default"}</Table.Td>
                  <Table.Td>
                    <Badge
                      color={
                        trade.exit_reason === "SL"
                          ? "red"
                          : trade.exit_reason === "TP"
                            ? "green"
                            : "gray"
                      }
                      variant="light"
                      size="sm"
                    >
                      {trade.exit_reason}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{formatTradeTimeOnly(trade.exit_time)}</Table.Td>
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
            })}
          </Table.Tbody>
        </Table>
      </Collapse>
    </Card>
  );
}

export function PaperHistoryTable() {
  const [state, setState] = useState(getPaperTradingState());
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const unsubscribe = subscribeToPaperTrading(() => {
      setState(getPaperTradingState());
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const filteredTrades = useMemo(() => {
    let trades = [...state.trades];

    if (state.filterSymbol) {
      trades = trades.filter((t) => t.symbol === state.filterSymbol);
    }
    if (state.filterFromDate || state.filterToDate) {
      trades = filterByRange(trades, state.filterFromDate, state.filterToDate);
    }
    if (state.filterStrategy) {
      trades = trades.filter((t) => t.strategy_name === state.filterStrategy);
    }
    if (state.filterBot) {
      trades = trades.filter((t) => t.bot_id === state.filterBot);
    }

    return trades;
  }, [
    state.trades,
    state.filterSymbol,
    state.filterFromDate,
    state.filterToDate,
    state.filterStrategy,
    state.filterBot,
  ]);

  const tradesByDate = useMemo(
    () => groupTradesByDate(filteredTrades),
    [filteredTrades],
  );

  const strategies = useMemo(() => getUniqueStrategies(state.trades), [state.trades]);
  const bots = useMemo(() => getUniqueBots(state.trades), [state.trades]);

  const totalPnl = filteredTrades.reduce((sum, t) => sum + t.net_pnl, 0);
  const totalWins = filteredTrades.filter((t) => t.net_pnl > 0).length;
  const totalLosses = filteredTrades.filter((t) => t.net_pnl < 0).length;

  const handleSelectSymbol = async (symbol: string, exitTime?: string) => {
    setSelectedSymbol(symbol);
    const currentState = getPaperTradingState();
    // Use trade's exit date if available, otherwise today
    const date = exitTime ? exitTime.split("T")[0] : new Date().toISOString().split("T")[0];
    await fetchPaperChart(symbol, date, currentState.chartTimeframe);
  };

  const handleDeleteTrade = async (tradeId: string) => {
    await deleteTradeAction(tradeId);
  };

  const handleStrategyChange = (value: string | null) => {
    setFilterStrategy(value);
  };

  const handleBotChange = (value: string | null) => {
    setFilterBot(value);
  };

  const handleQuickFilter = (period: string) => {
    const now = new Date();
    let fromDate: string | null = null;
    let toDate: string | null = null;

    switch (period) {
      case "today":
        fromDate = now.toISOString().split("T")[0];
        toDate = fromDate;
        break;
      case "week":
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        fromDate = weekAgo.toISOString().split("T")[0];
        break;
      case "month":
        const monthAgo = new Date(now);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        fromDate = monthAgo.toISOString().split("T")[0];
        break;
      case "year":
        const yearAgo = new Date(now);
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        fromDate = yearAgo.toISOString().split("T")[0];
        break;
      case "all":
      default:
        fromDate = null;
        toDate = null;
        break;
    }

    setFilterFromDate(fromDate);
    setFilterToDate(toDate);
    
    // Convert empty string to null for API call
    const botId = state.filterBot || null;
    console.log('[PaperHistoryTable] Quick filter:', period, 'fromDate:', fromDate, 'botId:', botId);
    
    // Fetch from API with date filter
    refreshHistoryData(botId, fromDate, toDate);
  };

  const getCurrentPeriod = (): string => {
    const { filterFromDate, filterToDate } = state;
    if (!filterFromDate && !filterToDate) return "all";
    
    const today = new Date().toISOString().split("T")[0];
    if (filterFromDate === today && filterToDate === today) return "today";
    
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    
    if (filterFromDate && new Date(filterFromDate) >= weekAgo) return "week";
    if (filterFromDate && new Date(filterFromDate) >= monthAgo) return "month";
    if (filterFromDate && new Date(filterFromDate) >= yearAgo) return "year";
    
    return "all";
  };

  const toggleDay = (date: string) => {
    setExpandedDays((prev) => ({
      ...prev,
      [date]: !prev[date],
    }));
  };

  if (state.isLoading && state.trades.length === 0) {
    return (
      <Card shadow="sm" padding="md" radius="md" withBorder data-testid="history-panel">
        <Group justify="center" gap="md">
          <Loader size="sm" />
          <Text c="dimmed">Loading trade history...</Text>
        </Group>
      </Card>
    );
  }

  const sortedDates = Object.keys(tradesByDate).sort((a, b) => b.localeCompare(a));

  return (
    <Box h="100%" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }} data-testid="history-panel">
      <Box flex="0 0 auto" mb="sm" style={{ flexShrink: 0 }}>
        <Group gap="md" justify="space-between">
          <Group gap="md">
            {bots.length > 1 && (
              <Select
                placeholder="All Bots"
                data={[
                  { value: "", label: "All Bots" },
                  ...bots.map((b) => ({ value: b.id, label: b.name })),
                ]}
                value={state.filterBot || ""}
                onChange={handleBotChange}
                style={{ width: 200 }}
                data-testid="bot-filter-select"
              />
            )}
            {strategies.length > 1 && (
              <Select
                placeholder="All Strategies"
                data={[
                  { value: "", label: "All Strategies" },
                  ...strategies.map((s) => ({ value: s, label: s })),
                ]}
                value={state.filterStrategy || ""}
                onChange={handleStrategyChange}
                style={{ width: 200 }}
                data-testid="strategy-filter-select"
              />
            )}
          </Group>
          <SegmentedControl
            value={getCurrentPeriod()}
            onChange={handleQuickFilter}
            data={[
              { value: "today", label: "Today" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "year", label: "Year" },
              { value: "all", label: "All" },
            ]}
            size="xs"
            data-testid="quick-filter"
          />
        </Group>
      </Box>

      <Box flex="0 0 auto" mb="sm" style={{ flexShrink: 0 }}>
        <Card shadow="sm" padding="sm" radius="md" withBorder data-testid="trades-header">
          <Group justify="space-between">
            <Text fw={600}>Trade History ({filteredTrades.length} trades)</Text>
            <Group gap="md">
              <Text>
                  Total:{" "}
                  <Text
                    component="span"
                    fw={700}
                    c={totalPnl >= 0 ? "green" : "red"}
                  >
                    ₹{formatNumber(totalPnl)}
                  </Text>
                </Text>
                <Badge color="green" variant="light">
                  ▲{totalWins}
                </Badge>
                <Badge color="red" variant="light">
                  ▼{totalLosses}
                </Badge>
              </Group>
            </Group>
        </Card>
      </Box>

      <Box flex={1} style={{ minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        {filteredTrades.length === 0 ? (
          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Stack align="center" gap="xs">
              <Text size="xl">📊</Text>
              <Text fw={600}>No trades found</Text>
              <Text size="sm" c="dimmed">
                Completed trades will appear here
              </Text>
            </Stack>
          </Card>
        ) : (
          <Stack gap="sm" data-testid="trades-table-container">
            {sortedDates.map((date) => (
              <DayGroup
                key={date}
                date={date}
                trades={tradesByDate[date]}
                selectedSymbol={state.selectedSymbol}
                onSelectSymbol={handleSelectSymbol}
                onDeleteTrade={handleDeleteTrade}
                expanded={expandedDays[date] !== false}
                onToggle={() => toggleDay(date)}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
