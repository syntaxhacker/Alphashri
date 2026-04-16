import { useCallback } from "react";
import dayjs from "dayjs";
import {
  Flex,
  Tabs,
  SegmentedControl,
  Text,
  Group,
  Button,
  Select,
  TextInput,
} from "@mantine/core";
import { IconRefresh, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import {
  getPaperTradingState,
  setPaperTradingView,
  setFilterFromDate,
  setFilterToDate,
  setFilterSymbol,
} from "../../state/paperTrading";
import type { PaperTradingView, PaperTrade, BotInfo } from "../../types/paperTrading";
import {
  refreshLiveData,
  refreshHistoryData,
  stopLiveAutoRefresh,
  fetchStrategyConfig,
  refreshBotLiveData,
  startBot,
  stopBot,
  startPaperBot,
  stopPaperBot,
} from "../../api/paperTrading";

export function usePaperViewActions(activeBotId: string | null) {
  const handleViewChange = useCallback(
    async (view: string | null) => {
      if (!view) return;
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
        refreshHistoryData(currentState.filterBot || activeBotId, fromStr, toStr);
      } else if (view === "settings") {
        stopLiveAutoRefresh();
        fetchStrategyConfig();
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
      await refreshBotLiveData(botId);
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
  state,
  actions,
}: {
  activeBotId: string | null;
  state: ReturnType<typeof getPaperTradingState>;
  actions: ReturnType<typeof usePaperViewActions>;
}) {
  return (
    <Flex gap="sm" align="center" wrap="wrap">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          Bot:
        </Text>
        <SegmentedControl
          size="sm"
          value={activeBotId || ""}
          onChange={actions.handleBotSelect}
          data={state.availableBots.map((bot: BotInfo) => ({ value: bot.id, label: bot.name }))}
          data-testid="bot-selector-dropdown"
        />
      </Group>
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          Status:
        </Text>
        <Text size="sm" fw={500} c={state.botRunning ? "green" : "red"} data-testid="bot-status">
          {state.botRunning ? `Running${state.botPid ? ` (${state.botPid})` : ""}` : "Stopped"}
        </Text>
      </Group>
      <Group gap="xs">
        <Button
          size="xs"
          variant="subtle"
          leftSection={<IconRefresh size={14} />}
          onClick={actions.handleRefresh}
          data-testid="refresh-btn"
        >
          Refresh
        </Button>
        <Button
          size="xs"
          variant="subtle"
          color={state.botRunning ? "red" : "blue"}
          leftSection={
            state.botRunning ? <IconPlayerStop size={14} /> : <IconPlayerPlay size={14} />
          }
          onClick={actions.handleToggleBot}
          data-testid={state.botRunning ? "stop-bot-btn" : "start-bot-btn"}
        >
          {state.botRunning ? "Stop Bot" : "Start Bot"}
        </Button>
      </Group>
    </Flex>
  );
}

export function HistoryFilters({
  state,
  filters,
}: {
  state: ReturnType<typeof getPaperTradingState>;
  filters: ReturnType<typeof useHistoryFilters>;
}) {
  const symbols = [...new Set(state.trades.map((t: PaperTrade) => t.symbol))].sort();
  const symbolOptions = symbols.map((s) => ({ value: s, label: s }));

  return (
    <Flex gap="sm" align="center" wrap="wrap">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          From:
        </Text>
        <TextInput
          type="date"
          size="sm"
          value={state.filterFromDate || ""}
          onChange={(e) => filters.handleFilterFromDate(e.currentTarget.value)}
          data-testid="filter-from-date"
          styles={{ input: { width: 150 } }}
        />
      </Group>
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          To:
        </Text>
        <TextInput
          type="date"
          size="sm"
          value={state.filterToDate || ""}
          onChange={(e) => filters.handleFilterToDate(e.currentTarget.value)}
          data-testid="filter-to-date"
          styles={{ input: { width: 150 } }}
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
          data={[{ value: "", label: "All" }, ...symbolOptions]}
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
  state,
  actions,
  filters,
}: {
  activeBotId: string | null;
  state: ReturnType<typeof getPaperTradingState>;
  actions: ReturnType<typeof usePaperViewActions>;
  filters: ReturnType<typeof useHistoryFilters>;
}) {
  if (state.currentView === "live")
    return <LiveFilters activeBotId={activeBotId} state={state} actions={actions} />;
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
      className="paper-trading-tabs"
      id="paper-tabs"
      data-testid="paper-trading-tabs"
    >
      <Tabs.List>
        <Tabs.Tab value="live" leftSection={<span>📊</span>} data-testid="tab-live">
          Live Positions
          {state.positions.length > 0 && (
            <Text span ml={4} size="sm" c="blue">
              ({state.positions.length})
            </Text>
          )}
        </Tabs.Tab>
        <Tabs.Tab value="history" leftSection={<span>📋</span>} data-testid="trade-history-tab">
          Trade History
          {state.trades.length > 0 && (
            <Text span ml={4} size="sm" c="blue">
              ({state.trades.length})
            </Text>
          )}
        </Tabs.Tab>
        <Tabs.Tab value="settings" leftSection={<span>⚙️</span>} data-testid="tab-settings">
          Settings
        </Tabs.Tab>
      </Tabs.List>
    </Tabs>
  );
}
