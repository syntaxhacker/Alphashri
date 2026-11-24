import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { ActionIcon, Box, Button, Loader, Select, Text, ToolbarRow } from "@/ui";
import { IconClock, IconRefresh } from "../../screener/icons";
import { CompactPanel } from "../../common/compact";
import type {
  SectorHistoryMarket,
  SectorHistoryRisk,
  SectorHistorySeasonality,
  SectorHistorySeries,
} from "../../../types/sectorHistory";
import { useSectorHistory } from "./useSectorHistory";
import { RiskTable } from "./RiskTable";
import { HistoryLab, HistoryPanel } from "./HistoryLab";
import { CompactToggle } from "../CompactToggle";
import { SectorRankHeatmap } from "./visuals/SectorRankHeatmap";
import { SeasonalityHeatmap } from "./visuals/SeasonalityHeatmap";
import { PersistenceMatrix } from "./visuals/PersistenceMatrix";
import { RotationTimeline } from "./visuals/RotationTimeline";

const MARKET_OPTIONS = [
  { label: "India", value: "india" },
  { label: "US", value: "america" },
];

type HistoryView = "overview" | "lab";

const YEAR_OPTIONS = [
  { label: "3Y", value: "3" },
  { label: "5Y", value: "5" },
  { label: "10Y", value: "10" },
];

const RANK_CHART_CLASS = "min-w-0 [&>svg]:h-auto [&>svg]:w-full [&>svg]:min-w-[900px]";
const SEASONALITY_BODY_CLASS = "mx-auto w-full min-w-0 max-w-[760px]";
const PERSISTENCE_BODY_CLASS = "mx-auto w-full min-w-0 max-w-[560px]";

/** The visual owners render their own scrollports; our wrapper is the single scroller so the
 *  region focus, keyboard arrow scrolling and the edge hint all target the same element. */
const INNER_SCROLL_RESET = `
  [data-history-scroller] [data-testid="history-seasonality-scroll"],
  [data-history-scroller] [data-testid="history-persistence-scroll"] {
    overflow: visible !important;
  }
`;

const ERROR_FALLBACK = "Sector history is temporarily unavailable. Try again.";
const FETCH_FAILURE =
  /sector_history_unavailable|failed to fetch|network|load failed|fetch failed/i;

function errorCopy(raw: string | null): { primary: string; code: string } {
  const value = (raw ?? "").trim();
  if (!value) return { primary: ERROR_FALLBACK, code: "" };
  return FETCH_FAILURE.test(value)
    ? { primary: ERROR_FALLBACK, code: value }
    : { primary: value, code: "" };
}

function HistoryHeader(props: {
  market: SectorHistoryMarket;
  years: number;
  view: HistoryView;
  loading: boolean;
  asOf: string;
  cached: boolean | null;
  onMarketChange: (market: SectorHistoryMarket) => void;
  onYearsChange: (years: number) => void;
  onViewChange: (view: HistoryView) => void;
  onRefresh: () => void;
}) {
  return (
    <ToolbarRow
      gap={8}
      data-testid="sector-history-header"
      className="shrink-0 flex-wrap border-b border-fin-border px-2"
      style={{ "min-height": "32px" }}
    >
      <Text fw={700} className="text-ui-micro whitespace-nowrap">
        Sector History
      </Text>
      <Box className="w-[96px] min-w-[88px] shrink-0">
        <Select
          value={props.market}
          onChange={(value) => {
            if (value === "india" || value === "america") props.onMarketChange(value);
          }}
          data={MARKET_OPTIONS}
          size="xs"
          className="text-ui-micro"
          aria-label="Sector history market"
          data-testid="sector-history-market"
        />
      </Box>
      <Box className="w-[78px] min-w-[64px] shrink-0">
        <Select
          value={String(props.years)}
          onChange={(value) => {
            if (value != null) props.onYearsChange(Number(value));
          }}
          data={YEAR_OPTIONS}
          size="xs"
          className="text-ui-micro"
          aria-label="Sector history lookback"
          data-testid="sector-history-years"
        />
      </Box>
      <CompactToggle
        testId="sector-history-view-toggle"
        label="Sector history view"
        value={props.view}
        options={[
          { value: "overview", label: "Overview" },
          { value: "lab", label: "Rotation Lab" },
        ]}
        onChange={(value) => props.onViewChange(value === "lab" ? "lab" : "overview")}
      />
      <Box className="flex-1" />
      <Show when={props.loading}>
        <Loader size="xs" />
      </Show>
      <Show when={props.asOf}>
        <Box className="flex items-center gap-1">
          <IconClock size={12} className="text-fin-text-muted" />
          <Text
            c="dimmed"
            data-testid="sector-history-asof"
            className="text-ui-micro font-mono tabular-nums whitespace-nowrap"
          >
            As of {props.asOf}
          </Text>
        </Box>
      </Show>
      <Show when={props.cached !== null}>
        <Text
          fw={700}
          c={props.cached ? "dimmed" : "success"}
          data-testid="sector-history-cached"
          className="text-ui-micro tracking-[0.4px] whitespace-nowrap"
        >
          {props.cached ? "CACHED" : "LIVE"}
        </Text>
      </Show>
      <ActionIcon
        variant="subtle"
        size="sm"
        aria-label="Refresh sector history"
        onClick={props.onRefresh}
        data-testid="sector-history-refresh"
      >
        <IconRefresh size={14} />
      </ActionIcon>
    </ToolbarRow>
  );
}

