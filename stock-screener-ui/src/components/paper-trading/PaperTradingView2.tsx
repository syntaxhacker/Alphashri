import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { Stack, Alert, ScrollArea, Card } from "@/ui";
import {
  getPaperTradingState,
  subscribe,
  setError,
  setAvailableBots,
} from "../../state/paperTrading";
import type { PaperTradingView as PaperView } from "../../types/paperTrading";
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
  ActivityFeed,
  AggregatedDashboard,
} from ".";
import {
  usePaperViewActions,
  useHistoryFilters,
  FiltersBar,
  PaperTradingTabs,
} from "./PaperTradingHelpers";
import { LivePriceUpdater } from "./LivePriceUpdater";
import { WatchlistScan2 } from "./WatchlistScan2";
import { SelectedPositionBar } from "./SelectedPositionBar";
import { OptionPayoffCard } from "./OptionPayoffChart";
import { isOptionTrade } from "./optionTradeUtils";

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
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [botSummaries, setBotSummaries] = useState<BotSummary[]>([]);
  const [scanRefreshing, setScanRefreshing] = useState(false);

  const loadInitialData = useLoadInitialData(
    setAvailableBots,
    setBotSummaries,
  );
  const handleBotSelect = useHandleBotSelect(setActiveBotId);
  const handleClearError = useCallback(() => setError(null), []);

  const actions = usePaperViewActions(activeBotId);
  const filters = useHistoryFilters();

  // Sync URL ?view= -> state on mount and on browser nav (uses handleViewChange to also fetch data)
  useEffect(() => {
    const viewParam = searchParams.get("view") as PaperView | null;
    const valid: PaperView[] = ["live", "history", "settings", "activity", "aggregated"];
    if (viewParam && valid.includes(viewParam) && viewParam !== state.currentView) {
      actions.handleViewChange(viewParam);
    } else if (!viewParam) {
      // No param -> push current view to URL for deep-link consistency
      const next = new URLSearchParams(searchParams);
      next.set("view", state.currentView);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync state -> URL when tab changes (via actions)
  useEffect(() => {
    const view = state.currentView;
    const currentParam = searchParams.get("view");
    if (currentParam !== view) {
      const next = new URLSearchParams(searchParams);
      next.set("view", view);
      setSearchParams(next, { replace: false });
    }
  }, [state.currentView, searchParams, setSearchParams]);

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

  const handleScanRefresh = useCallback(async () => {
    if (!activeBotId) return;
    setScanRefreshing(true);
    await refreshBotLiveData(activeBotId);
    setScanRefreshing(false);
  }, [activeBotId]);

  return {
    state,
    activeBotId,
    botSummaries,
    handleBotSelect,
    handleClearError,
    actions,
    filters,
    scanRefreshing,
    handleScanRefresh,
  };
}

interface LiveViewProps {
  state: ReturnType<typeof getPaperTradingState>;
  activeBotId: string | null;
  scanRefreshing: boolean;
  handleScanRefresh: () => void;
}

function LiveView({ state, activeBotId, scanRefreshing, handleScanRefresh }: LiveViewProps) {
  const selectedPosition = useMemo(() => {
    if (!state.selectedSymbol) return null;
    return state.positions.find((p) => p.symbol === state.selectedSymbol) || null;
  }, [state.positions, state.selectedSymbol]);

  return (
    <div className="paper-live-view-grid flex flex-col md:flex-row gap-2 flex-1 min-h-0" data-testid="live-view-grid" id="live-view-grid">
      <div className="paper-live-left-panel flex-1 md:[flex:0_0_42%] min-w-0 min-h-0 flex flex-col gap-2" data-testid="paper-left-panel" id="left-panel">
        <Card className="paper-portfolio-card-wrap" id="paper-portfolio-card-wrap">
          <div className="paper-portfolio-card-content p-1 flex-1 min-h-0 flex flex-col">
            <PaperPortfolioCard portfolio={state.portfolio as any} />
          </div>
        </Card>
        <Card className="paper-positions-card-wrap flex-1 min-h-40 flex flex-col" id="paper-positions-card-wrap">
          <div className="paper-positions-card-content p-1 flex-1 min-h-0 flex flex-col">
            <ScrollArea className="paper-positions-scroll min-h-0" flex={1}>
              <Stack className="paper-positions-stack" spacing={0.5}>
                <PaperPositionsTable activeBotId={activeBotId} />
              </Stack>
            </ScrollArea>
          </div>
        </Card>
        <Card className="paper-watchlist-card-wrap [flex:0_1_auto] min-h-0 overflow-hidden flex flex-col" id="paper-watchlist-card-wrap">
          <div className="paper-watchlist-card-content p-1 flex-1 min-h-0 overflow-auto flex flex-col">
            <WatchlistScan2 snapshot={state.botSnapshot} selectedSymbol={state.selectedSymbol} onRefresh={handleScanRefresh} refreshing={scanRefreshing} />
          </div>
        </Card>
      </div>
      <div className="paper-live-right-panel flex-1 md:[flex:1_1_58%] min-w-0 min-h-0 flex flex-col gap-2 overflow-hidden" data-testid="paper-right-panel" id="right-panel">
        <Card className="paper-chart-card-wrap flex-1 min-h-0 flex flex-col" id="paper-chart-card-wrap">
          <div className="paper-chart-card-content p-1 flex-1 min-h-0 flex flex-col">
            <PaperChart />
          </div>
        </Card>
        <SelectedPositionBar position={selectedPosition} />
      </div>
    </div>
  );
}

interface HistoryViewProps {
  state: ReturnType<typeof getPaperTradingState>;
}

function HistoryView({ state }: HistoryViewProps) {
  const selectedTrade = useMemo(
    () =>
      state.selectedTradeId
        ? state.trades.find((t) => t.trade_id === state.selectedTradeId) ?? null
        : null,
    [state.trades, state.selectedTradeId],
  );
  const showPayoff = selectedTrade != null && isOptionTrade(selectedTrade);

  return (
    <div className="paper-history-view flex flex-col md:flex-row gap-2 flex-1 min-h-0" data-testid="paper-history-panel" id="history-view">
      <div className="paper-history-left flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden" id="paper-history-left">
        <Card className="paper-history-table-card flex-1 min-h-0 flex flex-col" id="paper-history-table-card">
          <div className="paper-history-table-card-content p-1 flex-1 min-h-0 flex flex-col">
            <PaperHistoryTable />
          </div>
        </Card>
      </div>
      <div className="paper-history-right flex-1 min-w-0 min-h-0 flex flex-col gap-2 overflow-hidden" id="paper-history-right">
        <Card className="paper-history-chart-card flex-1 min-h-0 flex flex-col" id="paper-history-chart-card">
          <div className="paper-history-chart-card-content p-1 flex-1 min-h-0 flex flex-col">
            <PaperChart engine="tradingview" />
          </div>
        </Card>
        {showPayoff && selectedTrade && <OptionPayoffCard trade={selectedTrade} />}
      </div>
    </div>
  );
}

interface SettingsViewProps {
  state: ReturnType<typeof getPaperTradingState>;
}

function SettingsView({ state: _state }: SettingsViewProps) {
  return (
    <div className="paper-settings-view flex-1 min-h-0 flex flex-col" data-testid="paper-settings-panel" id="settings-view">
      <ScrollArea className="paper-settings-scroll min-h-0" flex={1} type="auto">
        <div className="paper-settings-inner max-w-[1200px] mx-auto w-full p-1" id="paper-settings-inner">
          <PaperSettings />
        </div>
      </ScrollArea>
    </div>
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
      color="error"
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
    <div className="paper-header-section [flex:0_0_auto] mb-1" id="paper-header" data-testid="paper-header">
      <Stack className="paper-header-stack" spacing={0.5}>
        <div className="paper-header-tabs-wrap flex justify-between items-center" id="paper-header-tabs-wrap">
          <PaperTradingTabs state={state} onViewChange={actions.handleViewChange} />
        </div>
        <div className="paper-filters-wrap" id="paper-filters-wrap" data-testid="paper-filters">
          <FiltersBar
            activeBotId={activeBotId}
            bots={botSummaries}
            state={state}
            actions={{ ...actions, handleBotSelect }}
            filters={filters}
          />
        </div>
      </Stack>
    </div>
  );
}

export function PaperTradingView() {
  const { state, activeBotId, botSummaries, handleBotSelect, handleClearError, actions, filters, scanRefreshing, handleScanRefresh } =
    usePaperTradingViewModel();

  return (
    <div className="paper-trading-view px-4 py-1 flex flex-col h-full overflow-hidden" data-testid="paper-trading-view" id="paper-trading-main">
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

      <div className="paper-content flex-1 min-h-0 flex flex-col" id="paper-content">
        {state.currentView === "live" && <LiveView state={state} activeBotId={activeBotId} scanRefreshing={scanRefreshing} handleScanRefresh={handleScanRefresh} />}
        {state.currentView === "history" && <HistoryView state={state} />}
        {state.currentView === "settings" && <SettingsView state={state} />}
        {state.currentView === "activity" && (
          <ScrollArea className="min-h-0" flex={1} type="auto">
            <ActivityFeed />
          </ScrollArea>
        )}
        {state.currentView === "aggregated" && (
          <ScrollArea className="min-h-0" flex={1} type="auto">
            <AggregatedDashboard />
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
