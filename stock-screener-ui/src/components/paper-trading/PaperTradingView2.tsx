import { createSignal, createMemo, createEffect, onCleanup, onMount, Show, Match, Switch } from "solid-js";
import { useStoreSnapshot } from "./storeSnapshot";
import { Alert, ScrollArea, Stack, ToolbarRow, Card } from "@/ui";
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
import type { BotSummary } from "../../types/paperTrading";
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
import type { Portfolio } from "./PaperPortfolioCard";
type PaperTradingSnapshot = ReturnType<typeof getPaperTradingState>;

function useLoadInitialData(setBotSummaries: (summaries: BotSummary[]) => void) {
  const loadInitialData = async (): Promise<string | null> => {
    try {
      const [bots, summaries] = await Promise.all([listBots(), fetchBotSummaries()]);
      setAvailableBots(bots);
      setBotSummaries(summaries);
      return bots.length > 0 ? bots[0].id : null;
    } catch (error) {
      setError(`Failed to load initial data: ${error}`);
      return null;
    }
  };

  return loadInitialData;
}

function useHandleBotSelect(setActiveBotId: (id: string | null) => void) {
  const handleBotSelect = async (botId: string) => {
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
  };

  return handleBotSelect;
}

const VALID_VIEWS: PaperView[] = ["live", "history", "settings", "activity", "aggregated"];

function useUrlViewParam(state: () => PaperTradingSnapshot, handleViewChange: (view: PaperView) => void) {
  // Push state -> URL when the tab changes; honor back/forward navigation.
  let firstRun = true;

  createEffect(() => {
    const view = state().currentView;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") !== view) {
      params.set("view", view);
      const next = `${window.location.pathname}?${params.toString()}`;
      // Mount-time consistency replace; later user actions push history entries.
      if (firstRun) window.history.replaceState({}, "", next);
      else window.history.pushState({}, "", next);
    }
    firstRun = false;
  });

  onMount(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view") as PaperView | null;
    if (viewParam && VALID_VIEWS.includes(viewParam) && viewParam !== getPaperTradingState().currentView) {
      handleViewChange(viewParam);
    }

    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const view = params.get("view") as PaperView | null;
      if (view && VALID_VIEWS.includes(view) && view !== getPaperTradingState().currentView) {
        handleViewChange(view);
      }
    };
    window.addEventListener("popstate", onPopState);
    onCleanup(() => window.removeEventListener("popstate", onPopState));
  });
}

