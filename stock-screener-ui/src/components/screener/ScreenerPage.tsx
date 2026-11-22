import { Match, Show, Suspense, Switch, createEffect, createMemo, createSignal, lazy, onCleanup, onMount } from "solid-js";
import { useParams, useNavigate, useSearchParams } from "@solidjs/router";
import { Box, Stack, Paper, Tabs, Text, Select, Skeleton } from "@/ui";
import { IconTable, IconChartDots, IconSettings, IconChartCandle, IconWorld } from "./icons";
import * as state from "../../state";
import { ScreenerHeader } from "./ScreenerHeader";
// ScreenerContent pulls the table + its whole module tree — heavy module
// evaluation on the critical path of every landing. Load it on first render of
// the Screener tab, not at page boot.
const ScreenerContent = lazy(() =>
  import("./ScreenerContent").then((m) => ({ default: m.ScreenerContent })),
);
// The sector-group strip is the heaviest panel on this route and only the
// Screener tab needs it. Lazy-loading keeps its module (and its exclusive deps)
// out of the shell chunk, so every other tab — and the first paint of the shell
// itself — never pays for it.
const GroupPerformancePanel = lazy(() =>
  import("./GroupPerformancePanel").then((m) => ({ default: m.GroupPerformancePanel })),
);
import { SelectionBar } from "./SelectionBar";
import { ScreenerInlineFilters } from "./ScreenerInlineFilters";
import { ErrorBoundary } from "../common/ErrorBoundary";
import { MARKET_VIEW_OPTIONS, normalizeMarketView } from "../market/MarketMapView";

const CorrelationTab = lazy(() => import("./CorrelationTab").then((m) => ({ default: m.CorrelationTab })));
const ScreenerConfigView = lazy(() => import("./ScreenerConfigView").then((m) => ({ default: m.ScreenerConfigView })));
const FnoScreenerTab = lazy(() =>
  import("./FnoScreenerTab").then((m) => ({ default: m.FnoScreenerTab })),
);
/** Market view ids addressable as `?view=`, derived from the canonical registry. */
export const MARKET_VIEW_IDS = MARKET_VIEW_OPTIONS.map((o) => o.value);

// The Market panel owns the prop contract (`MarketScreenerPanelProps`), and the
// route is a thin pass-through to it, so the lazy import is typed directly
// rather than re-declared here — a second copy could silently drift.
const MarketTab = lazy(() =>
  import("../../pages/market/MarketScreenerPage").then((m) => ({ default: m.MarketScreenerPage })),
);
import {
  setSymbols,
  setTimeframe,
  setPeriod,
  setPeriodUnit,
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
  /** Market universe for the Dashboard view. Uncontrolled default is "nifty500". */
  universe?: string;
  onUniverseChange?: (universe: string) => void;
}

/** Market universes offered by the Dashboard view's universe selector. */
export const DASHBOARD_UNIVERSES = [
  { value: "nifty50", label: "Nifty 50" },
  { value: "nifty500", label: "Nifty 500" },
  { value: "NSE_EQ", label: "All NSE" },
] as const;

export const DEFAULT_DASHBOARD_UNIVERSE = "nifty500";

/** Shared fallback for every lazy tab: same skeleton, one per boundary. */
function PanelFallback() {
  return <Box className="p-2"><Skeleton h={120} /><Skeleton h={200} className="mt-sm" /></Box>;
}

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ?? null;
}

/**
 * Query params a single tab owns. `navigate` rebuilds the query from scratch, so
 * leaving a tab has to drop its params explicitly — otherwise the next URL keeps
 * params that only mean something on the tab you just left.
 */
const TAB_OWNED_PARAMS: Readonly<Record<string, readonly string[]>> = {
  correlation: ["symbols", "timeframe", "period"],
  market: ["view"],
};

/** Tabs addressable as `/screener/<tab>`. `dashboard` is the folded legacy tab. */
const KNOWN_TABS = new Set([
  "screener",
  "fno",
  "market",
  "correlation",
  "config",
  "dashboard",
]);

/** Market is the default tab, so it stays addressable as bare `/screener`. */
function tabPath(tab: string): string {
  return tab === "market" ? "/screener" : `/screener/${tab}`;
}

/** Legacy query URLs always carry the tab segment, including the default one. */
function legacyTabPath(tab: string): string {
  return `/screener/${tab}`;
}

