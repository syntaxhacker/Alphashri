import {
  Show,
  For,
  Suspense,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  onMount,
  type Accessor,
  type JSX,
  type Setter,
} from "solid-js";
import { ActionIcon, Box, CopyButton, Group, Text, Button, Stack, Loader, ScrollArea, ToolbarRow } from "@/ui";
import { IconCheck, IconCopy } from "../common/Icons";
import {
  IconRefresh,
  IconBellRinging,
  IconTrendingUp,
  IconClock,
} from "../screener/icons";
import { SectorTable } from "./SectorTable";
import { IntervalMoversTable } from "./IntervalMoversTable";
import { SectorCorrelationTab } from "./SectorCorrelationTab";
import { RotationTab } from "./RotationTab";
import { fetchSectorPerformance } from "../../api/sector";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { fetchHeatmapData } from "../../api/heatmap";
import type { HeatmapStock } from "../../api/heatmap";
import { subscribeToHolidays, isMarketOpenNow } from "../../state/holidays";
import type { SectorResponse, SectorItem, StockMover } from "../../types/sector";
import { CompactPanel } from "../common/compact";
import { formatSectorPercentage as formatPercentage, clickOnSpace } from "./sectorUtils";
import { displaySymbol } from "@/config/tvSymbols";
import { chartHrefForSymbol } from "../common/symbolDockContext";
import { detectSectorAlerts, detectIntervalMovers } from "./SectorHelpers";
import type { SectorAlert, InternalStockMover } from "./SectorHelpers";
import { SectorHeatmapView } from "./SectorHeatmapView";
import { SectorHeatmapControls } from "./SectorHeatmapContext";
import { CompactToggle } from "./CompactToggle";
import { SectorAlertsList } from "./SectorAlertsList";
import { SymbolLink } from "../common/SymbolLink";
import { useSymbolDock } from "../common/symbolDockContext";
import type { ViewMode } from "./SectorHeatmapView";
import {
  SECTOR_SECTIONS,
  SectorSectionNav,
  isSectorSectionId,
  type SectorSectionId,
} from "./SectorSectionNav";

// History pulls in the chart/lab chunk only when its section approaches.
const SectorHistoryTab = lazy(() =>
  import("./history/SectorHistoryTab").then((module) => ({ default: module.SectorHistoryTab })),
);

type DashboardView = "table" | "visual";

const LEGACY_TAB_SECTION: Record<string, SectorSectionId> = {
  dashboard: "overview",
  correlation: "correlation",
  rotation: "rotation",
  history: "history",
};

const SECTION_LABEL: Record<SectorSectionId, string> = {
  overview: "Overview",
  rotation: "Rotation",
  correlation: "Correlation",
  history: "History",
};

