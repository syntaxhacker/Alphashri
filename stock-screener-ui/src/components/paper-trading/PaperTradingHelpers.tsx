import { useCallback, useMemo } from "react";
import dayjs from "dayjs";
import { Flex, Tabs, Text, Group, Select } from "@/ui";
import { IconActivity, IconChartDots, IconClipboardList, IconSettings, IconTimeline } from "@tabler/icons-react";
import { TradingDatePicker } from "../common/TradingDatePicker";
import {
  getPaperTradingState,
  setPaperTradingView,
  setFilterFromDate,
  setFilterToDate,
  setFilterSymbol,
  setChartData,
  setChartTimeframe,
  setChartFromDate,
  setChartDataLive,
  setChartTimeframeLive,
  setChartFromDateLive,
  setChartDataHistory,
  setChartTimeframeHistory,
  setChartFromDateHistory,
} from "../../state/paperTrading";
import type { PaperTradingView, PaperTrade, BotSummary } from "../../types/paperTrading";
import {
  refreshLiveData,
  refreshHistoryData,
  stopLiveAutoRefresh,
  initBotAutoRefresh,
  fetchStrategyConfig,
  refreshBotLiveData,
  startBot,
  stopBot,
  startPaperBot,
  stopPaperBot,
} from "../../api/paperTrading";
import { BotSelector } from "./BotSelector";

export function usePaperViewActions(activeBotId: string | null) {
  const handleViewChange = useCallback(
    async (view: string | null) => {
      if (!view) return;

      // Save current chart state before switching views
      const prevState = getPaperTradingState();
      const prevView = prevState.currentView;
      if (prevView === "live") {
        setChartDataLive(prevState.chartData);
        setChartTimeframeLive(prevState.chartTimeframe);
        setChartFromDateLive(prevState.chartFromDate);
      } else if (prevView === "history") {
        setChartDataHistory(prevState.chartData);
        setChartTimeframeHistory(prevState.chartTimeframe);
        setChartFromDateHistory(prevState.chartFromDate);
      }

      // Restore target view's chart state
      if (view === "live") {
        const s = getPaperTradingState();
        setChartData(s.chartDataLive);
        setChartTimeframe(s.chartTimeframeLive);
        setChartFromDate(s.chartFromDateLive);
      } else if (view === "history") {
        const s = getPaperTradingState();
        setChartData(s.chartDataHistory);
        setChartTimeframe(s.chartTimeframeHistory);
        setChartFromDate(s.chartFromDateHistory);
      }

      setPaperTradingView(view as PaperTradingView);

      if (view === "live") {
        if (activeBotId) refreshBotLiveData(activeBotId);
        else refreshLiveData();
      } else if (view === "history") {
        stopLiveAutoRefresh();
        const currentState = getPaperTradingState();
        let fromStr = currentState.filterFromDate;
        let toStr = currentState.filterToDate;
        if (!fromStr && !toStr) {
          fromStr = dayjs().format("YYYY-MM-DD");
          toStr = fromStr;
          setFilterFromDate(fromStr);
          setFilterToDate(toStr);
        }
        refreshHistoryData(currentState.filterBot || null, fromStr, toStr);
      } else if (view === "settings") {
        stopLiveAutoRefresh();
        fetchStrategyConfig();
      } else if (view === "activity") {
        stopLiveAutoRefresh();
      } else if (view === "aggregated") {
        stopLiveAutoRefresh();
      }
    },
    [activeBotId],
  );

  const handleToggleBot = useCallback(async () => {
    if (activeBotId) {
      const currentState = getPaperTradingState();
      const botId = activeBotId;
      if (currentState.botRunning) await stopBot(botId);
      else await startBot(botId);
      setTimeout(() => refreshBotLiveData(botId), 1000);
    } else {
      const currentState = getPaperTradingState();
      if (currentState.botRunning) await stopPaperBot();
      else await startPaperBot();
      setTimeout(() => refreshLiveData(), 1000);
    }
  }, [activeBotId]);

  const handleRefresh = useCallback(async () => {
    if (activeBotId) await refreshBotLiveData(activeBotId);
    else await refreshLiveData();
  }, [activeBotId]);

  const handleBotSelect = useCallback(async (botId: string) => {
    if (!botId) {
      refreshLiveData();
    } else {
      stopLiveAutoRefresh();
      await refreshBotLiveData(botId);
      initBotAutoRefresh(botId);
    }
  }, []);

  return { handleViewChange, handleToggleBot, handleRefresh, handleBotSelect };
}

