import { useCallback } from "react";
import dayjs from "dayjs";
import { Flex, Tabs, Text, Group, Button, Select, Tooltip } from "@mantine/core";
import { TradingDatePicker } from "../common/TradingDatePicker";
import { IconRefresh, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import {
  getPaperTradingState,
  setPaperTradingView,
  setFilterFromDate,
  setFilterToDate,
  setFilterSymbol,
} from "../../state/paperTrading";
import type { PaperTradingView, PaperTrade, BotSummary } from "../../types/paperTrading";
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
import { BotCardStrip } from "./BotCardStrip";
import { StatusBadge } from "../common/BadgeComponents";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { subscribeToHolidays, isMarketClosedToday } from "../../state/holidays";

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
  bots,
  state,
  actions,
}: {
  activeBotId: string | null;
  bots: BotSummary[];
  state: ReturnType<typeof getPaperTradingState>;
  actions: ReturnType<typeof usePaperViewActions>;
}) {
  useStoreSubscription(subscribeToHolidays);
  const marketClosed = isMarketClosedToday();

  const selectedBot = bots.find((b) => b.id === activeBotId);
  const botName = selectedBot?.name || "Bot";

  return (
    <Flex gap="sm" align="center" wrap="wrap">
      <BotCardStrip bots={bots} selectedBotId={activeBotId} onSelect={actions.handleBotSelect} />
      <Group gap="xs">
        <StatusBadge
          running={state.botRunning}
          pid={state.botPid ?? undefined}
          data-testid="bot-status"
        />
        <Button
          size="xs"
          variant="subtle"
          leftSection={<IconRefresh size={14} />}
          onClick={actions.handleRefresh}
          data-testid="refresh-btn"
        >
          Refresh
        </Button>
        {state.botRunning ? (
          <Button
            size="xs"
            variant="subtle"
            color="red"
            leftSection={<IconPlayerStop size={14} />}
            onClick={actions.handleToggleBot}
            data-testid="stop-bot-btn"
          >
            Stop {botName}
          </Button>
        ) : (
          <Tooltip
            label="Market closed — cannot start bot"
            disabled={!marketClosed}
          >
            <span>
              <Button
                size="xs"
                variant="subtle"
                color="blue"
                leftSection={<IconPlayerPlay size={14} />}
                onClick={actions.handleToggleBot}
                disabled={marketClosed}
                data-testid="start-bot-btn"
              >
                Start {botName}
              </Button>
            </span>
          </Tooltip>
        )}
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
        <Tabs.Tab value="live" leftSection={<span>📊</span>} data-testid="tab-live">
          Positions
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