/** One migration point for old `?tab=` links and unknown hashes. */
function normalizeSectionUrl(): SectorSectionId {
  if (typeof window === "undefined") return "overview";
  const url = new URL(window.location.href);
  const legacyTab = url.searchParams.get("tab");
  let section: SectorSectionId | null = null;
  if (legacyTab !== null) {
    section = LEGACY_TAB_SECTION[legacyTab] ?? "overview";
    url.searchParams.delete("tab");
  } else {
    const hash = url.hash.replace(/^#/, "");
    section = isSectorSectionId(hash) ? hash : null;
  }
  if (!section) section = "overview";
  url.hash = section;
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return section;
}

function sectionFromHash(): SectorSectionId {
  if (typeof window === "undefined") return "overview";
  const hash = window.location.hash.replace(/^#/, "");
  return isSectorSectionId(hash) ? hash : "overview";
}

function readDashboardView(): DashboardView {
  if (typeof window === "undefined") return "visual";
  // Only an explicit table link opts out of the visual-first overview.
  return new URLSearchParams(window.location.search).get("dash") === "table" ? "table" : "visual";
}

function writeDashboardView(view: DashboardView): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (view === "table") url.searchParams.set("dash", "table");
  else url.searchParams.delete("dash");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function SectorAlertsCard(props: {
  alerts: SectorAlert[];
  sectors: SectorItem[];
  onSymbolClick: (symbol: string) => void;
}) {
  const sectorSymbol = (sector: string): string | null => {
    const top = props.sectors.find((item) => item.sector === sector)?.top_movers ?? "";
    const withChange = top.match(/([A-Za-z0-9&._-]+)\(/);
    return withChange?.[1] ?? (top.split(",")[0]?.trim() || null);
  };

  return (
    <CompactPanel
      id="sector-alerts-card"
      data-testid="sector-alerts-card"
      className="flex min-w-0 flex-col"
      title={
        <Box className="flex items-center justify-between gap-2">
          <Text fw={600} className="text-ui-micro">Real-time Alerts</Text>
          <IconBellRinging size={14} color="var(--color-fin-warning)" />
        </Box>
      }
    >
      <ScrollArea className="max-h-[200px] min-h-0 overflow-auto">
        <SectorAlertsList
          alerts={props.alerts}
          onSectorClick={(sector) => {
            const symbol = sectorSymbol(sector);
            if (symbol) props.onSymbolClick(symbol);
          }}
        />
      </ScrollArea>
    </CompactPanel>
  );
}

function IntervalMoversCard(props: {
  intervalMovers: InternalStockMover[];
  market: "india" | "america";
  onSymbolClick: (symbol: string) => void;
}) {
  return (
    <CompactPanel
      id="sector-interval-movers-card"
      data-testid="sector-interval-movers-card"
      className="flex min-w-0 flex-col"
      title={
        <Box className="flex items-center justify-between gap-2">
          <Text fw={600} className="text-ui-micro">Interval Movers</Text>
          <IconTrendingUp size={14} color="var(--color-fin-primary)" />
        </Box>
      }
    >
      <ScrollArea className="max-h-[240px] min-h-0 overflow-auto">
        <IntervalMoversTable
          movers={props.intervalMovers}
          market={props.market === "america" ? "usa" : "india"}
          onSymbolClick={props.onSymbolClick}
        />
      </ScrollArea>
    </CompactPanel>
  );
}

function TopStocksCard(props: {
  topStocks: StockMover[];
  market: "india" | "america";
  onSymbolClick: (symbol: string) => void;
}) {
  return (
    <CompactPanel
      id="sector-top-stocks-card"
      data-testid="sector-top-stocks-card"
      className="flex min-w-0 flex-col"
      title={
        <Box className="flex items-center justify-between gap-2">
          <Text fw={600} className="text-ui-micro">Top Gainers</Text>
          <IconTrendingUp size={14} color="var(--color-fin-positive)" />
        </Box>
      }
    >
      <ScrollArea className="max-h-[240px] min-h-0 overflow-auto">
        <Show when={props.topStocks.length > 0} fallback={
          <Box
            data-testid="sector-top-stocks-empty"
            role="status"
            className="flex items-center justify-center p-2"
          >
            <Text size="xs" c="dimmed">No top movers in this snapshot.</Text>
          </Box>
        }>
          <Stack spacing={0.25}>
            <For each={props.topStocks.slice(0, 10)}>
              {(stock) => (
                <Box
                  className="flex min-w-0 items-center gap-1.5 px-1 py-[2px]"
                >
                  {needsCanonicalLink(stock.symbol) ? (
                    <Box className="flex min-w-0 items-center gap-[2px]">
                      <Box
                        component="a"
                        href={chartHrefForSymbol(
                          stock.symbol,
                          props.market === "america" ? "usa" : undefined,
                        )}
                        data-testid={`sector-top-stock-${stock.symbol}`}
                        onKeyDown={clickOnSpace}
                        className="min-w-0 text-fin-text no-underline hover:text-fin-primary"
                      >
                        <Text truncate className="text-ui-micro font-semibold">
                          {displaySymbol(stock.symbol)}
                        </Text>
                      </Box>
                      <CopyButton value={displaySymbol(stock.symbol)}>
                        {({ copied, copy }) => (
                          <ActionIcon
                            variant="subtle"
                            color={copied ? "info" : "secondary"}
                            size="xs"
                            style={{ width: "16px", height: "16px", "min-height": "16px", padding: "0px" }}
                            onClick={(event: MouseEvent) => {
                              event.stopPropagation();
                              copy();
                            }}
                            aria-label={`Copy ${displaySymbol(stock.symbol)}`}
                            data-testid={`copy-symbol-${displaySymbol(stock.symbol)}`}
                          >
                            {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                          </ActionIcon>
                        )}
                      </CopyButton>
                    </Box>
                  ) : (
                    <SymbolLink
                      symbol={stock.symbol}
                      inAppText
                      tvLink={false}
                      showChart={false}
                      showOptions={false}
                      showCopy
                      size="xs"
                      weight={600}
                      testId={`sector-top-stock-${stock.symbol}`}
                      onTextClick={(sym) => props.onSymbolClick(sym)}
                      className="min-w-0"
                    />
                  )}
                  <Box className="flex-1" />
                  <Text c={stock.change >= 0 ? "success" : "error"} className="text-ui-micro tabular-nums font-mono">
                    {formatPercentage(stock.change)}
                  </Text>
                </Box>
              )}
            </For>
          </Stack>
        </Show>
      </ScrollArea>
    </CompactPanel>
  );
}

// Decorated feed symbols (NSE:RELIANCE, BRK.B) need a canonical chart href;
// plain tickers render through the shared dock button.
function needsCanonicalLink(symbol: string): boolean {
  const raw = String(symbol ?? "").trim();
  return displaySymbol(raw) !== raw || raw.includes(".");
}

/** Table mode keeps the three cards in one rail; visual mode splits them below the heatmap. */
function AlertsAndMovers(props: {
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
  topStocks: StockMover[];
  sectors: SectorItem[];
  market: "india" | "america";
  onSymbolClick: (symbol: string) => void;
}) {
  return (
    <Stack
      spacing={0.5}
      className="flex w-full min-w-0 items-stretch"
    >
      <SectorAlertsCard
        alerts={props.alerts}
        sectors={props.sectors}
        onSymbolClick={props.onSymbolClick}
      />
      <IntervalMoversCard
        intervalMovers={props.intervalMovers}
        market={props.market}
        onSymbolClick={props.onSymbolClick}
      />
      <TopStocksCard
        topStocks={props.topStocks}
        market={props.market}
        onSymbolClick={props.onSymbolClick}
      />
    </Stack>
  );
}

function LoadingPanel() {
  return (
    <Box
      data-testid="sector-overview-loading"
      role="status"
      aria-label="Loading sector performance"
    >
      <CompactPanel
        title={
          <Group gap="xs" wrap="nowrap" align="center">
            <Loader size="sm" />
            <Text fw={600} size="sm">
              Fetching sector performance
            </Text>
          </Group>
        }
        description="Loading live sector breadth and movers."
        className="flex min-h-[140px] flex-col"
      />
    </Box>
  );
}

function ErrorPanel(props: { error: string; onRetry: () => void }) {
  return (
    <Box data-testid="sector-overview-error" role="alert">
      <CompactPanel
        title="Sector data unavailable"
        description={props.error}
        className="flex min-h-0 flex-col"
        action={
          <Button variant="filled" color="error" size="sm" onClick={props.onRetry}>
            Retry
          </Button>
        }
      />
    </Box>
  );
}

function EmptyPanel() {
  return (
    <Box data-testid="sector-overview-empty" role="status">
      <CompactPanel
        title="No sector data"
        description="No sector data available for this market. Try another market or refresh."
        className="flex min-h-0 flex-col"
      />
    </Box>
  );
}

function HistoryTabFallback() {
  return (
    <Box
      data-testid="sector-history-lazy-fallback"
      role="status"
      aria-label="Loading sector history"
      className="flex min-h-[160px] w-full items-center justify-center"
    >
      <Loader size="sm" />
    </Box>
  );
}

function SectionSkeleton(props: { id: SectorSectionId }) {
  return (
    <Box
      data-testid={props.id === "history" ? "sector-history-lazy-fallback" : `sector-section-${props.id}-skeleton`}
      role="status"
      aria-label={`Loading ${SECTION_LABEL[props.id]} section`}
      className="flex min-h-[160px] w-full items-center justify-center gap-2 p-2"
    >
      <Loader size="sm" />
      <Text c="dimmed" className="text-ui-micro">
        Loading {SECTION_LABEL[props.id]}…
      </Text>
    </Box>
  );
}

function SectionShell(props: {
  id: SectorSectionId;
  mounted: boolean;
  contentClass?: string;
  children: JSX.Element;
}) {
  const number = () =>
    String(SECTOR_SECTIONS.findIndex((section) => section.id === props.id) + 1).padStart(2, "0");

  return (
    <section
      id={props.id}
      data-testid={`sector-section-${props.id}`}
      data-section={props.id}
      tabIndex={-1}
      aria-label={SECTION_LABEL[props.id]}
      className="w-full min-w-0 shrink-0 border-t border-fin-border focus:outline-none"
      style={{ "scroll-margin-top": "48px" }}
    >
      <Box component="header" className="flex h-6 items-center gap-2 border-b border-fin-border px-2">
        <Text c="dimmed" className="text-ui-micro font-mono tabular-nums">
          {number()}
        </Text>
        <Text fw={700} className="text-ui-micro">
          {SECTION_LABEL[props.id]}
        </Text>
      </Box>
      <Show when={props.mounted} fallback={<SectionSkeleton id={props.id} />}>
        <Box className={props.contentClass ?? ""}>{props.children}</Box>
      </Show>
    </section>
  );
}

const SECTOR_TABLE_SCROLL_STEP = 80;

/** Arrow keys must move the same element that carries focus and `role=region`. */
function onSectorTableRegionKeyDown(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const region = event.currentTarget as HTMLElement;
  region.scrollLeft += event.key === "ArrowRight" ? SECTOR_TABLE_SCROLL_STEP : -SECTOR_TABLE_SCROLL_STEP;
  event.preventDefault();
}

function SectorPerformancePanel(props: {
  sectors: SectorItem[];
  market: "india" | "america";
  onSymbolClick: (symbol: string) => void;
}) {
  return (
    <Box
      className="flex flex-col overflow-hidden border border-fin-border rounded-[2px] min-w-0 min-h-[200px]"
    >
      <Box className="flex min-h-6 shrink-0 items-center justify-between gap-2 border-b border-fin-border px-2 py-0.5">
        <Text fw={600} className="text-ui-micro">Sector Performance</Text>
        <Text
          data-testid="sector-move-scale"
          title="MOVE bars map −3% to +3%; values outside the range are capped"
          c="dimmed"
          className="text-ui-micro font-mono tabular-nums whitespace-nowrap shrink-0"
        >
          MOVE −3% · 0 · +3%
        </Text>
        <Text
          data-testid="sector-table-scroll-cue"
          title="Scroll sideways to see every column"
          c="dimmed"
          className="text-ui-micro lg:hidden"
        >
          Scroll sideways →
        </Text>
      </Box>
      {/* The shared table owns a scrollport of its own. Switching it off here
          leaves this region as the single horizontal scroller, so keyboard
          focus and the scrolled element are the same node. Sticky columns (in
          SectorTable's own style) still pin against this region. */}
      <style data-testid="sector-table-scroll-style">{`
        [data-testid="sector-table-container"] .paper-tanstack-container,
        [data-testid="sector-table-container"] .paper-tanstack-scroll {
          overflow: visible !important;
        }
      `}</style>
      <Box
        id="sector-table-container"
        data-testid="sector-table-container"
        data-scroll="horizontal"
        role="region"
        aria-label="Sector performance table, scroll sideways for all columns"
        tabIndex={0}
        onKeyDown={onSectorTableRegionKeyDown}
        className="max-h-[520px] min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto overscroll-x-contain focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-text"
      >
        <SectorTable
          sectors={props.sectors}
          market={props.market === "america" ? "usa" : "india"}
          onSymbolClick={props.onSymbolClick}
        />
      </Box>
    </Box>
  );
}

interface SectorHeatmapPanelProps {
  data: SectorResponse;
  viewMode: ViewMode;
  stocks: HeatmapStock[];
  metric: string;
  stockSectorFilter: string | null;
  sectorOptions: { value: string; label: string }[];
  loading: boolean;
  error: string | null;
  onViewModeChange: (mode: ViewMode) => void;
  onMetricChange: (metric: string) => void;
  onSectorFilterChange: (sector: string | null) => void;
  onSymbolClick: (symbol: string) => void;
}

/**
 * A stock-layer request with no tiles is a message, not a 620px empty canvas.
 * `Show` swaps the whole shell so the sparse state can be genuinely short; a
 * reactive inline height object would have been captured once at mount.
 */
function SectorHeatmapPanel(props: SectorHeatmapPanelProps) {
  const sparseStockState = () =>
    props.viewMode === "stock" &&
    (props.loading || props.error != null || props.stocks.length === 0);
  return (
    <Show
      when={!sparseStockState()}
      fallback={<HeatmapPanelBody {...props} height="clamp(190px, 28vh, 260px)" />}
    >
      <HeatmapPanelBody {...props} height="clamp(480px, 62vh, 640px)" />
    </Show>
  );
}

function HeatmapPanelBody(props: SectorHeatmapPanelProps & { height: string }) {
  return (
    <CompactPanel
      id="sector-heatmap-panel"
      data-testid="sector-heatmap-panel"
      padded={false}
      scrollable
      // A definite height is required: the heatmap view fills 100% of its
      // parent, and a min-height leaves that percentage unresolvable. The
      // extra band pays for the visible sector legend under the chart.
      style={{ height: props.height, flex: "0 0 auto" }}
      className="flex min-w-0 flex-col"
      title={
        <Box className="flex items-center justify-between gap-2">
          <Text fw={600} className="text-ui-micro">Market Heatmap</Text>
          <Show when={props.data.last_updated}>
            <Box className="flex items-center gap-1">
              <IconClock size={12} color="var(--color-fin-text-muted)" />
              <Text c="dimmed" className="text-ui-micro font-mono tabular-nums">
                {new Date(props.data.last_updated!).toLocaleTimeString()}
              </Text>
            </Box>
          </Show>
        </Box>
      }
    >
      <Box
        data-testid="sector-heatmap-controls"
        className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-1 border-b border-fin-border px-2 py-1"
      >
        <SectorHeatmapControls
          viewMode={props.viewMode}
          onViewModeChange={props.onViewModeChange}
          metric={props.metric}
          onMetricChange={props.onMetricChange}
          sectorFilter={props.stockSectorFilter}
          sectorOptions={props.sectorOptions}
          onSectorFilterChange={props.onSectorFilterChange}
          loading={props.loading}
          error={props.error}
        />
      </Box>
      <SectorHeatmapView
        viewMode={props.viewMode}
        sectors={props.data.sectors}
        stocks={props.stocks}
        metric={props.metric}
        loading={props.loading}
        error={props.error}
        onSymbolClick={props.onSymbolClick}
      />
    </CompactPanel>
  );
}

function DashboardContent(props: {
  data: SectorResponse;
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
  viewMode: ViewMode;
  heatmapStocks: HeatmapStock[];
  heatmapMetric: string;
  dashboardView: DashboardView;
  market: "india" | "america";
  stockSectorFilter: string | null;
  sectorOptions: { value: string; label: string }[];
  heatmapLoading: boolean;
  heatmapError: string | null;
  onViewModeChange: (mode: ViewMode) => void;
  onHeatmapMetricChange: (metric: string) => void;
  onStockSectorFilterChange: (sector: string | null) => void;
  onSymbolClick: (symbol: string) => void;
}) {
  const data = () => props.data;
  const topStocks = () => data().top_stock_movers;

  return (
    <Box
      className="flex w-full min-w-0 flex-col gap-[2px] p-[2px]"
    >
      <Show when={props.dashboardView === "visual"} fallback={
        <Box
          className="grid w-full min-w-0 gap-[2px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,2.4fr)_minmax(320px,1fr)]"
        >
          <SectorPerformancePanel
            sectors={data().sectors}
            market={props.market}
            onSymbolClick={props.onSymbolClick}
          />
          <Box className="min-w-0 flex flex-col">
            <AlertsAndMovers
              alerts={props.alerts}
              intervalMovers={props.intervalMovers}
              topStocks={topStocks()}
              sectors={data().sectors}
              market={props.market}
              onSymbolClick={props.onSymbolClick}
            />
          </Box>
        </Box>
      }>
        <Box
          data-testid="sector-visual-layout"
          className="flex w-full min-w-0 flex-col gap-[2px]"
        >
          <SectorHeatmapPanel
            data={data()}
            viewMode={props.viewMode}
            stocks={props.heatmapStocks}
            metric={props.heatmapMetric}
            stockSectorFilter={props.stockSectorFilter}
            sectorOptions={props.sectorOptions}
            loading={props.heatmapLoading}
            error={props.heatmapError}
            onViewModeChange={props.onViewModeChange}
            onMetricChange={props.onHeatmapMetricChange}
            onSectorFilterChange={props.onStockSectorFilterChange}
            onSymbolClick={props.onSymbolClick}
          />

          <Box
            data-testid="sector-visual-grid"
            className="grid w-full min-w-0 gap-[2px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          >
            <Stack spacing={0.5} className="flex w-full min-w-0 items-stretch">
              <SectorAlertsCard
                alerts={props.alerts}
                sectors={data().sectors}
                onSymbolClick={props.onSymbolClick}
              />
              <IntervalMoversCard
                intervalMovers={props.intervalMovers}
                market={props.market}
                onSymbolClick={props.onSymbolClick}
              />
            </Stack>
            <Box className="min-w-0 flex flex-col">
              <TopStocksCard
                topStocks={topStocks()}
                market={props.market}
                onSymbolClick={props.onSymbolClick}
              />
            </Box>
          </Box>
        </Box>
      </Show>
    </Box>
  );
}

function processSectorResponse(
  response: SectorResponse,
  prevSectorData: Record<string, number>,
  prevStockData: Record<string, number>,
  setAlerts: (fn: (prev: SectorAlert[]) => SectorAlert[]) => void,
  setIntervalMovers: (movers: InternalStockMover[]) => void,
) {
  const sectors = response.sectors ?? [];
  const newAlerts = detectSectorAlerts(sectors, prevSectorData);
  sectors.forEach((item: SectorItem) => {
    prevSectorData[item.sector] = item.avg_change;
  });
  if (newAlerts.length > 0) {
    setAlerts((prev) => [...newAlerts, ...prev].slice(0, 10));
  }
  const stockMovers = response.top_stock_movers ?? [];
  const newIntervalMovers = detectIntervalMovers(stockMovers, prevStockData);
  stockMovers.forEach((item: StockMover) => {
    prevStockData[item.symbol] = item.change;
  });
  if (newIntervalMovers.length > 0) {
    setIntervalMovers(newIntervalMovers.slice(0, 10));
  }
}

interface SectorState {
  data: Accessor<SectorResponse | null>;
  setData: Setter<SectorResponse | null>;
  loading: Accessor<boolean>;
  setLoading: Setter<boolean>;
  error: Accessor<string | null>;
  setError: Setter<string | null>;
  market: Accessor<"india" | "america">;
  setMarket: Setter<"india" | "america">;
  alerts: Accessor<SectorAlert[]>;
  setAlerts: Setter<SectorAlert[]>;
  intervalMovers: Accessor<InternalStockMover[]>;
  setIntervalMovers: Setter<InternalStockMover[]>;
  prevSectorData: Record<string, number>;
  prevStockData: Record<string, number>;
  requestAbort: { current: AbortController | null };
}

function useSectorState(): SectorState {
  const [data, setData] = createSignal<SectorResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [market, setMarket] = createSignal<"india" | "america">("india");
  const [alerts, setAlerts] = createSignal<SectorAlert[]>([]);
  const [intervalMovers, setIntervalMovers] = createSignal<InternalStockMover[]>([]);
  const prevSectorData: Record<string, number> = {};
  const prevStockData: Record<string, number> = {};
  const requestAbort = { current: null as AbortController | null };

  return {
    data,
    setData,
    loading,
    setLoading,
    error,
    setError,
    market,
    setMarket,
    alerts,
    setAlerts,
    intervalMovers,
    setIntervalMovers,
    prevSectorData,
    prevStockData,
    requestAbort,
  };
}

function useSectorLoadData(state: SectorState) {
  const {
    requestAbort,
    setLoading,
    setError,
    setData,
    setAlerts,
    setIntervalMovers,
    prevSectorData,
    prevStockData,
  } = state;

  const loadData = async (mkt: string, isInitial = false, force = false): Promise<boolean> => {
    if (requestAbort.current) {
      // A manual refresh supersedes whatever is in flight; a background poll
      // yields to it instead of stacking a second upstream scan.
      if (!isInitial && !force) return false;
      requestAbort.current.abort();
    }
    const controller = new AbortController();
    requestAbort.current = controller;
    if (isInitial) setLoading(true);
    setError(null);
    try {
      const res = await fetchSectorPerformance(mkt, controller.signal, force);
      if (controller.signal.aborted) return false;
      processSectorResponse(
        res,
        prevSectorData,
        prevStockData,
        (fn) => setAlerts(fn),
        (movers) => setIntervalMovers(movers),
      );
      setData(res);
      return true;
    } catch (err) {
      if (controller.signal.aborted) return false;
      setError(err instanceof Error ? err.message : "Failed to load sector data");
      return true;
    } finally {
      if (requestAbort.current === controller) {
        requestAbort.current = null;
        setLoading(false);
      }
    }
  };

  return loadData;
}

function useSectorPolling(
  state: SectorState,
  loadData: (mkt: string, isInitial?: boolean, force?: boolean) => Promise<boolean>,
) {
  const { market, requestAbort } = state;

  createEffect(() => {
    const currentMarket = market();
    let cancelled = false;
    let fastPollCount = 0;
    const liveTimeout = { current: null as ReturnType<typeof setTimeout> | null };

    const scheduleNextPoll = (delay: number) => {
      if (cancelled) return;
      liveTimeout.current = setTimeout(() => {
        if (cancelled) return;
        if (!isMarketOpenNow()) return;
        void loadData(currentMarket).then((completed) => {
          if (cancelled || !completed) return;
          fastPollCount += 1;
          scheduleNextPoll(fastPollCount < 2 ? 5000 : 60000);
        });
      }, delay);
    };

    void loadData(currentMarket, true).then((completed) => {
      if (!cancelled && completed) {
        scheduleNextPoll(5000);
      }
    });

    onCleanup(() => {
      cancelled = true;
      if (liveTimeout.current) clearTimeout(liveTimeout.current);
      requestAbort.current?.abort();
    });
  });
}

function useSectorData() {
  const state = useSectorState();
  const loadData = useSectorLoadData(state);
  useSectorPolling(state, loadData);
  return { ...state, loadData };
}

function SectorPageHeader(props: {
  market: "india" | "america";
  setMarket: (m: "india" | "america") => void;
  loading: boolean;
  onRefresh: () => void;
}) {
  // Only the subscription's lifetime matters here: the header reads holiday
  // state through isMarketOpenNow(), so it needs a subscription, not a snapshot.
  useStoreSubscription(subscribeToHolidays);
  const marketOpen = () => isMarketOpenNow();
  return (
    <ToolbarRow
      gap={8}
      data-testid="sector-header"
      style={{
        padding: "4px 12px",
        "min-height": "36px",
        "border-bottom": "1px solid var(--color-fin-border)",
        "flex-shrink": "0",
      }}
    >
      <Text fw={700} className="text-ui-micro whitespace-nowrap">
        Sector Dashboard
      </Text>
      <Text c="dimmed" className="hidden whitespace-nowrap text-ui-micro xl:inline">
        Real-time sector performance and technical strength.
      </Text>
      <Show when={!marketOpen()}>
        <Text
          c="warning"
          fw={700}
          title="Showing the last available session snapshot"
          className="text-ui-micro whitespace-nowrap tracking-[0.4px]"
        >
          MARKET CLOSED
        </Text>
      </Show>
      <Box className="mx-1 h-4 w-px shrink-0 bg-fin-border" />
      <CompactToggle
        testId="sector-market-selector"
        label="Market"
        value={props.market}
        options={[
          { value: "india", label: "India" },
          { value: "america", label: "US" },
        ]}
        onChange={(v) => props.setMarket(v as "india" | "america")}
      />
      <Box className="min-w-4 flex-1" />
      {/* @/ui Button reads `disabled`/`loading` once at construction, so the
          button is rebuilt whenever the loading flag flips. */}
      <Show when={props.loading} keyed>
        {(_loading) => (
          <Button
            variant="light"
            color="secondary"
            size="xs"
            leftSection={<IconRefresh size={12} />}
            onClick={props.onRefresh}
            loading={true}
            disabled={true}
            title={!marketOpen() ? "Market is closed" : undefined}
            className="shrink-0"
            data-testid="sector-refresh-btn"
          >
            Refresh
          </Button>
        )}
      </Show>
      <Show when={!props.loading}>
        <Button
          variant="light"
          color="secondary"
          size="xs"
          leftSection={<IconRefresh size={12} />}
          onClick={props.onRefresh}
          loading={false}
          disabled={!marketOpen()}
          title={!marketOpen() ? "Market is closed" : undefined}
          className="shrink-0"
          data-testid="sector-refresh-btn"
        >
          Refresh
        </Button>
      </Show>
    </ToolbarRow>
  );
}

function SectorContextBar(props: {
  data: SectorResponse | null;
  dashboardView: DashboardView;
  onDashboardViewChange: (view: DashboardView) => void;
}) {
  const sectors = () => props.data?.sectors ?? [];
  const top = () => sectors()[0];
  const bottom = () => sectors()[sectors().length - 1];
  const advances = () => sectors().reduce((acc, s) => acc + s.advances, 0);
  const declines = () => sectors().reduce((acc, s) => acc + s.declines, 0);

  return (
    <ToolbarRow
      gap={8}
      data-testid="sector-context-bar"
      style={{ padding: "4px 12px", "min-height": "28px", "border-bottom": "1px solid var(--color-fin-border)", "flex-shrink": "0" }}
    >
      <Show when={top() && bottom()}>
        <Box data-testid="sector-summary-strip" className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <Box
            data-testid="sector-top-summary"
            className="flex min-w-0 flex-wrap items-baseline gap-x-1"
          >
            <Text size="xs" c="dimmed" fw={700} tt="uppercase" className="text-ui-micro tracking-[0.3px] whitespace-nowrap">
              Top Sector
            </Text>
            {/* Both ends of the strip carry the same fields. Hiding only the
                top change made 390 read as an asymmetric pair; the name now
                wraps instead of stealing the number's slot. */}
            <Text
              fw={700}
              c="success"
              className="text-ui-micro min-w-0 break-words"
              title={top()!.sector}
              data-testid="sector-top-summary-name"
            >
              {top()!.sector}
            </Text>
            <Text
              c="dimmed"
              data-testid="sector-top-summary-change"
              className="text-ui-micro font-mono tabular-nums whitespace-nowrap"
            >
              Avg Change: {formatPercentage(top()!.avg_change)}
            </Text>
          </Box>
          <Box className="flex flex-wrap items-baseline gap-x-[6px]">
            <Text size="xs" c="dimmed" fw={700} tt="uppercase" className="text-ui-micro tracking-[0.3px] whitespace-nowrap">
              Market Breadth
            </Text>
            <Text fw={700} c="success" className="text-ui-micro font-mono tabular-nums">
              {advances()} UP
            </Text>
            <Text fw={700} c="error" className="text-ui-micro font-mono tabular-nums">
              {declines()} DOWN
            </Text>
          </Box>
          <Box
            data-testid="sector-bottom-summary"
            className="flex min-w-0 flex-wrap items-baseline gap-x-1"
          >
            <Text size="xs" c="dimmed" fw={700} tt="uppercase" className="text-ui-micro tracking-[0.3px] whitespace-nowrap">
              Weakest Sector
            </Text>
            <Text fw={700} c="error" className="text-ui-micro min-w-0 break-words" title={bottom()!.sector}>
              {bottom()!.sector}
            </Text>
            <Text
              c="dimmed"
              data-testid="sector-bottom-summary-change"
              className="text-ui-micro font-mono tabular-nums whitespace-nowrap"
            >
              Avg Change: {formatPercentage(bottom()!.avg_change)}
            </Text>
          </Box>
        </Box>
      </Show>
      <Box className="flex-1" />
      <CompactToggle
        testId="sector-dashboard-view-toggle"
        label="Dashboard view"
        value={props.dashboardView}
        options={[
          { value: "table", label: "Table" },
          { value: "visual", label: "Visual" },
        ]}
        onChange={(v) => props.onDashboardViewChange(v as DashboardView)}
      />
    </ToolbarRow>
  );
}

function DashboardSectionContent(props: {
  data: SectorResponse | null;
  loading: boolean;
  error: string | null;
  market: "india" | "america";
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
  loadData: (m: string, isInitial?: boolean, force?: boolean) => Promise<boolean>;
  viewMode: ViewMode;
  heatmapStocks: HeatmapStock[];
  heatmapMetric: string;
  dashboardView: DashboardView;
  stockSectorFilter: string | null;
  sectorOptions: { value: string; label: string }[];
  heatmapLoading: boolean;
  heatmapError: string | null;
  onViewModeChange: (mode: ViewMode) => void;
  onHeatmapMetricChange: (metric: string) => void;
  onStockSectorFilterChange: (sector: string | null) => void;
  onSymbolClick: (symbol: string) => void;
}) {
  return (
    <Show when={!props.loading} fallback={<LoadingPanel />}>
      <Show when={!props.error} fallback={<ErrorPanel error={props.error ?? ""} onRetry={() => props.loadData(props.market)} />}>
        <Show when={props.data && props.data.sectors.length > 0} fallback={<EmptyPanel />}>
          <DashboardContent
            data={props.data!}
            alerts={props.alerts}
            intervalMovers={props.intervalMovers}
            viewMode={props.viewMode}
            heatmapStocks={props.heatmapStocks}
            heatmapMetric={props.heatmapMetric}
            dashboardView={props.dashboardView}
            market={props.market}
            stockSectorFilter={props.stockSectorFilter}
            sectorOptions={props.sectorOptions}
            heatmapLoading={props.heatmapLoading}
            heatmapError={props.heatmapError}
            onViewModeChange={props.onViewModeChange}
            onHeatmapMetricChange={props.onHeatmapMetricChange}
            onStockSectorFilterChange={props.onStockSectorFilterChange}
            onSymbolClick={props.onSymbolClick}
          />
        </Show>
      </Show>
    </Show>
  );
}

function useSectionNavigation(initial: SectorSectionId) {
  const [active, setActive] = createSignal<SectorSectionId>(initial);
  const [mounted, setMounted] = createSignal<Record<SectorSectionId, boolean>>({
    overview: true,
    rotation: initial === "rotation",
    correlation: initial === "correlation",
    history: initial === "history",
  });
  const scrollRoot = { current: null as HTMLElement | null };
  let settleTo: (id: SectorSectionId) => void = () => {};

  const forceMount = (id: SectorSectionId) =>
    setMounted((prev) => (prev[id] ? prev : { ...prev, [id]: true }));

  /** A lazy section above the target can expand after the first scroll. */
  const forceMountThrough = (id: SectorSectionId) => {
    const targetIndex = SECTOR_SECTIONS.findIndex((section) => section.id === id);
    if (targetIndex < 0) return;
    for (const section of SECTOR_SECTIONS.slice(0, targetIndex + 1)) {
      forceMount(section.id);
    }
  };

  const focusSection = (id: SectorSectionId) => {
    const target = document.getElementById(id);
    if (!target) return;
    // Instant, not smooth: a capture or a keyboard user must land on the
    // section before the next paint, and the fallback covers nested scrollports
    // whose smooth animation can be interrupted by a focus change.
    target.scrollIntoView?.({ behavior: "auto", block: "start" });
    const root = scrollRoot.current;
    if (root) {
      const desired = id === "overview" ? 0 : 48;
      const offset = target.getBoundingClientRect().top - root.getBoundingClientRect().top;
      if (Math.abs(offset - desired) > 4) {
        root.scrollTo?.({ top: root.scrollTop + offset - desired, behavior: "auto" });
      }
    }
    target.focus({ preventScroll: true });
  };

  const goTo = (id: SectorSectionId, push = true) => {
    setActive(id);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.hash = id;
      const target = `${url.pathname}${url.search}${url.hash}`;
      if (push) window.history.pushState(window.history.state, "", target);
      else window.history.replaceState(window.history.state, "", target);
    }
    // All navigation goes through the same settle loop. The old one-shot
    // focus was correct for the initial hash but not after a lazy section above
    // the target expanded.
    settleTo(id);
  };

  onMount(() => {
    const root = scrollRoot.current;
    let settleTarget: SectorSectionId | null = null;
    let settleToken = 0;
    let settleTimer: number | undefined;

    const onScroll = () => {
      for (const section of SECTOR_SECTIONS) forceMount(section.id);
    };
    const scroller = root ?? window;
    scroller.addEventListener("scroll", onScroll, { once: true, passive: true });

    const syncActive = () => {
      if (settleTarget) return;
      const atEnd =
        !!root && root.scrollTop + root.clientHeight >= root.scrollHeight - 4;
      if (atEnd) {
        setActive(SECTOR_SECTIONS[SECTOR_SECTIONS.length - 1].id);
        return;
      }
      const edge = (root?.getBoundingClientRect().top ?? 0) + 56;
      let current: SectorSectionId = "overview";
      for (const section of SECTOR_SECTIONS) {
        const node = document.getElementById(section.id);
        if (node && node.getBoundingClientRect().top <= edge) current = section.id;
      }
      setActive(current);
    };
    scroller.addEventListener("scroll", syncActive, { passive: true });

    const stopSettle = (notify: boolean) => {
      const wasSettling = settleTarget !== null;
      settleTarget = null;
      settleToken += 1;
      if (settleTimer !== undefined) {
        window.clearTimeout(settleTimer);
        settleTimer = undefined;
      }
      if (notify && wasSettling) syncActive();
    };

    // User intent, not the programmatic scroll, ends the correction loop.
    const cancelOnIntent = () => {
      if (settleTarget) stopSettle(true);
    };
    const cancelHost: HTMLElement | Window = root ?? window;
    cancelHost.addEventListener("wheel", cancelOnIntent, { passive: true });
    cancelHost.addEventListener("touchstart", cancelOnIntent, { passive: true });
    cancelHost.addEventListener("pointerdown", cancelOnIntent, { passive: true });
    cancelHost.addEventListener("keydown", cancelOnIntent);

    const beginSettle = (id: SectorSectionId) => {
      stopSettle(false);
      const token = ++settleToken;
      const startedAt = Date.now();
      let stableSince = 0;
      settleTarget = id;
      forceMountThrough(id);
      setActive(id);
      focusSection(id);

      const tick = () => {
        if (token !== settleToken || settleTarget !== id) return;
        const currentRoot = scrollRoot.current;
        const target = document.getElementById(id);
        if (!currentRoot || !target) {
          if (Date.now() - startedAt >= 8000) {
            setActive(id);
            stopSettle(true);
            return;
          }
          settleTimer = window.setTimeout(tick, 50);
          return;
        }
        const desired = id === "overview" ? 0 : 48;
        const top =
          target.getBoundingClientRect().top -
          currentRoot.getBoundingClientRect().top;
        if (Math.abs(top - desired) > 4) {
          focusSection(id);
          stableSince = 0;
        } else if (stableSince === 0) {
          stableSince = Date.now();
        }
        const now = Date.now();
        // Keep correcting through lazy expansion above the target. The 48px
        // offset is the invariant; 600ms of stability is the completion bar.
        if (
          (stableSince !== 0 && now - stableSince >= 600) ||
          now - startedAt >= 8000
        ) {
          setActive(id);
          stopSettle(true);
          return;
        }
        settleTimer = window.setTimeout(tick, 50);
      };
      settleTimer = window.setTimeout(tick, 50);
    };
    settleTo = beginSettle;

    if (initial !== "overview") beginSettle(initial);

    let observer: IntersectionObserver | undefined;
    if (root && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const id = (entry.target as HTMLElement).dataset.section as SectorSectionId | undefined;
            if (id) forceMount(id);
          }
        },
        { root, rootMargin: "600px 0px" },
      );
      for (const section of SECTOR_SECTIONS) {
        const node = document.getElementById(section.id);
        if (node) observer.observe(node);
      }
    }

    const syncFromUrl = () => {
      settleTo(sectionFromHash());
    };
    window.addEventListener("hashchange", syncFromUrl);
    window.addEventListener("popstate", syncFromUrl);

    onCleanup(() => {
      stopSettle(false);
      settleTo = () => {};
      cancelHost.removeEventListener("wheel", cancelOnIntent);
      cancelHost.removeEventListener("touchstart", cancelOnIntent);
      cancelHost.removeEventListener("pointerdown", cancelOnIntent);
      cancelHost.removeEventListener("keydown", cancelOnIntent);
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("scroll", syncActive);
      observer?.disconnect();
      window.removeEventListener("hashchange", syncFromUrl);
      window.removeEventListener("popstate", syncFromUrl);
    });
  });

  return { active, mounted, goTo, scrollRoot };
}

