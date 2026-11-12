import { For, Show, Suspense, createEffect, createMemo, createSignal, lazy, onCleanup, onMount } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { Box, Stack, Paper, Tabs, Text, Select, Skeleton, ActionIcon, Switch, Tooltip } from "@/ui";
import { IconTable, IconChartDots, IconSettings, IconLayoutDashboard, IconRefresh, IconCoins, IconCalendarEvent, IconChartCandle, IconWorld } from "./icons";
import * as state from "../../state";
import { DashboardView } from "./DashboardView";
import { ScreenerHeader } from "./ScreenerHeader";
// ScreenerContent pulls the table + heatmap (echarts) graph — several MB of
// module evaluation on the critical path of every landing. Load it on first
// render of the Screener tab, not at page boot.
const ScreenerContent = lazy(() =>
  import("./ScreenerContent").then((m) => ({ default: m.ScreenerContent })),
);
import { SelectionBar } from "./SelectionBar";
import { screenerHasSideFilters } from "./ScreenerSidePanel";
import { GroupPerformancePanel } from "./GroupPerformancePanel";
import { ScreenerInlineFilters } from "./ScreenerInlineFilters";
import { ErrorBoundary } from "../common/ErrorBoundary";

const CorrelationTab = lazy(() => import("./CorrelationTab").then((m) => ({ default: m.CorrelationTab })));
const ScreenerConfigView = lazy(() => import("./ScreenerConfigView").then((m) => ({ default: m.ScreenerConfigView })));
const DeepValueTab = lazy(() => import("../value/ValuePanel").then((m) => ({ default: m.ValuePanel })));
const EventsTab = lazy(() => import("../events/EventsPanel").then((m) => ({ default: m.EventsPanel })));
const FnoScreenerTab = lazy(() =>
  import("./FnoScreenerTab").then((m) => ({ default: m.FnoScreenerTab })),
);
const MarketTab = lazy(() =>
  import("../../pages/market/MarketScreenerPage").then((m) => ({ default: m.MarketScreenerPage })),
);
import {
  setSymbols,
  setTimeframe,
  setPeriod,
  setPeriodUnit,
  fetchCorrelationData,
} from "../../state/correlation";
import type { Stock } from "../../types";

let marketTabPrefetch: Promise<unknown> | null = null;
/**
 * Warm the Market chunk. Hover/focus/idle all share one promise, so the
 * chunk is requested at most once and never eagerly on mount.
 */
function prefetchMarketTab() {
  if (!marketTabPrefetch) {
    marketTabPrefetch = import("../../pages/market/MarketScreenerPage").catch(() => {
      // Failed chunk loads must not wedge future prefetch attempts.
      marketTabPrefetch = null;
    });
  }
  return marketTabPrefetch;
}

interface ScreenerPageProps {
  screenerOptions: Array<{ id: string; label: string; description?: string }>;
  activeScreener: string;
  onScreenerChange: (id: string) => void;
  onConfigScreenerSelect: (id: string) => void;
  title: string;
  status: string;
  isLoading: boolean;
  autoRefreshSeconds: number;
  provider: string;
  mode: string;
  onRefresh: () => void;
  onAutoRefreshChange: (value: number) => void;
  onProviderChange: (value: string) => void;
  onModeChange: (value: string) => void;
  approachingStocks: Stock[];
  touchedStocks: Stock[];
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
  error?: string | null;
  warning?: string | null;
  /** Market universe for the Dashboard tab. Uncontrolled default is "nifty500". */
  universe?: string;
  onUniverseChange?: (universe: string) => void;
}

/** Market universes offered by the Dashboard toolbar selector. */
export const DASHBOARD_UNIVERSES = [
  { value: "nifty50", label: "Nifty 50" },
  { value: "nifty500", label: "Nifty 500" },
  { value: "NSE_EQ", label: "All NSE" },
] as const;

export const DEFAULT_DASHBOARD_UNIVERSE = "nifty500";

/**
 * Map a Dashboard panel id to the closest existing screener profile id.
 * Returns null when there is no close profile — the caller then just opens
 * the Screener tab with the current profile.
 */
