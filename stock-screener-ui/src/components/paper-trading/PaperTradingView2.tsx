import { useState, useEffect, useCallback, useMemo } from "react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { Flex, Stack, Alert, ScrollArea } from "@mantine/core";
import {
  getPaperTradingState,
  subscribe,
  setError,
  setAvailableBots,
} from "../../state/paperTrading";
import {
  refreshLiveData,
  initLiveAutoRefresh,
  initBotAutoRefresh,
  stopLiveAutoRefresh,
  refreshBotLiveData,
  listBots,
} from "../../api/paperTrading";
import { fetchBotSummaries } from "../../api/botControlApi";
import type { BotInfo, BotSummary } from "../../types/paperTrading";
import {
  PaperPositionsTable,
  PaperPortfolioCard,
  PaperChart,
  PaperHistoryTable,
  PaperSettings,
  PerformanceAnalytics,
  ActivityFeed,
  AggregatedDashboard,
} from "./mantine";
import {
  usePaperViewActions,
  useHistoryFilters,
  FiltersBar,
  PaperTradingTabs,
} from "./PaperTradingHelpers";
import { LivePriceUpdater } from "./LivePriceUpdater";
import { WatchlistScan2 } from "./WatchlistScan2";
import { SelectedPositionBar } from "./SelectedPositionBar";

function useLoadInitialData(
  setAvailableBots: (bots: BotInfo[]) => void,
  setBotSummaries: (summaries: BotSummary[]) => void,
) {
  const loadInitialData = useCallback(async (): Promise<string | null> => {
    try {
      const [bots, summaries] = await Promise.all([listBots(), fetchBotSummaries()]);
      setAvailableBots(bots);
      setBotSummaries(summaries);
      return bots.length > 0 ? bots[0].id : null;
    } catch (error) {
      setError(`Failed to load initial data: ${error}`);
      return null;
    }
  }, [setAvailableBots, setBotSummaries]);

  return loadInitialData;
}

function useHandleBotSelect(setActiveBotId: (id: string | null) => void) {
  const handleBotSelect = useCallback(
    async (botId: string) => {
      if (!botId) {
        setActiveBotId(null);
        stopLiveAutoRefresh();
        initLiveAutoRefresh();
        refreshLiveData();
      } else {
        setActiveBotId(botId);
        stopLiveAutoRefresh();
        await refreshBotLiveData(botId);
        initBotAutoRefresh(botId);
      }
    },
    [setActiveBotId],
  );

  return handleBotSelect;
}

function usePaperTradingViewModel() {
  useStoreSubscription(subscribe);
  const state = getPaperTradingState();

  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [botSummaries, setBotSummaries] = useState<BotSummary[]>([]);

  const loadInitialData = useLoadInitialData(
    setAvailableBots,
    setBotSummaries,
  );
  const handleBotSelect = useHandleBotSelect(setActiveBotId);
  const handleClearError = useCallback(() => setError(null), []);

  useEffect(() => {
    loadInitialData().then((botId) => {
      if (botId) {
        setActiveBotId(botId);
        refreshBotLiveData(botId);
        initBotAutoRefresh(botId);
      } else {
        refreshLiveData();
      }
    });
    return () => {
      stopLiveAutoRefresh();
    };
  }, [loadInitialData]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchBotSummaries().then(setBotSummaries);
    }, 2000);
    return () => clearTimeout(timer);
  }, [state.botRunning]);

  const actions = usePaperViewActions(activeBotId);
  const filters = useHistoryFilters();

  return {
    state,
    activeBotId,
    botSummaries,
    handleBotSelect,
    handleClearError,
    actions,
    filters,
  };
}

interface LiveViewProps {
  state: ReturnType<typeof getPaperTradingState>;
}

function LiveView({ state }: LiveViewProps) {
  const selectedPosition = useMemo(() => {
    if (!state.selectedSymbol) return null;
    return state.positions.find((p) => p.symbol === state.selectedSymbol) || null;
  }, [state.positions, state.selectedSymbol]);

  return (
    <Flex
      h="100%"
      gap="xs"
      direction={{ base: "column", md: "row" }}
      className="paper-live-view"
      id="live-view-grid"
    >
      <Flex
        direction="column"
        style={{ width: "35%", minWidth: 0 }}
        className="paper-left-panel"
        id="left-panel"
        data-testid="paper-left-panel"
      >
        <PaperPortfolioCard portfolio={state.portfolio as any} />
        <ScrollArea flex={1} style={{ minHeight: 0 }}>
          <Flex direction="column" gap="xs">
            <PaperPositionsTable />
          </Flex>
        </ScrollArea>
        <WatchlistScan2 snapshot={state.botSnapshot} selectedSymbol={state.selectedSymbol} />
      </Flex>
      <Flex
        direction="column"
        style={{ width: "65%", minWidth: 0, overflow: "hidden" }}
        className="paper-right-panel"
        id="right-panel"
        data-testid="paper-right-panel"
      >
        <PaperChart />
        <SelectedPositionBar position={selectedPosition} />
      </Flex>
    </Flex>
  );
}