function StatePanel(props: {
  testId: string;
  title: string;
  description: string;
  action?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <Box className="flex flex-1 min-h-0 items-start justify-center overflow-y-auto p-2">
      <CompactPanel
        testId={props.testId}
        title={props.title}
        description={props.description}
        action={props.action}
        className="w-full max-w-[520px]"
      >
        {props.children}
      </CompactPanel>
    </Box>
  );
}

function LoadingState() {
  return (
    <StatePanel
      testId="sector-history-loading"
      title="Loading sector history"
      description="Fetching monthly sector ranks, seasonality and risk metrics."
      action={<Loader size="xs" />}
    />
  );
}

function EmptyState(props: { market: SectorHistoryMarket; years: number; onRefresh: () => void }) {
  const marketLabel = () => (props.market === "india" ? "India" : "US");
  return (
    <StatePanel
      testId="sector-history-empty"
      title="No sector history"
      description={`No history is available for ${marketLabel()} over ${props.years}Y.`}
      action={
        <Button
          variant="outline"
          size="xs"
          onClick={props.onRefresh}
          data-testid="sector-history-empty-refresh"
        >
          Refresh
        </Button>
      }
    />
  );
}

function ErrorState(props: { error: string; onRetry: () => void }) {
  const copy = createMemo(() => errorCopy(props.error));
  return (
    <StatePanel
      testId="sector-history-error"
      title="Sector history unavailable"
      description={copy().primary}
      action={
        <Button
          variant="outline"
          color="error"
          size="xs"
          onClick={props.onRetry}
          data-testid="sector-history-retry"
        >
          Retry
        </Button>
      }
    >
      <Show when={copy().code}>
        <Text
          data-testid="sector-history-error-code"
          c="dimmed"
          className="text-ui-micro font-mono break-all"
        >
          {copy().code}
        </Text>
      </Show>
    </StatePanel>
  );
}

function ChartScroller(props: {
  testId: string;
  label: string;
  bodyClass?: string;
  children: JSX.Element;
}) {
  let scrollEl: HTMLDivElement | undefined;
  const [overflowing, setOverflowing] = createSignal(false);
  const [atEnd, setAtEnd] = createSignal(false);

  const measure = () => {
    const node = scrollEl;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    setOverflowing(max > 2);
    setAtEnd(max <= 2 || node.scrollLeft >= max - 2);
  };

  const handleScroll = () => {
    const node = scrollEl;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    setAtEnd(max <= 2 || node.scrollLeft >= max - 2);
  };

  onMount(() => {
    measure();
    const node = scrollEl;
    if (!node) return;
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    resize?.observe(node);
    const mutation = typeof MutationObserver !== "undefined" ? new MutationObserver(measure) : null;
    mutation?.observe(node, { childList: true, subtree: true });
    onCleanup(() => {
      resize?.disconnect();
      mutation?.disconnect();
    });
  });

  return (
    <div class={`min-w-0 ${props.bodyClass ?? ""}`}>
      <div
        aria-hidden="true"
        data-testid={`${props.testId}-hint`}
        class={`mb-1 items-center justify-end ${overflowing() && !atEnd() ? "flex" : "hidden"}`}
      >
        <span class="text-ui-micro text-fin-text-muted">Scroll →</span>
      </div>
      <div
        ref={(node) => {
          scrollEl = node;
        }}
        data-history-scroller=""
        data-testid={props.testId}
        role="region"
        tabIndex={0}
        aria-label={props.label}
        onScroll={handleScroll}
        class="min-w-0 max-w-full overflow-x-auto overflow-y-hidden focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-primary"
      >
        {props.children}
      </div>
    </div>
  );
}

