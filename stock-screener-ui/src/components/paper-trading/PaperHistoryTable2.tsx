import { useState, useMemo } from "react";
import dayjs from "dayjs";
import {
  Select,
  Badge,
  Text,
  Group,
  Loader,
  SegmentedControl,
  Flex,
  ScrollArea,
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
import { formatNumber, getPnLTextColor, getNextSortDirection } from "../../utils/ui-helpers";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { DayGroup } from "./DayGroup";

export function getUniqueStrategies(trades: PaperTrade[]): string[] {
  const strategies = new Set<string>();
  for (const trade of trades) {
    if (trade.strategy_name) strategies.add(trade.strategy_name);
  }
  return Array.from(strategies).sort();
}

export function getUniqueBots(trades: PaperTrade[]): Array<{ id: string; name: string }> {
  const botsMap = new Map<string, string>();
  for (const trade of trades) {
    if (trade.bot_id && trade.bot_name) botsMap.set(trade.bot_id, trade.bot_name);
  }
  return Array.from(botsMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filterByRange(
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

export function groupTradesByDate(
  trades: PaperTrade[],
  sortColumn?: string | null,
  sortDirection?: "asc" | "desc",
): Record<string, PaperTrade[]> {
  const groups: Record<string, PaperTrade[]> = {};
  const dir = sortDirection || "desc";
  const sorted = sortColumn
    ? [...trades].sort((a, b) => {
        const aVal = a[sortColumn as keyof PaperTrade];
        const bVal = b[sortColumn as keyof PaperTrade];
        if (typeof aVal === "number" && typeof bVal === "number")
          return dir === "asc" ? aVal - bVal : bVal - aVal;
        return dir === "asc"
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      })
    : [...trades];
  for (const trade of sorted) {
    const date = trade.exit_time.split("T")[0];
    if (!groups[date]) groups[date] = [];
    groups[date].push(trade);
  }
  return groups;
}

function useQuickFilter() {
  const handleQuickFilter = (period: string) => {
    let fromDate: string | null = null;
    let toDate: string | null = null;
    switch (period) {
      case "today":
        fromDate = dayjs().format("YYYY-MM-DD");
        toDate = fromDate;
        break;
      case "week":
        fromDate = dayjs().subtract(7, "day").format("YYYY-MM-DD");
        break;
      case "month":
        fromDate = dayjs().subtract(1, "month").format("YYYY-MM-DD");
        break;
      case "year":
        fromDate = dayjs().subtract(1, "year").format("YYYY-MM-DD");
        break;
      default:
        fromDate = null;
        toDate = null;
        break;
    }
    setFilterFromDate(fromDate);
    setFilterToDate(toDate);
    const state = getPaperTradingState();
    const botId = state.filterBot || null;
    refreshHistoryData(botId, fromDate, toDate);
  };

  const getCurrentPeriod = (): string => {
    const state = getPaperTradingState();
    const { filterFromDate, filterToDate } = state;
    if (!filterFromDate && !filterToDate) return "all";
    const todayStr = dayjs().format("YYYY-MM-DD");
    if (filterFromDate === todayStr && filterToDate === todayStr) return "today";
    const weekAgoStr = dayjs().subtract(7, "day").format("YYYY-MM-DD");
    if (filterFromDate === weekAgoStr && !filterToDate) return "week";
    const monthAgoStr = dayjs().subtract(1, "month").format("YYYY-MM-DD");
    if (filterFromDate === monthAgoStr && !filterToDate) return "month";
    const yearAgoStr = dayjs().subtract(1, "year").format("YYYY-MM-DD");
    if (filterFromDate === yearAgoStr && !filterToDate) return "year";
    if (filterFromDate) {
      if (dayjs(filterFromDate).isAfter(dayjs().subtract(7, "day").subtract(1, "second")))
        return "week";
      if (dayjs(filterFromDate).isAfter(dayjs().subtract(1, "month").subtract(1, "second")))
        return "month";
      if (dayjs(filterFromDate).isAfter(dayjs().subtract(1, "year").subtract(1, "second")))
        return "year";
    }
    return "all";
  };

  return { handleQuickFilter, getCurrentPeriod };
}

const TABLE_STYLES = {
  thead: {
    position: "sticky" as const,
    top: 0,
    zIndex: 1,
    background: "var(--mantine-color-body)",
  },
  th: {
    padding: "4px 6px",
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    borderBottom: "1px solid var(--mantine-color-default-border)",
    whiteSpace: "nowrap" as const,
  },
  td: {
    padding: "3px 6px",
    fontSize: "12px",
    borderBottom: "1px solid var(--mantine-color-default-border)",
    whiteSpace: "nowrap" as const,
  },
};

export function PaperHistoryTable() {
  useStoreSubscription(subscribeToPaperTrading);
  const state = getPaperTradingState();
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
  const [sortColumn, setSortColumn] = useState<string | null>("exit_time");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const { handleQuickFilter, getCurrentPeriod } = useQuickFilter();

  const handleSort = (column: string) => {
    const newDir = getNextSortDirection(sortColumn || "", column, sortDirection);
    setSortColumn(column);
    setSortDirection(newDir);
  };

  const filteredTrades = useMemo(() => {
    let trades = [...state.trades];
    if (state.filterSymbol) trades = trades.filter((t) => t.symbol === state.filterSymbol);
    if (state.filterFromDate || state.filterToDate)
      trades = filterByRange(trades, state.filterFromDate, state.filterToDate);
    if (state.filterStrategy)
      trades = trades.filter((t) => t.strategy_name === state.filterStrategy);
    if (state.filterBot) trades = trades.filter((t) => t.bot_id === state.filterBot);
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
    () => groupTradesByDate(filteredTrades, sortColumn, sortDirection),
    [filteredTrades, sortColumn, sortDirection],
  );
  const strategies = useMemo(() => getUniqueStrategies(state.trades), [state.trades]);
  const bots = useMemo(() => getUniqueBots(state.trades), [state.trades]);
  const totalPnl = filteredTrades.reduce((sum, t) => sum + t.net_pnl, 0);
  const totalWins = filteredTrades.filter((t) => t.net_pnl > 0).length;
  const totalLosses = filteredTrades.filter((t) => t.net_pnl < 0).length;

  const handleSelectSymbol = async (symbol: string, exitTime?: string) => {
    setSelectedSymbol(symbol);
    const currentState = getPaperTradingState();
    const date = exitTime ? exitTime.split("T")[0] : dayjs().format("YYYY-MM-DD");
    await fetchPaperChart(symbol, date, currentState.chartTimeframe);
  };

  const toggleDay = (date: string) => setExpandedDays((prev) => ({ ...prev, [date]: !prev[date] }));

  if (state.isLoading && state.trades.length === 0) {
    return (
      <Flex
        justify="center"
        py="lg"
        data-testid="history-panel"
        className="paper-history-panel"
        id="history-panel"
      >
        <Group gap="xs">
          <Loader size="sm" />
          <Text size="xs" c="dimmed">
            Loading trade history...
          </Text>
        </Group>
      </Flex>
    );
  }

  const sortedDates = Object.keys(tradesByDate).sort((a, b) => b.localeCompare(a));

  return (
    <Flex
      direction="column"
      h="100%"
      className="paper-history-container"
      id="history-container"
      data-testid="history-panel"
    >
      <Flex flex="none" py={2} className="paper-history-filters" id="history-filters">
        <Group gap="xs" justify="space-between" w="100%">
          <Group gap="xs">
            {bots.length > 1 && (
              <Select
                placeholder="All Bots"
                data={[
                  { value: "", label: "All Bots" },
                  ...bots.map((b) => ({ value: b.id, label: b.name })),
                ]}
                value={state.filterBot || ""}
                onChange={(v) => setFilterBot(v)}
                style={{ width: 160 }}
                size="xs"
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
                onChange={(v) => setFilterStrategy(v)}
                style={{ width: 160 }}
                size="xs"
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
      </Flex>

      <Flex
        flex="none"
        className="paper-history-list-wrapper"
        data-testid="trades-header"
        id="trades-header"
      >
        <Group justify="space-between" px="xs" py={2}>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">
            Trade History ({filteredTrades.length})
          </Text>
          <Group gap="xs">
            <Text size="xs" c="dimmed">
              Total:{" "}
              <Text component="span" fw={700} c={getPnLTextColor(totalPnl)} size="xs">
                ₹{formatNumber(totalPnl)}
              </Text>
            </Text>
            <Badge color="green" variant="light" size="xs">
              ▲{totalWins}
            </Badge>
            <Badge color="red" variant="light" size="xs">
              ▼{totalLosses}
            </Badge>
          </Group>
        </Group>
      </Flex>

      <ScrollArea flex={1} className="paper-history-list" id="history-list" type="scroll">
        {filteredTrades.length === 0 ? (
          <Flex py="lg" justify="center" align="center" direction="column" gap={4}>
            <Text size="xs" fw={500} c="dimmed">
              No trades found
            </Text>
          </Flex>
        ) : (
          sortedDates.map((date) => (
            <DayGroup
              key={date}
              date={date}
              trades={tradesByDate[date]}
              selectedSymbol={state.selectedSymbol}
              onSelectSymbol={handleSelectSymbol}
              onDeleteTrade={deleteTradeAction}
              expanded={expandedDays[date] !== false}
              onToggle={() => toggleDay(date)}
              tableStyles={TABLE_STYLES}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={handleSort}
            />
          ))
        )}
      </ScrollArea>
    </Flex>
  );
}