export function SectorPage() {
  const state = useSectorData();
  const nav = useSectionNavigation(normalizeSectionUrl());
  const dock = useSymbolDock();
  // The provider routes US listings itself when given the provider tag.
  const openSymbol = (symbol: string) =>
    dock.open(symbol, "chart", state.market() === "america" ? "usa" : "india");

  const [viewMode, setViewMode] = createSignal<ViewMode>("sector");
  const [dashboardView, setDashboardView] = createSignal<DashboardView>(readDashboardView());
  const [heatmapMetric, setHeatmapMetric] = createSignal("change_pct");
  const [stockSectorFilter, setStockSectorFilter] = createSignal<string | null>(null);
  const [heatmapStocks, setHeatmapStocks] = createSignal<HeatmapStock[]>([]);
  const [heatmapLoading, setHeatmapLoading] = createSignal(false);
  const [heatmapError, setHeatmapError] = createSignal<string | null>(null);

  createEffect(() => {
    const currentView = viewMode();
    const filter = stockSectorFilter();
    if (currentView !== "stock") return;
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    setHeatmapLoading(true);
    setHeatmapError(null);
    fetchHeatmapData(undefined, undefined, filter || undefined, 500, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setHeatmapStocks(res.stocks);
        setHeatmapLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setHeatmapStocks([]);
        setHeatmapError(
          error instanceof Error ? error.message : "Stock heatmap is unavailable",
        );
        setHeatmapLoading(false);
      });
  });

  const sectorOptions = createMemo(() => {
    const unique = [...new Set(heatmapStocks().map((s) => s.sector).filter(Boolean))];
    return unique.map((s) => ({ value: s, label: s }));
  });

  return (
    <Box
      data-testid="sector-analysis-view"
      className="w-full h-full min-h-0 flex flex-col p-0 gap-0 overflow-hidden"
    >
      <Box
        id="sector-page"
        data-testid="sector-tab-content"
        ref={(element: HTMLElement) => { nav.scrollRoot.current = element; }}
        className="flex-1 min-h-0 w-full flex flex-col overflow-y-auto overflow-x-hidden"
      >
        <SectorPageHeader
          market={state.market()}
          setMarket={state.setMarket}
          loading={state.loading()}
          onRefresh={() => state.loadData(state.market(), false, true)}
        />
        <SectorSectionNav active={nav.active()} onNavigate={(id) => nav.goTo(id)} />

        <SectionShell id="overview" mounted={true}>
          <Show when={state.data()}>
            <SectorContextBar
              data={state.data()}
              dashboardView={dashboardView()}
              onDashboardViewChange={(view) => {
                setDashboardView(view);
                writeDashboardView(view);
              }}
            />
          </Show>
          <DashboardSectionContent
            data={state.data()}
            loading={state.loading()}
            error={state.error()}
            market={state.market()}
            alerts={state.alerts()}
            intervalMovers={state.intervalMovers()}
            loadData={state.loadData}
            viewMode={viewMode()}
            heatmapStocks={heatmapStocks()}
            heatmapMetric={heatmapMetric()}
            dashboardView={dashboardView()}
            stockSectorFilter={stockSectorFilter()}
            sectorOptions={sectorOptions()}
            heatmapLoading={heatmapLoading()}
            heatmapError={heatmapError()}
            onViewModeChange={setViewMode}
            onHeatmapMetricChange={setHeatmapMetric}
            onStockSectorFilterChange={setStockSectorFilter}
            onSymbolClick={openSymbol}
          />
        </SectionShell>

        <SectionShell
          id="rotation"
          mounted={nav.mounted().rotation}
          // The 2x2 desk needs a definite desktop height so the four panels
          // share two rows. Below lg the panels stack and the section grows
          // with the page instead of hiding the matrix/board/detail.
          contentClass="overflow-visible lg:h-[900px] lg:overflow-hidden"
        >
          <RotationTab market={state.market()} />
        </SectionShell>

        {/* Correlation and history size to their content. Fixed section heights
            used to clip the last board / RS table between the 900–1100 widths,
            and an inner scrollport is not discoverable on a single-page desk. */}
        <SectionShell
          id="correlation"
          mounted={nav.mounted().correlation}
          contentClass="overflow-visible"
        >
          <SectorCorrelationTab />
        </SectionShell>

        <SectionShell
          id="history"
          mounted={nav.mounted().history}
          contentClass="overflow-visible"
        >
          <Suspense fallback={<HistoryTabFallback />}>
            <SectorHistoryTab market={state.market()} />
          </Suspense>
        </SectionShell>
      </Box>
    </Box>
  );
}
