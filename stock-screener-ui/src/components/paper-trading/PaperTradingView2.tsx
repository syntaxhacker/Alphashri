import { useState, useEffect, useCallback } from "react";
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
} from "./mantine";
import {
  usePaperViewActions,
  useHistoryFilters,
  FiltersBar,
  PaperTradingTabs,
} from "./PaperTradingHelpers";

function useLoadInitialData(
  activeBotId: string | null,
  setActiveBotId: (id: string) => void,
  setAvailableBots: (bots: BotInfo[]) => void,
  setBotSummaries: (summaries: BotSummary[]) => void,
) {
  const loadInitialData = useCallback(async () => {
    try {
      const [bots, summaries] = await Promise.all([listBots(), fetchBotSummaries()]);
      setAvailableBots(bots);
      setBotSummaries(summaries);
      const botId = activeBotId || (bots.length > 0 ? bots[0].id : null);
      if (botId) {
        setActiveBotId(botId);
        await refreshBotLiveData(botId);
      } else {
        refreshLiveData();
      }
    } catch (error) {
      setError(`Failed to load initial data: ${error}`);
    }
  }, [activeBotId, setActiveBotId, setAvailableBots, setBotSummaries]);

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
    activeBotId,
    setActiveBotId,
    setAvailableBots,
    setBotSummaries,
  );
  const handleBotSelect = useHandleBotSelect(setActiveBotId);
  const handleClearError = useCallback(() => setError(null), []);

  useEffect(() => {
    loadInitialData();
    return () => {
      stopLiveAutoRefresh();
    };
  }, [loadInitialData]);

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
  return (
    <Flex
      h="100%"
      gap="md"
      direction={{ base: "column", md: "row" }}
      className="paper-live-view"
      id="live-view-grid"
    >
      <Flex
        direction="column"
        w={{ base: "100%", md: "50%" }}
        style={{ minWidth: 0 }}
        className="paper-left-panel"
        id="left-panel"
        data-testid="paper-left-panel"
      >
        <PaperPortfolioCard
          portfolio={state.portfolio as any}
          isMultiStrategy={state.availableBots.length > 0}
          strategySummaries={[]}
        />
        <ScrollArea flex={1} style={{ minHeight: 0 }}>
          <PaperPositionsTable />
        </ScrollArea>
      </Flex>
      <Flex
        direction="column"
        flex={1}
        style={{ minWidth: 0, overflow: "hidden" }}
        className="paper-right-panel"
        id="right-panel"
        data-testid="paper-right-panel"
      >
        <PaperChart />
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
      gap="md"
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
      mb="md"
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
      mb="md"
      className="paper-trading-header"
      id="paper-header"
      direction="column"
    >
      <Stack gap="sm">
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
      p="sm"
      className="paper-trading-view"
      id="paper-trading-main"
      style={{ overflow: "hidden" }}
      data-testid="paper-trading-view"
    >
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
      </Flex>
    </Flex>
  );
}
