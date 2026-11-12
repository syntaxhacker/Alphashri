import { createMemo, Show, Switch, Match } from "solid-js";
import dayjs from "dayjs";
import { Text, Select, Flex, Group } from "@/ui";
import { Tabs } from "@/ui";
import { IconActivity, IconChartDots, IconClipboardList, IconSettings, IconTimeline } from "@/components/common/Icons";
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

const normDate = (v: unknown): string => {
  if (!v) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    return dayjs(v).format("YYYY-MM-DD");
  }
  return String(v);
};
export function usePaperViewActions(getActiveBotId: () => string | null) {
  const handleViewChange = async (view: string | null) => {
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

    const activeBotId = getActiveBotId();
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
  };

  const handleToggleBot = async () => {
    const activeBotId = getActiveBotId();
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
  };

  const handleRefresh = async () => {
    const activeBotId = getActiveBotId();
    if (activeBotId) await refreshBotLiveData(activeBotId);
    else await refreshLiveData();
  };

  const handleBotSelect = async (botId: string) => {
    if (!botId) {
      refreshLiveData();
    } else {
      stopLiveAutoRefresh();
      await refreshBotLiveData(botId);
      initBotAutoRefresh(botId);
    }
  };

  return { handleViewChange, handleToggleBot, handleRefresh, handleBotSelect };
}

export function useHistoryFilters() {
  const handleFilterFromDate = (value: string) => {
    setFilterFromDate(value || null);
    const s = getPaperTradingState();
    refreshHistoryData(s.filterBot || null, value || null, s.filterToDate);
  };

  const handleFilterToDate = (value: string) => {
    setFilterToDate(value || null);
    const s = getPaperTradingState();
    refreshHistoryData(s.filterBot || null, s.filterFromDate, value || null);
  };

  const handleFilterSymbol = (value: string | null) => {
    setFilterSymbol(value);
  };

  return { handleFilterFromDate, handleFilterToDate, handleFilterSymbol };
}

export function LiveFilters(props: {
  activeBotId: string | null;
  bots: BotSummary[];
  state: ReturnType<typeof getPaperTradingState>;
  actions: ReturnType<typeof usePaperViewActions>;
}) {
  return (
    <BotSelector
      bots={props.bots}
      selectedBotId={props.activeBotId}
      onSelectBot={props.actions.handleBotSelect}
      onToggleBot={props.actions.handleToggleBot}
      onRefresh={props.actions.handleRefresh}
    />
  );
}

export function HistoryFilters(props: {
  state: ReturnType<typeof getPaperTradingState>;
  filters: ReturnType<typeof useHistoryFilters>;
}) {
  const symbols = createMemo(() => [...new Set(props.state.trades.map((t: PaperTrade) => t.symbol))].sort());
  const symbolOptions = createMemo(() => symbols().map((s) => ({ value: s, label: s })));
  const allOptions = createMemo(() => [{ value: "", label: "All" }, ...symbolOptions()]);

  return (
    <Flex gap="xs" align="center" wrap="wrap">
      <Group gap="xs" align="center">
        <Text size="sm" c="dimmed">
          From:
        </Text>
        <TradingDatePicker
          value={props.state.filterFromDate || ""}
          onChange={(v) => props.filters.handleFilterFromDate(normDate(v))}
          data-testid="filter-from-date"
          w={150}
          placeholder="From"
        />
      </Group>
      <Group gap="xs" align="center">
        <Text size="sm" c="dimmed">
          To:
        </Text>
        <TradingDatePicker
          value={props.state.filterToDate || ""}
          onChange={(v) => props.filters.handleFilterToDate(normDate(v))}
          data-testid="filter-to-date"
          w={150}
          placeholder="To"
        />
      </Group>
      <Group gap="xs" align="center">
        <Text size="sm" c="dimmed">
          Symbol:
        </Text>
        <Select
          size="sm"
          value={props.state.filterSymbol || ""}
          onChange={props.filters.handleFilterSymbol}
          data={allOptions()}
          data-testid="filter-symbol"
          w={120}
          clearable
        />
      </Group>
    </Flex>
  );
}

export function FiltersBar(props: {
  activeBotId: string | null;
  bots: BotSummary[];
  state: ReturnType<typeof getPaperTradingState>;
  actions: ReturnType<typeof usePaperViewActions>;
  filters: ReturnType<typeof useHistoryFilters>;
}) {
  return (
    <Switch>
      <Match when={props.state.currentView === "live"}>
        <LiveFilters activeBotId={props.activeBotId} bots={props.bots} state={props.state} actions={props.actions} />
      </Match>
      <Match when={props.state.currentView === "history"}>
        <HistoryFilters state={props.state} filters={props.filters} />
      </Match>
    </Switch>
  );
}

export function PaperTradingTabs(props: {
  state: ReturnType<typeof getPaperTradingState>;
  onViewChange: (view: string | null) => void;
}) {
  return (
    <Tabs
      value={props.state.currentView}
      onChange={props.onViewChange}
      variant="default"
      className="paper-trading-tabs"
      id="paper-tabs"
      data-testid="paper-trading-tabs"
    >
      <Tabs.List>
        <Tabs.Tab value="live" leftSection={<IconChartDots size={14} />} data-testid="tab-live">
          Positions
          <Show when={props.state.positions.length > 0}>
            <Text span ml={4} size="sm" c="primary" className="font-mono tabular-nums">
              ({props.state.positions.length})
            </Text>
          </Show>
        </Tabs.Tab>
        <Tabs.Tab value="history" leftSection={<IconClipboardList size={14} />} data-testid="trade-history-tab">
          Trade History
          <Show when={props.state.trades.length > 0}>
            <Text span ml={4} size="sm" c="primary" className="font-mono tabular-nums">
              ({props.state.trades.length})
            </Text>
          </Show>
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