function SuccessContent(props: {
  months: string[];
  series: SectorHistorySeries[];
  universe: string[];
  seasonality: SectorHistorySeasonality[];
  transitionMatrix: (number | null)[][];
  risk: SectorHistoryRisk[];
  disclaimer: string;
}) {
  return (
    <Box className="flex flex-1 min-h-0 flex-col gap-2 overflow-x-hidden overflow-y-auto p-2">
      <style data-testid="sector-history-scroll-style">{INNER_SCROLL_RESET}</style>
      <HistoryPanel
        testId="sector-history-rank-panel"
        title="Sector Rank History"
        description={`${props.universe.length} sectors · monthly rank`}
      >
        <ChartScroller
          testId="sector-history-rank-scroll"
          label="Sector rank history by month. Scroll sideways for older months."
        >
          <Box className={RANK_CHART_CLASS}>
            <SectorRankHeatmap months={props.months} series={props.series} />
          </Box>
        </ChartScroller>
      </HistoryPanel>

      <Box className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
        <HistoryPanel
          testId="sector-history-seasonality-panel"
          title="Seasonality"
          description="avg return by calendar month"
        >
          <ChartScroller
            testId="sector-history-seasonality-scroll"
            label="Seasonality heatmap by calendar month. Scroll sideways for all months."
            bodyClass={SEASONALITY_BODY_CLASS}
          >
            <SeasonalityHeatmap cells={props.seasonality} names={props.universe} />
          </ChartScroller>
        </HistoryPanel>

        <HistoryPanel
          testId="sector-history-persistence-panel"
          title="Persistence"
          description="top-3 rank stickiness"
        >
          <ChartScroller
            testId="sector-history-persistence-scroll"
            label="Rank persistence matrix. Scroll sideways for all next-month ranks."
            bodyClass={PERSISTENCE_BODY_CLASS}
          >
            <PersistenceMatrix
              names={props.universe}
              matrix={props.transitionMatrix}
              transitionCount={
                props.months.length >= 2 && props.universe.length >= 1
                  ? (props.months.length - 1) * props.universe.length
                  : undefined
              }
            />
          </ChartScroller>
        </HistoryPanel>
      </Box>

      <HistoryPanel
        testId="sector-history-rotation-panel"
        title="Rotation Timeline"
        description="rank trajectory over time"
      >
        <RotationTimeline months={props.months} series={props.series} />
      </HistoryPanel>

      <HistoryPanel
        testId="sector-history-risk-panel"
        title="Risk"
        description="drawdown · Sharpe · volatility"
      >
        <RiskTable risk={props.risk} series={props.series} />
      </HistoryPanel>

      <Show when={props.disclaimer}>
        <Text
          c="dimmed"
          data-testid="sector-history-disclaimer"
          className="text-ui-micro leading-snug px-1"
        >
          {props.disclaimer}
        </Text>
      </Show>
    </Box>
  );
}

export function SectorHistoryTab(props: { market: SectorHistoryMarket }) {
  const [market, setMarket] = createSignal<SectorHistoryMarket>(props.market);
  const [years, setYears] = createSignal(5);
  const [view, setView] = createSignal<HistoryView>("overview");

  createEffect(() => {
    setMarket(props.market);
  });

  const { data, loading, error, refresh } = useSectorHistory(market, years);

  const series = createMemo(() => (Array.isArray(data()?.series) ? data()!.series : []));
  const months = createMemo(() => (Array.isArray(data()?.months) ? data()!.months : []));
  const universe = createMemo(() => (Array.isArray(data()?.universe) ? data()!.universe : []));
  const risk = createMemo(() => (Array.isArray(data()?.risk) ? data()!.risk : []));
  const seasonality = createMemo(() =>
    Array.isArray(data()?.seasonality) ? data()!.seasonality : [],
  );
  const transitionMatrix = createMemo(() =>
    Array.isArray(data()?.persistence?.transition_matrix)
      ? data()!.persistence.transition_matrix
      : [],
  );

  const hasData = createMemo(
    () =>
      series().length > 0 &&
      months().length > 0 &&
      universe().length > 0 &&
      risk().length > 0 &&
      seasonality().length > 0 &&
      transitionMatrix().length > 0,
  );

  const asOf = createMemo(() => {
    const value = data()?.as_of;
    return typeof value === "string" ? value : "";
  });

  const cached = createMemo(() => {
    const value = data()?.cached;
    return typeof value === "boolean" ? value : null;
  });

  const disclaimer = createMemo(() => {
    const response = data();
    const source =
      typeof response?.source === "string" && response.source
        ? `Source: ${response.source} · `
        : "";
    const note = typeof response?.disclaimer === "string" ? response.disclaimer : "";
    return `${source}${note}`;
  });

  return (
    <Box
      data-testid="sector-history-tab"
      className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden bg-fin-bg"
    >
      <HistoryHeader
        market={market()}
        years={years()}
        view={view()}
        loading={loading() && hasData()}
        asOf={asOf()}
        cached={cached()}
        onMarketChange={setMarket}
        onYearsChange={setYears}
        onViewChange={setView}
        onRefresh={refresh}
      />

      <Show
        when={error()}
        fallback={
          <Show
            when={loading() && !hasData()}
            fallback={
              <Show
                when={hasData()}
                fallback={<EmptyState market={market()} years={years()} onRefresh={refresh} />}
              >
                <Show
                  when={view() === "lab"}
                  fallback={
                    <SuccessContent
                      months={months()}
                      series={series()}
                      universe={universe()}
                      seasonality={seasonality()}
                      transitionMatrix={transitionMatrix()}
                      risk={risk()}
                      disclaimer={disclaimer()}
                    />
                  }
                >
                  <HistoryLab
                    market={market()}
                    years={years()}
                    months={months()}
                    series={series()}
                    universe={universe()}
                    seasonality={seasonality()}
                  />
                </Show>
              </Show>
            }
          >
            <LoadingState />
          </Show>
        }
      >
        <ErrorState error={error()!} onRetry={refresh} />
      </Show>
    </Box>
  );
}
