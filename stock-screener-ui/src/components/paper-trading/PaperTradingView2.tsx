import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { Stack, Alert, ScrollArea } from "@/ui";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Box from "@mui/material/Box";
import {
  getPaperTradingState,
  subscribe,
  setError,
  setAvailableBots,
  setPaperTradingView,
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
  scanRefreshing: boolean;
  handleScanRefresh: () => void;
}

function LiveView({ state, scanRefreshing, handleScanRefresh }: LiveViewProps) {
  const selectedPosition = useMemo(() => {
    if (!state.selectedSymbol) return null;
    return state.positions.find((p) => p.symbol === state.selectedSymbol) || null;
  }, [state.positions, state.selectedSymbol]);

  return (
    <Box className="paper-live-view-grid" sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2, flex: 1, minHeight: 0 }} data-testid="live-view-grid" id="live-view-grid">
      <Box className="paper-live-left-panel" sx={{ flex: { xs: "1 1 auto", md: "0 0 42%" }, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }} data-testid="paper-left-panel" id="left-panel">
        <Card className="paper-portfolio-card-wrap" id="paper-portfolio-card-wrap" elevation={0}>
          <CardContent className="paper-portfolio-card-content" sx={{ p: 1, "&:last-child": { pb: 1 }, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PaperPortfolioCard portfolio={state.portfolio as any} />
          </CardContent>
        </Card>
        <Card className="paper-positions-card-wrap" id="paper-positions-card-wrap" elevation={0} sx={{ flex: 1, minHeight: 160, display: "flex", flexDirection: "column" }}>
          <CardContent className="paper-positions-card-content" sx={{ p: 1, "&:last-child": { pb: 1 }, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <ScrollArea className="paper-positions-scroll" flex={1} sx={{ minHeight: 0 }}>
              <Stack className="paper-positions-stack" spacing={1}>
                <PaperPositionsTable />
              </Stack>
            </ScrollArea>
          </CardContent>
        </Card>
        <Card className="paper-watchlist-card-wrap" id="paper-watchlist-card-wrap" elevation={0} sx={{ flex: "0 1 auto", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <CardContent className="paper-watchlist-card-content" sx={{ p: 1, "&:last-child": { pb: 1 }, flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
            <WatchlistScan2 snapshot={state.botSnapshot} selectedSymbol={state.selectedSymbol} onRefresh={handleScanRefresh} refreshing={scanRefreshing} />
          </CardContent>
        </Card>
      </Box>
      <Box className="paper-live-right-panel" sx={{ flex: { xs: "1 1 auto", md: "1 1 58%" }, minWidth: 0, display: "flex", flexDirection: "column", gap: 1, overflow: "hidden" }} data-testid="paper-right-panel" id="right-panel">
        <Card className="paper-chart-card-wrap" id="paper-chart-card-wrap" elevation={0} sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <CardContent className="paper-chart-card-content" sx={{ p: 1, "&:last-child": { pb: 1 }, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PaperChart />
          </CardContent>
        </Card>
        <SelectedPositionBar position={selectedPosition} />
      </Box>
    </Box>
  );
}

interface HistoryViewProps {
  state: ReturnType<typeof getPaperTradingState>;
}

function HistoryView({ state: _state }: HistoryViewProps) {
  return (
    <Box className="paper-history-view" sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2, flex: 1, minHeight: 0 }} data-testid="paper-history-panel" id="history-view">
      <Box className="paper-history-left" id="paper-history-left" sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Card className="paper-history-table-card" id="paper-history-table-card" elevation={0} sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <CardContent className="paper-history-table-card-content" sx={{ p: 1, "&:last-child": { pb: 1 }, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PaperHistoryTable />
          </CardContent>
        </Card>
      </Box>
      <Box className="paper-history-right" id="paper-history-right" sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Card className="paper-history-chart-card" id="paper-history-chart-card" elevation={0} sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <CardContent className="paper-history-chart-card-content" sx={{ p: 1, "&:last-child": { pb: 1 }, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PaperChart engine="tradingview" />
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}

interface SettingsViewProps {
  state: ReturnType<typeof getPaperTradingState>;
}

function SettingsView({ state: _state }: SettingsViewProps) {
  return (
    <Box className="paper-settings-view" sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }} data-testid="paper-settings-panel" id="settings-view">
      <ScrollArea className="paper-settings-scroll" flex={1} sx={{ minHeight: 0 }} type="auto">
        <Box className="paper-settings-inner" id="paper-settings-inner" sx={{ maxWidth: 1200, mx: "auto", width: "100%", p: 1.5 }}>
          <PaperSettings />
        </Box>
      </ScrollArea>
    </Box>
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
    <Box className="paper-header-section" sx={{ flex: "0 0 auto", mb: 1 }} id="paper-header" data-testid="paper-header">
      <Stack className="paper-header-stack" spacing={1}>
        <Box className="paper-header-tabs-wrap" id="paper-header-tabs-wrap" sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <PaperTradingTabs state={state} onViewChange={actions.handleViewChange} />
        </Box>
        <Box className="paper-filters-wrap" id="paper-filters-wrap" data-testid="paper-filters">
          <FiltersBar
            activeBotId={activeBotId}
            bots={botSummaries}
            state={state}
            actions={{ ...actions, handleBotSelect }}
            filters={filters}
          />
        </Box>
      </Stack>
    </Box>
  );
}

export function PaperTradingView() {
  const { state, activeBotId, botSummaries, handleBotSelect, handleClearError, actions, filters, scanRefreshing, handleScanRefresh } =
    usePaperTradingViewModel();

  return (
    <Box className="paper-trading-view" sx={{ px: 2, py: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }} data-testid="paper-trading-view" id="paper-trading-main">
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

      <Box className="paper-content" sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }} id="paper-content">
        {state.currentView === "live" && <LiveView state={state} scanRefreshing={scanRefreshing} handleScanRefresh={handleScanRefresh} />}
        {state.currentView === "history" && <HistoryView state={state} />}
        {state.currentView === "settings" && <SettingsView state={state} />}
        {state.currentView === "activity" && (
          <ScrollArea flex={1} sx={{ minHeight: 0 }} type="auto">
            <ActivityFeed />
          </ScrollArea>
        )}
        {state.currentView === "aggregated" && (
          <ScrollArea flex={1} sx={{ minHeight: 0 }} type="auto">
            <AggregatedDashboard />
          </ScrollArea>
        )}
      </Box>
    </Box>
  );
}