function usePaperTradingViewModel() {
  const state = useStoreSnapshot(subscribe, getPaperTradingState);

  const [activeBotId, setActiveBotId] = createSignal<string | null>(null);
  const [botSummaries, setBotSummaries] = createSignal<BotSummary[]>([]);
  const [scanRefreshing, setScanRefreshing] = createSignal(false);

  const loadInitialData = useLoadInitialData(setBotSummaries);
  const handleBotSelect = useHandleBotSelect(setActiveBotId);
  const handleClearError = () => setError(null);

  const actions = usePaperViewActions(() => activeBotId());
  const filters = useHistoryFilters();

  useUrlViewParam(state, (view) => { void actions.handleViewChange(view); });

  onMount(() => {
    loadInitialData().then((botId) => {
      if (botId) {
        setActiveBotId(botId);
        refreshBotLiveData(botId);
        initBotAutoRefresh(botId);
      } else {
        refreshLiveData();
      }
    });
    onCleanup(() => {
      stopLiveAutoRefresh();
    });
  });

  createEffect(() => {
    const running = state().botRunning;
    void running;
    const timer = setTimeout(() => {
      fetchBotSummaries().then(setBotSummaries);
    }, 2000);
    onCleanup(() => clearTimeout(timer));
  });

  const handleScanRefresh = async () => {
    const botId = activeBotId();
    if (!botId) return;
    setScanRefreshing(true);
    await refreshBotLiveData(botId);
    setScanRefreshing(false);
  };

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

type ViewModel = ReturnType<typeof usePaperTradingViewModel>;

function LiveView(props: { state: PaperTradingSnapshot; activeBotId: string | null; scanRefreshing: boolean; handleScanRefresh: () => void }) {
  const selectedPosition = createMemo(() => {
    if (!props.state.selectedSymbol) return null;
    return props.state.positions.find((p) => p.symbol === props.state.selectedSymbol) || null;
  });

  return (
    <div class="paper-live-view-grid flex flex-col md:flex-row gap-2 flex-1 min-h-0" data-testid="live-view-grid" id="live-view-grid">
      <div class="paper-live-left-panel flex-1 md:[flex:0_0_42%] min-w-0 min-h-0 flex flex-col gap-2" data-testid="paper-left-panel" id="left-panel">
        <Card className="paper-portfolio-card-wrap" id="paper-portfolio-card-wrap">
          <div class="paper-portfolio-card-content p-1 flex-1 min-h-0 flex flex-col">
            <PaperPortfolioCard portfolio={props.state.portfolio as Portfolio | null} />
          </div>
        </Card>
        <Card className="paper-positions-card-wrap flex-1 min-h-40 flex flex-col" id="paper-positions-card-wrap">
          <div class="paper-positions-card-content p-1 flex-1 min-h-0 flex flex-col">
            <ScrollArea className="paper-positions-scroll min-h-0" flex={1}>
              <Stack className="paper-positions-stack" spacing={0.5}>
                <PaperPositionsTable activeBotId={props.activeBotId} />
              </Stack>
            </ScrollArea>
          </div>
        </Card>
        <Card className="paper-watchlist-card-wrap [flex:0_1_auto] min-h-0 overflow-hidden flex flex-col" id="paper-watchlist-card-wrap">
          <div class="paper-watchlist-card-content p-1 flex-1 min-h-0 overflow-auto flex flex-col">
            <WatchlistScan2 snapshot={props.state.botSnapshot} selectedSymbol={props.state.selectedSymbol} onRefresh={props.handleScanRefresh} refreshing={props.scanRefreshing} />
          </div>
        </Card>
      </div>
      <div class="paper-live-right-panel flex-1 md:[flex:1_1_58%] min-w-0 min-h-0 flex flex-col gap-2 overflow-hidden" data-testid="paper-right-panel" id="right-panel">
        <Card className="paper-chart-card-wrap flex-1 min-h-0 flex flex-col" id="paper-chart-card-wrap">
          <div class="paper-chart-card-content p-1 flex-1 min-h-0 flex flex-col">
            <PaperChart />
          </div>
        </Card>
        <SelectedPositionBar position={selectedPosition()} />
      </div>
    </div>
  );
}

function HistoryView(props: { state: PaperTradingSnapshot }) {
  const selectedTrade = createMemo(() =>
    props.state.selectedTradeId
      ? props.state.trades.find((t) => t.trade_id === props.state.selectedTradeId) ?? null
      : null,
  );
  const showPayoff = () => selectedTrade() != null && isOptionTrade(selectedTrade()!);

  return (
    <div class="paper-history-view flex flex-col md:flex-row gap-2 flex-1 min-h-0" data-testid="paper-history-panel" id="history-view">
      <div class="paper-history-left flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden" id="paper-history-left">
        <Card className="paper-history-table-card flex-1 min-h-0 flex flex-col" id="paper-history-table-card">
          <div class="paper-history-table-card-content p-1 flex-1 min-h-0 flex flex-col">
            <PaperHistoryTable />
          </div>
        </Card>
      </div>
      <div class="paper-history-right flex-1 min-w-0 min-h-0 flex flex-col gap-2 overflow-hidden" id="paper-history-right">
        <Card className="paper-history-chart-card flex-1 min-h-0 flex flex-col" id="paper-history-chart-card">
          <div class="paper-history-chart-card-content p-1 flex-1 min-h-0 flex flex-col">
            <PaperChart engine="tradingview" />
          </div>
        </Card>
        <Show when={showPayoff() ? selectedTrade() : null}>
          {(trade) => <OptionPayoffCard trade={trade()!} />}
        </Show>
      </div>
    </div>
  );
}

function SettingsView() {
  return (
    <div class="paper-settings-view flex-1 min-h-0 flex flex-col" data-testid="paper-settings-panel" id="settings-view">
      <ScrollArea className="paper-settings-scroll min-h-0" flex={1} type="auto">
        <div class="paper-settings-inner max-w-[1200px] mx-auto w-full p-1" id="paper-settings-inner">
          <PaperSettings />
        </div>
      </ScrollArea>
    </div>
  );
}

function ErrorAlert(props: { message: string; onClose: () => void }) {
  return (
    <Alert
      title="Error"
      color="error"
      variant="filled"
      mb="xs"
      data-testid="paper-error"
      withCloseButton
      onClose={props.onClose}
    >
      {props.message}
    </Alert>
  );
}

function HeaderSection(props: {
  state: PaperTradingSnapshot;
  botSummaries: BotSummary[];
  activeBotId: string | null;
  actions: ViewModel["actions"];
  filters: ViewModel["filters"];
  handleBotSelect: (botId: string) => Promise<void>;
}) {
  return (
    <ToolbarRow
      id="paper-header"
      data-testid="paper-header"
      gap={8}
      wrap={false}
      clip
      className="paper-header-section [flex:0_0_auto] mb-1 shrink-0"
      style={{
        "padding-left": "12px",
        "padding-right": "12px",
        "flex-shrink": 0,
      }}
    >
      <PaperTradingTabs state={props.state} onViewChange={props.actions.handleViewChange} />
      <div
        id="paper-filters-wrap"
        data-testid="paper-filters"
        class="ml-auto flex items-center"
      >
        <FiltersBar
          activeBotId={props.activeBotId}
          bots={props.botSummaries}
          state={props.state}
          actions={{ ...props.actions, handleBotSelect: props.handleBotSelect }}
          filters={props.filters}
        />
      </div>
    </ToolbarRow>
  );
}

export function PaperTradingView() {
  const vm = usePaperTradingViewModel();

  return (
    <div class="paper-trading-view px-4 py-1 flex flex-col h-full overflow-hidden" data-testid="paper-trading-view" id="paper-trading-main">
      <LivePriceUpdater />
      <Show when={vm.state().error}>
        {(message) => <ErrorAlert message={message()!} onClose={vm.handleClearError} />}
      </Show>

      <HeaderSection
        state={vm.state()}
        botSummaries={vm.botSummaries()}
        activeBotId={vm.activeBotId()}
        actions={vm.actions}
        filters={vm.filters}
        handleBotSelect={vm.handleBotSelect}
      />

      <div class="paper-content flex-1 min-h-0 flex flex-col" id="paper-content">
        <Switch>
          <Match when={vm.state().currentView === "live"}>
            <LiveView state={vm.state()} activeBotId={vm.activeBotId()} scanRefreshing={vm.scanRefreshing()} handleScanRefresh={vm.handleScanRefresh} />
          </Match>
          <Match when={vm.state().currentView === "history"}>
            <HistoryView state={vm.state()} />
          </Match>
          <Match when={vm.state().currentView === "settings"}>
            <SettingsView />
          </Match>
          <Match when={vm.state().currentView === "activity"}>
            <ScrollArea className="min-h-0" flex={1} type="auto">
              <ActivityFeed />
            </ScrollArea>
          </Match>
          <Match when={vm.state().currentView === "aggregated"}>
            <ScrollArea className="min-h-0" flex={1} type="auto">
              <AggregatedDashboard />
            </ScrollArea>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