/**
 * One strip height for every tab. The band owns the single bottom rule, so the
 * kit's own list rule is zeroed — two rules 1px apart read as a fat, fuzzy line.
 */
const TAB_STRIP_STYLE = { "min-height": "26px" } as const;

/** One-line notices for the context band. Never their own row. */
function useAlertNotes(props: { activeScreener: string; warning?: string | null }) {
  return createMemo(() => {
    const out: string[] = [];
    if (props.activeScreener === "52w_high") {
      out.push("52W from Upstox daily; LTP live when broker connected.");
    }
    if (props.warning) {
      out.push(props.warning);
    }
    return out;
  });
}

export function ScreenerPage(props: ScreenerPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  const pathTab = () => {
    const raw = params.tab;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value && KNOWN_TABS.has(value) ? value : null;
  };
  /** Pre-path URLs (`/screener?tab=…`) still resolve; an effect moves them to the path form. */
  const legacyTab = () => {
    const raw = firstParam(searchParams.tab);
    return raw && KNOWN_TABS.has(raw) ? raw : null;
  };
  const activeTab = createMemo(() => pathTab() ?? legacyTab() ?? "market");
  const marketView = () => normalizeMarketView(firstParam(searchParams.view));
  const isMarketTab = () => activeTab() === "market";
  const isFnoTab = () => activeTab() === "fno";

  const ownedByAnotherTab = (tab: string, key: string) =>
    Object.entries(TAB_OWNED_PARAMS).some(([owner, keys]) => owner !== tab && keys.includes(key));

  /**
   * Query for `tab`: drops the legacy `tab` param and every param owned by the
   * tab being left, keeps the rest (e.g. the `screener` profile).
   */
  const searchForTab = (tab: string): string => {
    const query = new URLSearchParams();
    for (const [key, raw] of Object.entries(searchParams)) {
      if (raw == null) continue;
      const value = Array.isArray(raw) ? raw.join(",") : raw;
      if (value === "" || key === "tab" || ownedByAnotherTab(tab, key)) continue;
      // The view is owned by the Market tab; canonicalise it so a legacy
      // `?view=map` link is never echoed back with the retired id.
      query.append(key, key === "view" ? normalizeMarketView(value) : value);
    }
    return query.toString();
  };

  /**
   * One navigation per tab change. The path carries the tab; the query is
   * rebuilt so a param written by the tab being left never survives, and the
   * navigation is pushed so Back walks the tabs.
   */
  const navigateToTab = (
    path: string,
    searchFor: string,
    extra?: Record<string, string>,
    options?: { replace?: boolean },
  ) => {
    const query = new URLSearchParams(searchFor);
    for (const [key, value] of Object.entries(extra ?? {})) query.set(key, value);
    const search = query.toString();
    navigate(`${path}${search ? `?${search}` : ""}`, options);
  };

  // Old `?tab=` links converge on the path form; `replace` keeps them out of history.
  createEffect(() => {
    const legacy = legacyTab();
    if (!legacy || legacy === "dashboard") return;
    navigateToTab(legacyTabPath(legacy), searchForTab(legacy), undefined, { replace: true });
  });

  // The Dashboard tab folded into Market as its `movers` view. It is reachable
  // both as `?tab=dashboard` and as the path segment `/screener/dashboard`.
  createEffect(() => {
    if (activeTab() !== "dashboard") return;
    navigateToTab(legacyTabPath("market"), searchForTab("market"), { view: "movers" }, { replace: true });
  });

  // Deep Value folded into Market as its `value` view. Its id is retired from
  // KNOWN_TABS, so the raw param/segment is read instead of `activeTab()`.
  createEffect(() => {
    if (firstParam(searchParams.tab) !== "deepvalue" && firstParam(params.tab) !== "deepvalue") return;
    navigateToTab(legacyTabPath("market"), searchForTab("market"), { view: "value" }, { replace: true });
  });

  // Warm the Market chunk once the browser is idle after mount; hover/focus
  // on the tab does the same sooner. Never blocks the initial load.
  onMount(() => {
    const w = window;
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(prefetchMarketTab, { timeout: 2500 });
      onCleanup(() => w.cancelIdleCallback?.(id));
      return;
    }
    const id = window.setTimeout(prefetchMarketTab, 1500);
    onCleanup(() => window.clearTimeout(id));
  });

  // Profile options for the toolbar Select. Memoised so the array identity is
  // stable across renders — an inline `.map` in JSX handed the select a new
  // `data` array on every store tick.
  const screenerSelectData = createMemo(() =>
    props.screenerOptions.map((o) => ({ value: o.id, label: o.label })),
  );

  // Symbols captured from a Dashboard "Open scan": the Market table narrows
  // to exactly these names. Cleared when the user leaves the Market tab.
  const [marketSymbols, setMarketSymbols] = createSignal<string[]>([]);

  const setActiveTab = (tab: string) => {
    if (tab === activeTab()) return;
    if (tab !== "market") setMarketSymbols([]);
    navigateToTab(tabPath(tab), searchForTab(tab));
  };

  const handleOpenScan = (panelId: string, symbols: string[]) => {
    setMarketSymbols(symbols);
    navigateToTab(tabPath("market"), searchForTab("market"), { view: "table" }, { replace: true });
  };

  const handleCompare = () => {
    const syms = state.selectedSymbols;
    if (syms.length < 2) return;
    setSymbols(syms);
    setTimeframe("daily");
    setPeriod(90);
    setPeriodUnit("days");
    // The tab fetches on mount from the params written below; fetching here too
    // would race it and could let the older response publish last.
    state.clearSelectedSymbols();
    navigateToTab(tabPath("correlation"), searchForTab("correlation"), {
      symbols: syms.join(","),
      timeframe: "daily",
      period: "90",
    });
  };

  const alertNotes = useAlertNotes(props);
  const hasResults = () => props.approachingStocks.length + props.touchedStocks.length > 0;

  // Market is both the default tab and the transient state while a legacy
  // `?tab=dashboard` URL converges on the path form, so one component serves
  // the explicit Match and the Switch fallback.
  const MarketPanel = () => (
    <div
      data-testid="market-tab-panel"
      class="min-w-0 min-h-0 overflow-hidden"
      style={{ display: "flex", flex: 1 }}
    >
      <Suspense fallback={<PanelFallback />}>
        <ErrorBoundary label="Market screener">
          <MarketTab
            initialView={marketView()}
            onViewChange={(v) => {
              const view = normalizeMarketView(v);
              setSearchParams({ view: view === "table" ? null : view }, { replace: true });
            }}
            onOpenScan={handleOpenScan}
            symbolAllowlist={marketSymbols()}
            onClearSymbolAllowlist={() => setMarketSymbols([])}
          />
        </ErrorBoundary>
      </Suspense>
    </div>
  );

  return (
    <Box className="w-full min-h-0 flex flex-col p-4">
      <Stack id="screener-main" data-testid="screener-page" gap={12} className="min-h-0 w-full">
        <Paper
          radius={0}
          data-testid="screener-controls"
          className="flex items-center gap-2 h-[28px] min-h-[28px] max-h-[28px] flex-shrink-0 overflow-hidden flex-nowrap border-b border-fin-border"
        >
          <Box className="flex items-center gap-2 min-w-0 flex-1">
            <Show when={isMarketTab()} fallback={
              <Show when={isFnoTab()} fallback={
                <Select
                  value={props.activeScreener}
                  onChange={(v) => v && props.onScreenerChange(v)}
                  data={screenerSelectData()}
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
                  F&O Momentum (India)
                </Text>
              </Show>
            }>
              <Text size="xs" fw={600} data-testid="market-tab-label" className="w-[148px] flex-shrink-0">
                Market
              </Text>
            </Show>
            <Tabs
              value={activeTab()}
              onChange={(v) => {
                if (v && v !== "screener") state.setSelectedSymbols([]);
                if (v) setActiveTab(v);
              }}
              className="flex-1 min-w-0 overflow-x-auto"
            >
              <Tabs.List
                data-testid="screener-tab-list"
                className="flex-1 min-w-0"
                style={{ "border-bottom-width": "0px", "min-height": "26px" }}
              >
                <Tabs.Tab value="screener" leftSection={<IconTable size={14} />} data-testid="tab-screener" style={TAB_STRIP_STYLE}>
                  Screener
                </Tabs.Tab>
                <Tabs.Tab value="fno" leftSection={<IconChartCandle size={14} />} data-testid="tab-fno" style={TAB_STRIP_STYLE}>
                  F&O (India)
                </Tabs.Tab>
                {/* `onFocus` is not on `UITabProps` (shared type) but `Tab`
                    forwards unknown props to the DOM, so the focus path still
                    warms the chunk instead of silently disappearing. */}
                <Tabs.Tab
                  value="market"
                  leftSection={<IconWorld size={14} />}
                  data-testid="tab-market"
                  style={TAB_STRIP_STYLE}
                  onMouseEnter={() => void prefetchMarketTab()}
                  {...({ onFocus: () => void prefetchMarketTab() } as Record<string, unknown>)}
                >
                  Market
                </Tabs.Tab>
                <Tabs.Tab value="correlation" leftSection={<IconChartDots size={14} />} data-testid="tab-correlation" style={TAB_STRIP_STYLE}>
                  Correlation
                </Tabs.Tab>
                <Tabs.Tab value="config" leftSection={<IconSettings size={14} />} data-testid="tab-config" style={TAB_STRIP_STYLE}>
                  Config
                </Tabs.Tab>
              </Tabs.List>
            </Tabs>
          </Box>
          <Box className="flex-shrink-0 flex items-center flex-nowrap ml-auto">
            <Show when={!isMarketTab() && !isFnoTab()}>
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
          <Switch fallback={<MarketPanel />}>
            <Match when={activeTab() === "screener"}>
              <div
                data-testid="screener-panel"
                class="min-w-0 min-h-0 flex-row gap-1"
                style={{ display: "flex", flex: 1 }}
              >
                <Suspense fallback={<Box className="p-1"><Skeleton h={24} /></Box>}>
                  <GroupPerformancePanel />
                </Suspense>
                <Paper
                  radius={2}
                  flex={1}
                  p={0}
                  className="min-w-0 min-h-0 flex flex-col overflow-hidden bg-fin-surface"
                >
                  {/* Always-mounted 24px band: status, warning notes and the first
                      filter all live here, so none of them can shift the table. */}
                  <ScreenerInlineFilters
                    activeScreener={props.activeScreener}
                    status={props.status}
                    notes={alertNotes()}
                    embedded
                  />
                  <Box flex={1} className="min-h-0 overflow-hidden flex flex-col gap-1">
                    <Suspense fallback={<PanelFallback />}>
                      <ScreenerContent
                        approachingStocks={props.approachingStocks}
                        touchedStocks={props.touchedStocks}
                        isLoading={props.isLoading}
                        error={props.error}
                        onRefresh={props.onRefresh}
                        onSymbolClick={props.onSymbolClick}
                        onSymbolHover={props.onSymbolHover}
                        activeScreener={props.activeScreener}
                      />
                    </Suspense>
                    <SelectionBar onCompare={handleCompare} />
                  </Box>
                </Paper>
              </div>
            </Match>
            <Match when={isFnoTab()}>
              <div
                data-testid="fno-tab-panel"
                class="min-w-0 min-h-0 overflow-hidden"
                style={{ display: "flex", flex: 1 }}
              >
                <Suspense fallback={<PanelFallback />}>
                  <ErrorBoundary label="Market screener">
                    <FnoScreenerTab />
                  </ErrorBoundary>
                </Suspense>
              </div>
            </Match>
            <Match when={isMarketTab()}>
              <MarketPanel />
            </Match>
            <Match when={activeTab() === "correlation"}>
              <div
                data-testid="correlation-config-panel"
                class="min-w-0 min-h-0 overflow-auto"
                style={{ display: "flex", flex: 1 }}
              >
                <Suspense fallback={<PanelFallback />}>
                  <CorrelationTab />
                </Suspense>
              </div>
            </Match>
            <Match when={activeTab() === "config"}>
              <div
                data-testid="correlation-config-panel"
                class="min-w-0 min-h-0 overflow-auto"
                style={{ display: "flex", flex: 1 }}
              >
                <Suspense fallback={<PanelFallback />}>
                  <ScreenerConfigView
                    screenerOptions={props.screenerOptions}
                    activeScreener={props.activeScreener}
                    onScreenerChange={props.onConfigScreenerSelect}
                  />
                </Suspense>
              </div>
            </Match>
          </Switch>
        </Box>
      </Stack>
    </Box>
  );
}
