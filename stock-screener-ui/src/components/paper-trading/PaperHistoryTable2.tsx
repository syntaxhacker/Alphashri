import { useState, useMemo } from "react";
import dayjs from "dayjs";
import { Select, Text, Group, Loader, SegmentedControl, Flex, ScrollArea } from "@mantine/core";
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
import { setSelectedTradeId } from "../../state/paperTrading";
import type { PaperTrade } from "../../types/paperTrading";
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

function getPeriodFromDateRange(fromDate: string | null, toDate: string | null): string {
  if (!fromDate && !toDate) return "all";
  const todayStr = dayjs().format("YYYY-MM-DD");
  if (fromDate === todayStr && toDate === todayStr) return "today";
  const weekAgoStr = dayjs().subtract(7, "day").format("YYYY-MM-DD");
  if (fromDate === weekAgoStr && !toDate) return "week";
  const monthAgoStr = dayjs().subtract(1, "month").format("YYYY-MM-DD");
  if (fromDate === monthAgoStr && !toDate) return "month";
  const yearAgoStr = dayjs().subtract(1, "year").format("YYYY-MM-DD");
  if (fromDate === yearAgoStr && !toDate) return "year";
  if (fromDate) {
    if (dayjs(fromDate).isAfter(dayjs().subtract(7, "day").subtract(1, "second"))) return "week";
    if (dayjs(fromDate).isAfter(dayjs().subtract(1, "month").subtract(1, "second"))) return "month";
    if (dayjs(fromDate).isAfter(dayjs().subtract(1, "year").subtract(1, "second"))) return "year";
  }
  return "all";
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
        break;
    }
    setFilterFromDate(fromDate);
    setFilterToDate(toDate);
    const state = getPaperTradingState();
    const botId = state.filterBot || null;
    refreshHistoryData(botId, fromDate, toDate);
  };

  const getCurrentPeriod = () => {
    const state = getPaperTradingState();
    return getPeriodFromDateRange(state.filterFromDate, state.filterToDate);
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

function HistoryFilters({
  bots,
  strategies,
  state,
}: {
  bots: Array<{ id: string; name: string }>;
  strategies: string[];
  state: ReturnType<typeof getPaperTradingState>;
}) {
  const { handleQuickFilter, getCurrentPeriod } = useQuickFilter();

  return (
    <>
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
            Trade History
          </Text>
        </Group>
      </Flex>
    </>
  );
}

function HistoryList({
  filteredTrades,
  tradesByDate,
  sortedDates,
  expandedDays,
  toggleDay,
  state,
  handleSelectSymbol,
}: {
  filteredTrades: PaperTrade[];
  tradesByDate: Record<string, PaperTrade[]>;
  sortedDates: string[];
  expandedDays: Record<string, boolean>;
  toggleDay: (date: string) => void;
  state: ReturnType<typeof getPaperTradingState>;
  handleSelectSymbol: (symbol: string, exitTime?: string, tradeId?: string) => Promise<void>;
}) {
  return (
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
            selectedTradeId={state.selectedTradeId}
            onSelectSymbol={handleSelectSymbol}
            onDeleteTrade={deleteTradeAction}
            expanded={expandedDays[date] !== false}
            onToggle={() => toggleDay(date)}
            tableStyles={TABLE_STYLES}
            sortColumn={null}
            sortDirection="desc"
            onSort={() => {}}
          />
        ))
      )}
    </ScrollArea>
  );
}

function useFilteredTrades() {
  const state = getPaperTradingState();
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

  const tradesByDate = useMemo(() => groupTradesByDate(filteredTrades), [filteredTrades]);
  const strategies = useMemo(() => getUniqueStrategies(state.trades), [state.trades]);
  const bots = useMemo(() => getUniqueBots(state.trades), [state.trades]);
  const sortedDates = Object.keys(tradesByDate).sort((a, b) => b.localeCompare(a));

  return { state, filteredTrades, tradesByDate, strategies, bots, sortedDates };
}

export function PaperHistoryTable() {
  useStoreSubscription(subscribeToPaperTrading);
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
  const { state, filteredTrades, tradesByDate, strategies, bots, sortedDates } =
    useFilteredTrades();

  const handleSelectSymbol = async (symbol: string, exitTime?: string, tradeId?: string) => {
    setSelectedSymbol(symbol);
    if (tradeId) setSelectedTradeId(tradeId);
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

  return (
    <Flex
      direction="column"
      h="100%"
      className="paper-history-container"
      id="history-container"
      data-testid="history-panel"
    >
      <HistoryFilters bots={bots} strategies={strategies} state={state} />
      <HistoryList
        filteredTrades={filteredTrades}
        tradesByDate={tradesByDate}
        sortedDates={sortedDates}
        expandedDays={expandedDays}
        toggleDay={toggleDay}
        state={state}
        handleSelectSymbol={handleSelectSymbol}
      />
    </Flex>
  );
}