interface HistoryViewProps {
  state: ReturnType<typeof getPaperTradingState>;
}

function HistoryView({ state: _state }: HistoryViewProps) {
  return (
    <Flex
      className="paper-history-view"
      id="history-view"
      gap="xs"
      h="100%"
      direction={{ base: "column", md: "row" }}
      data-testid="paper-history-panel"
    >
      <Flex flex="1 1 50%" direction="column" style={{ minWidth: 0, overflow: "hidden" }}>
        <PaperHistoryTable />
      </Flex>
      <Flex flex="1 1 50%" direction="column" style={{ minWidth: 0, overflow: "hidden" }}>
        <PaperChart />
      </Flex>
    </Flex>
  );
}

interface SettingsViewProps {
  state: ReturnType<typeof getPaperTradingState>;
}

function SettingsView({ state: _state }: SettingsViewProps) {
  return (
    <Flex
      h="100%"
      className="paper-settings-view"
      id="settings-view"
      data-testid="paper-settings-panel"
      direction="column"
    >
      <ScrollArea flex={1} style={{ minHeight: 0 }} type="auto" offsetScrollbars>
        <Flex direction="column" w="100%" style={{ maxWidth: 780, margin: "0 auto" }}>
          <PaperSettings />
        </Flex>
      </ScrollArea>
    </Flex>
  );
}

interface ErrorAlertProps {
  message: string;
  onClose: () => void;
}

function ErrorAlert({ message, onClose }: ErrorAlertProps) {
  return (
    <Alert
      title="Error"
      color="red"
      variant="filled"
      mb="xs"
      data-testid="paper-error"
      withCloseButton
      onClose={onClose}
    >
      {message}
    </Alert>
  );
}

interface HeaderSectionProps {
  state: ReturnType<typeof getPaperTradingState>;
  botSummaries: BotSummary[];
  activeBotId: string | null;
  actions: ReturnType<typeof usePaperViewActions>;
  filters: ReturnType<typeof useHistoryFilters>;
  handleBotSelect: (botId: string) => Promise<void>;
}

function HeaderSection({
  state,
  botSummaries,
  activeBotId,
  actions,
  filters,
  handleBotSelect,
}: HeaderSectionProps) {
  return (
    <Flex
      flex="0 0 auto"
      mb="xs"
      className="paper-trading-header"
      id="paper-header"
      direction="column"
    >
      <Stack gap="xs">
        <Flex justify="space-between" align="center">
          <PaperTradingTabs state={state} onViewChange={actions.handleViewChange} />
        </Flex>
        <Flex data-testid="paper-filters">
          <FiltersBar
            activeBotId={activeBotId}
            bots={botSummaries}
            state={state}
            actions={{ ...actions, handleBotSelect }}
            filters={filters}
          />
        </Flex>
      </Stack>
    </Flex>
  );
}

export function PaperTradingView() {
  const { state, activeBotId, botSummaries, handleBotSelect, handleClearError, actions, filters } =
    usePaperTradingViewModel();

  return (
    <Flex
      direction="column"
      h="100%"
      p="xs"
      className="paper-trading-view"
      id="paper-trading-main"
      style={{ overflow: "hidden" }}
      data-testid="paper-trading-view"
    >
      <LivePriceUpdater />
      {state.error && <ErrorAlert message={state.error} onClose={handleClearError} />}

      <HeaderSection
        state={state}
        botSummaries={botSummaries}
        activeBotId={activeBotId}
        actions={actions}
        filters={filters}
        handleBotSelect={handleBotSelect}
      />

      <Flex
        direction="column"
        flex={1}
        style={{ minHeight: 0 }}
        className="paper-content-area"
        id="paper-content"
      >
        {state.currentView === "live" && <LiveView state={state} />}
        {state.currentView === "history" && <HistoryView state={state} />}
        {state.currentView === "settings" && <SettingsView state={state} />}
        {state.currentView === "analytics" && (
          <ScrollArea flex={1} style={{ minHeight: 0 }} type="auto" offsetScrollbars>
            <PerformanceAnalytics />
          </ScrollArea>
        )}
        {state.currentView === "activity" && (
          <ScrollArea flex={1} style={{ minHeight: 0 }} type="auto" offsetScrollbars>
            <ActivityFeed />
          </ScrollArea>
        )}
        {state.currentView === "aggregated" && (
          <ScrollArea flex={1} style={{ minHeight: 0 }} type="auto" offsetScrollbars>
            <AggregatedDashboard />
          </ScrollArea>
        )}
      </Flex>
    </Flex>
  );
}