export function useHistoryFilters() {
  const handleFilterFromDate = useCallback((value: string) => {
    setFilterFromDate(value || null);
    const s = getPaperTradingState();
    refreshHistoryData(s.filterBot || null, value || null, s.filterToDate);
  }, []);

  const handleFilterToDate = useCallback((value: string) => {
    setFilterToDate(value || null);
    const s = getPaperTradingState();
    refreshHistoryData(s.filterBot || null, s.filterFromDate, value || null);
  }, []);

  const handleFilterSymbol = useCallback((value: string | null) => {
    setFilterSymbol(value);
  }, []);

  return { handleFilterFromDate, handleFilterToDate, handleFilterSymbol };
}

export function LiveFilters({
  activeBotId,
  bots,
  state: _state,
  actions,
}: {
  activeBotId: string | null;
  bots: BotSummary[];
  state: ReturnType<typeof getPaperTradingState>;
  actions: ReturnType<typeof usePaperViewActions>;
}) {
  return (
    <BotSelector
      bots={bots}
      selectedBotId={activeBotId}
      onSelectBot={actions.handleBotSelect}
      onToggleBot={actions.handleToggleBot}
      onRefresh={actions.handleRefresh}
    />
  );
}

export function HistoryFilters({
  state,
  filters,
}: {
  state: ReturnType<typeof getPaperTradingState>;
  filters: ReturnType<typeof useHistoryFilters>;
}) {
  const symbols = useMemo(
    () => [...new Set(state.trades.map((t: PaperTrade) => t.symbol))].sort(),
    [state.trades],
  );
  const symbolOptions = useMemo(
    () => symbols.map((s) => ({ value: s, label: s })),
    [symbols],
  );
  const allOptions = useMemo(
    () => [{ value: "", label: "All" }, ...symbolOptions],
    [symbolOptions],
  );

  return (
    <Flex gap="xs" align="center" wrap="wrap">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          From:
        </Text>
        <TradingDatePicker
          value={state.filterFromDate || ""}
          onChange={(v) => filters.handleFilterFromDate(v)}
          data-testid="filter-from-date"
          w={150}
          placeholder="From"
        />
      </Group>
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          To:
        </Text>
        <TradingDatePicker
          value={state.filterToDate || ""}
          onChange={(v) => filters.handleFilterToDate(v)}
          data-testid="filter-to-date"
          w={150}
          placeholder="To"
        />
      </Group>
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          Symbol:
        </Text>
        <Select
          size="sm"
          value={state.filterSymbol || ""}
          onChange={filters.handleFilterSymbol}
          data={allOptions}
          data-testid="filter-symbol"
          styles={{ input: { width: 120 } }}
          clearable
        />
      </Group>
    </Flex>
  );
}

export function FiltersBar({
  activeBotId,
  bots,
  state,
  actions,
  filters,
}: {
  activeBotId: string | null;
  bots: BotSummary[];
  state: ReturnType<typeof getPaperTradingState>;
  actions: ReturnType<typeof usePaperViewActions>;
  filters: ReturnType<typeof useHistoryFilters>;
}) {
  if (state.currentView === "live")
    return <LiveFilters activeBotId={activeBotId} bots={bots} state={state} actions={actions} />;
  if (state.currentView === "history") return <HistoryFilters state={state} filters={filters} />;
  return null;
}

export function PaperTradingTabs({
  state,
  onViewChange,
}: {
  state: ReturnType<typeof getPaperTradingState>;
  onViewChange: (view: string | null) => void;
}) {
  return (
    <Tabs
      value={state.currentView}
      onChange={onViewChange}
      variant="default"
      className="paper-trading-tabs"
      id="paper-tabs"
      data-testid="paper-trading-tabs"
    >
      <Tabs.List>
        <Tabs.Tab value="live" leftSection={<IconChartDots size={14} />} data-testid="tab-live">
          Positions
          {state.positions.length > 0 && (
            <Text span ml={4} size="sm" c="blue">
              ({state.positions.length})
            </Text>
          )}
        </Tabs.Tab>
        <Tabs.Tab value="history" leftSection={<IconClipboardList size={14} />} data-testid="trade-history-tab">
          Trade History
          {state.trades.length > 0 && (
            <Text span ml={4} size="sm" c="blue">
              ({state.trades.length})
            </Text>
          )}
        </Tabs.Tab>
        <Tabs.Tab value="settings" leftSection={<IconSettings size={14} />} data-testid="tab-settings">
          Settings
        </Tabs.Tab>
        <Tabs.Tab value="activity" leftSection={<IconActivity size={14} />} data-testid="tab-activity">
          Activity
        </Tabs.Tab>
        <Tabs.Tab value="aggregated" leftSection={<IconTimeline size={14} />} data-testid="tab-aggregated">
          Dashboard
        </Tabs.Tab>
      </Tabs.List>
    </Tabs>
  );
}