export function mapDashboardPanelToScreener(
  panelId: string,
  screenerIds: string[],
): string | null {
  const has = (id: string) => screenerIds.includes(id);
  switch (panelId) {
    case "near_52w":
    case "near_52w_high":
    case "near_52w_high_low":
      if (has("near_52w_breakout")) return "near_52w_breakout";
      if (has("52w_high")) return "52w_high";
      return null;
    case "near_52w_low":
      if (has("52w_high")) return "52w_high";
      if (has("near_52w_breakout")) return "near_52w_breakout";
      return null;
    case "gainers_losers":
    case "losers":
      return null;
    case "new_highs":
    case "touched_52w":
      if (has("touched_52w_high")) return "touched_52w_high";
      if (has("52w_high")) return "52w_high";
      return null;
    case "gap":
    case "gap_up":
    case "gap_down":
      if (has("market_open_gap")) return "market_open_gap";
      return null;
    default:
      // gainers / losers / most_active / turnover / volume_surge /
      // range_expansion and anything unknown → Screener tab as-is.
      return null;
  }
}

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ?? null;
}

function CompactAlerts(props: {
  activeScreener: string;
  warning?: string | null;
}) {
  const lines = () => {
    const out: string[] = [];
    if (props.activeScreener === "52w_high") {
      out.push("52W from Upstox daily; LTP live when broker connected.");
    }
    if (props.warning) {
      out.push(props.warning);
    }
    return out;
  };

  return (
    <Show when={lines().length > 0}>
      <Box
        px={2}
        py={1}
        className="flex-shrink-0"
        data-testid="screener-52w-high-banner"
      >
        <For each={lines()}>
          {(line) => (
            <Text size="11px" c="dimmed" lineClamp={2}>
              {line}
            </Text>
          )}
        </For>
      </Box>
    </Show>
  );
}

export function ScreenerPage(props: ScreenerPageProps) {
  const [viewMode, setViewMode] = createSignal<"table" | "heatmap">("table");
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = createMemo(() => firstParam(searchParams.tab) || "dashboard");
  const isValueTab = () => activeTab() === "deepvalue";
  const isEventsTab = () => activeTab() === "events";
  const isMarketTab = () => activeTab() === "market";
  const isFnoTab = () => activeTab() === "fno";
  const [internalUniverse, setInternalUniverse] = createSignal(DEFAULT_DASHBOARD_UNIVERSE);
  const [dashboardRefreshKey, setDashboardRefreshKey] = createSignal(0);
  const [showLastClose, setShowLastClose] = createSignal(false);
  const universe = () => props.universe ?? internalUniverse();

  // Mount the expensive dashboard/screener panels on first visit, then keep
  // them alive. Landing on ?tab=market must not pay the dashboard fetch or
  // the screener table's module/render cost.
  const [visitedTabs, setVisitedTabs] = createSignal<ReadonlySet<string>>(
    new Set([activeTab()]),
  );
  createEffect(() => {
    const tab = activeTab();
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  });
  const visited = createMemo(() => new Set(visitedTabs()).add(activeTab()));

  // Warm the Market chunk once the browser is idle after mount; hover/focus
  // on the tab does the same sooner. Never blocks the initial load.
  onMount(() => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(prefetchMarketTab, { timeout: 2500 });
      onCleanup(() => w.cancelIdleCallback?.(id));
      return;
    }
    const id = window.setTimeout(prefetchMarketTab, 1500);
    onCleanup(() => window.clearTimeout(id));
  });

  const handleUniverseChange = (u: string) => {
    if (props.onUniverseChange) {
      props.onUniverseChange(u);
    } else {
      setInternalUniverse(u);
    }
  };

  const setActiveTab = (tab: string) => {
    if (tab === "dashboard") {
      setSearchParams({ tab: null }, { replace: true });
    } else {
      setSearchParams({ tab }, { replace: true });
    }
  };

  const handleOpenScan = (panelId: string) => {
    const target = mapDashboardPanelToScreener(
      panelId,
      props.screenerOptions.map((o) => o.id),
    );
    if (target && target !== props.activeScreener) {
      props.onScreenerChange(target);
    }
    setActiveTab("screener");
  };

  const handleCompare = () => {
    const syms = state.selectedSymbols;
    if (syms.length < 2) return;
    setSymbols(syms);
    setTimeframe("daily");
    setPeriod(90);
    setPeriodUnit("days");
    fetchCorrelationData();
    state.clearSelectedSymbols();
    setSearchParams(
      { tab: "correlation", symbols: syms.join(","), timeframe: "daily", period: "90" },
      { replace: true },
    );
  };

  const hasSideFilters = () => screenerHasSideFilters(props.activeScreener);
  const hasResults = () => props.approachingStocks.length + props.touchedStocks.length > 0;
  const isDashboard = () => activeTab() === "dashboard";

  return (
    <Box gap={1} className="w-full min-h-0 flex flex-col">
      <Stack spacing={0} id="screener-main" data-testid="screener-page" gap={1} className="min-h-0 w-full">
        {/* Unified 48px toolbar — POC Option A promoted to live */}
        <Paper
          radius={2}
          data-testid="screener-controls"
          className="flex items-center justify-between gap-4 px-3 h-[48px] min-h-[48px] max-h-[48px] flex-shrink-0 overflow-hidden flex-nowrap border border-fin-border"
        >
          <Box className="flex items-center gap-2 flex-shrink-0">
            <Show when={isDashboard()} fallback={
              <Show when={isValueTab()} fallback={
                <Show when={isEventsTab()} fallback={
                  <Show when={isMarketTab()} fallback={
                    <Show when={isFnoTab()} fallback={
                      <Select
                        value={props.activeScreener}
                        onChange={(v) => v && props.onScreenerChange(v)}
                        data={props.screenerOptions.map((o) => ({ value: o.id, label: o.label }))}
                        size="xs"
                        w={148}
                        data-testid="screener-select"
                        comboboxProps={{ withinPortal: true }}
                        aria-label="Screener"
                      />
                    }>
                      <Text
                        size="xs"
                        fw={600}
                        data-testid="fno-tab-label"
                        className="w-[148px] flex-shrink-0 hidden md:block"
                      >
                        F&O Momentum
                      </Text>
                    </Show>
                  }>
                    <Text size="xs" fw={600} data-testid="market-tab-label" className="w-[148px] flex-shrink-0">
                      Market
                    </Text>
                  </Show>
                }>
                  {/* Keeps the tab strip from jumping: the slot below it is a
                      148px Select on the other tabs. The word "Events" is already
                      the active tab two elements to the right, so this slot names
                      the surface instead of repeating it. */}
                  <Text size="xs" fw={600} data-testid="events-tab-label" className="w-[148px] flex-shrink-0">
                    Event calendar
                  </Text>
                </Show>
              }>
                <Text size="xs" fw={600} data-testid="deep-value-tab-label">
                  Deep Value
                </Text>
              </Show>
            }>
              <Select
                value={universe()}
                onChange={(v) => v && handleUniverseChange(v)}
                data={DASHBOARD_UNIVERSES.map((o) => ({ value: o.value, label: o.label }))}
                size="xs"
                w={148}
                data-testid="dashboard-universe-select"
                comboboxProps={{ withinPortal: true }}
                aria-label="Market universe"
              />
            </Show>
            <Tabs
              value={activeTab()}
              onChange={(v) => {
                if (v && v !== "screener") state.setSelectedSymbols([]);
                if (v) setActiveTab(v);
              }}
              className="flex-1 min-w-0 overflow-x-auto"
            >
              <Tabs.List className="min-h-[32px] flex items-center gap-1">
                <Tabs.Tab value="dashboard" leftSection={<IconLayoutDashboard size={14} />} data-testid="tab-dashboard" style={{ "min-height": 32 }}>
                  Dashboard
                </Tabs.Tab>
                <Tabs.Tab value="screener" leftSection={<IconTable size={14} />} data-testid="tab-screener" style={{ "min-height": 32 }}>
                  Screener
                </Tabs.Tab>
                <Tabs.Tab value="deepvalue" leftSection={<IconCoins size={14} />} data-testid="tab-deepvalue" style={{ "min-height": 32 }}>
                  Deep Value
                </Tabs.Tab>
                <Tabs.Tab value="fno" leftSection={<IconChartCandle size={14} />} data-testid="tab-fno" style={{ "min-height": 32 }}>
                  F&O
                </Tabs.Tab>
                <Tabs.Tab value="events" leftSection={<IconCalendarEvent size={14} />} data-testid="tab-events" style={{ "min-height": 32 }}>
                  Events
                </Tabs.Tab>
                <Tabs.Tab value="market" leftSection={<IconWorld size={14} />} data-testid="tab-market" style={{ "min-height": 32 }} onMouseEnter={prefetchMarketTab} onFocus={prefetchMarketTab}>
                  Market
                </Tabs.Tab>
                <Tabs.Tab value="correlation" leftSection={<IconChartDots size={14} />} data-testid="tab-correlation" style={{ "min-height": 32 }}>
                  Correlation
                </Tabs.Tab>
                <Tabs.Tab value="config" leftSection={<IconSettings size={14} />} data-testid="tab-config" style={{ "min-height": 32 }}>
                  Config
                </Tabs.Tab>
              </Tabs.List>
            </Tabs>
          </Box>
          <Box className="flex-1 px-2 flex justify-center overflow-hidden min-w-[80px]">
            <Show when={!isMarketTab()}>
              <Text size="xs" c="dimmed" truncate className="text-[11px]" title={props.status} data-testid="screener-status">
                {props.status}
              </Text>
            </Show>
          </Box>
          <Box className="flex-shrink-0 flex items-center flex-nowrap">
            <Show when={isDashboard()}>
              <Box className="flex items-center gap-2 flex-shrink-0">
                <Tooltip label={showLastClose() ? "Showing last close (visual)" : "Show last close"}>
                  <Switch
                    size="xs"
                    checked={showLastClose()}
                    onChange={(e) => setShowLastClose(e.currentTarget.checked)}
                    label="Last close"
                    data-testid="dashboard-last-close-toggle"
                    aria-label="Last close"
                  />
                </Tooltip>
                <Tooltip label="Refresh dashboard">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={() => setDashboardRefreshKey((k) => k + 1)}
                    data-testid="dashboard-refresh"
                    aria-label="Refresh dashboard"
                  >
                    <IconRefresh size={14} />
                  </ActionIcon>
                </Tooltip>
              </Box>
            </Show>
            <Show when={!isDashboard() && !isValueTab() && !isEventsTab() && !isMarketTab() && !isFnoTab()}>
              <ScreenerHeader
                status={props.status}
                isLoading={props.isLoading}
                autoRefreshSeconds={props.autoRefreshSeconds}
                provider={props.provider}
                mode={props.mode}
                onRefresh={props.onRefresh}
                onAutoRefreshChange={props.onAutoRefreshChange}
                onProviderChange={props.onProviderChange}
                onModeChange={props.onModeChange}
                viewMode={viewMode()}
                onViewModeChange={setViewMode}
                hideStatus
                disableControls={props.isLoading && !hasResults()}
              />
            </Show>
          </Box>
        </Paper>
        <Box
          id="screener-content"
          data-testid="screener-content"
          flex={1}
          className="min-h-0 flex overflow-hidden"
          style={{ display: "flex" }}
        >
          <div
            data-testid="dashboard-panel"
            class="min-w-0 min-h-0 overflow-auto"
            style={{ display: isDashboard() ? "flex" : "none", flex: 1 }}
          >
            <Show when={visited().has("dashboard")}>
              {/* Keyed on the refresh counter so the toolbar Refresh remounts the panel. */}
              <Show when={`r${dashboardRefreshKey()}`} keyed>
                {(_key) => (
                  <DashboardView
                    universe={universe()}
                    onOpenSymbol={props.onSymbolClick}
                    onOpenScan={handleOpenScan}
                  />
                )}
              </Show>
            </Show>
          </div>
          <div
            data-testid="screener-panel"
            class="min-w-0 min-h-0 flex-col gap-1"
            style={{ display: activeTab() === "screener" ? "flex" : "none", flex: 1 }}
          >
            <Show when={visited().has("screener")}>
              <GroupPerformancePanel />
              <Paper
                radius={2}
                flex={1}
                className="min-w-0 min-h-0 flex flex-col overflow-hidden border border-fin-border"
              >
                <CompactAlerts activeScreener={props.activeScreener} warning={props.warning} />
                <Show when={hasSideFilters()}>
                  <ScreenerInlineFilters activeScreener={props.activeScreener} embedded />
                </Show>
                <Box flex={1} className="min-h-0 overflow-hidden flex flex-col p-1 gap-1">
                  <Suspense fallback={<Box className="p-2"><Skeleton h={120} /><Skeleton h={200} className="mt-sm" /></Box>}>
                    <ScreenerContent
                      approachingStocks={props.approachingStocks}
                      touchedStocks={props.touchedStocks}
                      isLoading={props.isLoading}
                      error={props.error}
                      onRefresh={props.onRefresh}
                      onSymbolClick={props.onSymbolClick}
                      onSymbolHover={props.onSymbolHover}
                      activeScreener={props.activeScreener}
                      viewMode={viewMode()}
                    />
                  </Suspense>
                  <SelectionBar onCompare={handleCompare} />
                </Box>
              </Paper>
            </Show>
          </div>
          <div
            data-testid="deep-value-panel"
            class="min-w-0 min-h-0 overflow-auto"
            style={{ display: isValueTab() ? "flex" : "none", flex: 1 }}
          >
            <Suspense fallback={<Box className="p-2"><Skeleton h={120} /><Skeleton h={200} className="mt-sm" /></Box>}>
              <Show when={isValueTab()}>
                <DeepValueTab />
              </Show>
            </Suspense>
          </div>
          <div
            data-testid="events-tab-panel"
            class="min-w-0 min-h-0 overflow-auto"
            style={{ display: isEventsTab() ? "flex" : "none", flex: 1 }}
          >
            <Suspense fallback={<Box className="p-2"><Skeleton h={120} /><Skeleton h={200} className="mt-sm" /></Box>}>
              <Show when={isEventsTab()}>
                <EventsTab />
              </Show>
            </Suspense>
          </div>
          <div
            data-testid="fno-tab-panel"
            class="min-w-0 min-h-0 overflow-hidden"
            style={{ display: isFnoTab() ? "flex" : "none", flex: 1 }}
          >
            <Suspense fallback={<Box className="p-2"><Skeleton h={120} /><Skeleton h={200} className="mt-sm" /></Box>}>
              <ErrorBoundary label="Market screener">
                <Show when={isFnoTab()}>
                  <FnoScreenerTab />
                </Show>
              </ErrorBoundary>
            </Suspense>
          </div>
          <div
            data-testid="market-tab-panel"
            class="min-w-0 min-h-0 overflow-hidden"
            style={{ display: isMarketTab() ? "flex" : "none", flex: 1 }}
          >
            <Suspense fallback={<Box className="p-2"><Skeleton h={120} /><Skeleton h={200} className="mt-sm" /></Box>}>
              <ErrorBoundary label="Market screener">
                <Show when={isMarketTab()}>
                  <MarketTab />
                </Show>
              </ErrorBoundary>
            </Suspense>
          </div>
          <div
            data-testid="correlation-config-panel"
            class="min-w-0 min-h-0 overflow-auto"
            style={{ display: activeTab() === "correlation" || activeTab() === "config" ? "flex" : "none", flex: 1 }}
          >
            <Suspense fallback={<Box className="p-2"><Skeleton h={120} /><Skeleton h={200} className="mt-sm" /></Box>}>
              <Show when={activeTab() === "config"} fallback={
                <Show when={activeTab() === "correlation"}>
                  <CorrelationTab />
                </Show>
              }>
                <ScreenerConfigView
                  screenerOptions={props.screenerOptions}
                  activeScreener={props.activeScreener}
                  onScreenerChange={props.onConfigScreenerSelect}
                />
              </Show>
            </Suspense>
          </div>
        </Box>
      </Stack>
    </Box>
  );
}
