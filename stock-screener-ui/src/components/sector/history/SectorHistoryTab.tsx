import { Show, createEffect, createMemo, createSignal } from "solid-js";
import { ActionIcon, Alert, Box, Button, Loader, Select, Text, ToolbarRow } from "@/ui";
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
import { SectorRankHeatmap } from "./visuals/SectorRankHeatmap";
import { SeasonalityHeatmap } from "./visuals/SeasonalityHeatmap";
import { PersistenceMatrix } from "./visuals/PersistenceMatrix";
import { RotationTimeline } from "./visuals/RotationTimeline";

const MARKET_OPTIONS = [
  { label: "India", value: "india" },
  { label: "US", value: "america" },
];

const YEAR_OPTIONS = [
  { label: "3Y", value: "3" },
  { label: "5Y", value: "5" },
  { label: "10Y", value: "10" },
];

const RANK_CHART_CLASS =
  "min-w-0 overflow-x-auto overflow-y-hidden p-1 [&>svg]:h-auto [&>svg]:w-full [&>svg]:min-w-[900px]";
const SEASONALITY_CHART_CLASS =
  "mx-auto w-full min-w-0 max-w-[760px] overflow-hidden p-1 [&>svg]:h-auto [&>svg]:w-full";
const PERSISTENCE_CHART_CLASS =
  "mx-auto w-full min-w-0 max-w-[560px] overflow-hidden p-1 [&>svg]:h-auto [&>svg]:w-full";
const ROTATION_CHART_CLASS =
  "mx-auto w-full min-w-0 max-w-[1100px] overflow-x-auto overflow-y-hidden p-1 [&>svg]:h-auto [&>svg]:w-full [&>svg]:min-w-[640px]";

function HistoryHeader(props: {
  market: SectorHistoryMarket;
  years: number;
  loading: boolean;
  asOf: string;
  cached: boolean | null;
  onMarketChange: (market: SectorHistoryMarket) => void;
  onYearsChange: (years: number) => void;
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

function LoadingState() {
  return (
    <Box
      data-testid="sector-history-loading"
      className="flex flex-1 min-h-0 items-center justify-center gap-2 p-2"
    >
      <Loader size="sm" />
      <Text size="xs" c="dimmed">
        Loading sector history…
      </Text>
    </Box>
  );
}

function EmptyState() {
  return (
    <Box
      data-testid="sector-history-empty"
      className="flex flex-1 min-h-0 items-center justify-center p-2"
    >
      <Text size="xs" c="dimmed">
        No sector history available for this market.
      </Text>
    </Box>
  );
}

function ErrorState(props: { error: string; onRetry: () => void }) {
  return (
    <Box
      data-testid="sector-history-error"
      className="flex flex-1 min-h-0 items-center justify-center p-2"
    >
      <Box className="flex w-full max-w-[520px] flex-col gap-2">
        <Alert color="error" title="Sector history unavailable">
          <Text size="xs">{props.error}</Text>
        </Alert>
        <Box>
          <Button
            variant="outline"
            color="error"
            size="xs"
            onClick={props.onRetry}
            data-testid="sector-history-retry"
          >
            Retry
          </Button>
        </Box>
      </Box>
    </Box>
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
      <CompactPanel
        flush
        padded={false}
        testId="sector-history-rank-panel"
        title="Sector Rank History"
        description={`${props.universe.length} sectors · monthly rank`}
      >
        <Box className={RANK_CHART_CLASS}>
          <SectorRankHeatmap months={props.months} series={props.series} />
        </Box>
      </CompactPanel>

      <Box className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
        <CompactPanel
          flush
          padded={false}
          testId="sector-history-seasonality-panel"
          title="Seasonality"
          description="avg return by calendar month"
        >
          <Box className={SEASONALITY_CHART_CLASS}>
            <SeasonalityHeatmap cells={props.seasonality} names={props.universe} />
          </Box>
        </CompactPanel>

        <CompactPanel
          flush
          padded={false}
          testId="sector-history-persistence-panel"
          title="Persistence"
          description="top-3 rank stickiness"
        >
          <Box className={PERSISTENCE_CHART_CLASS}>
            <PersistenceMatrix names={props.universe} matrix={props.transitionMatrix} />
          </Box>
        </CompactPanel>
      </Box>

      <CompactPanel
        flush
        padded={false}
        testId="sector-history-rotation-panel"
        title="Rotation Timeline"
        description="rank trajectory over time"
      >
        <Box className={ROTATION_CHART_CLASS}>
          <RotationTimeline months={props.months} series={props.series} />
        </Box>
      </CompactPanel>

      <CompactPanel
        flush
        padded={false}
        testId="sector-history-risk-panel"
        title="Risk"
        description="drawdown · Sharpe · volatility"
      >
        <RiskTable risk={props.risk} series={props.series} />
      </CompactPanel>

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
        loading={loading() && hasData()}
        asOf={asOf()}
        cached={cached()}
        onMarketChange={setMarket}
        onYearsChange={setYears}
        onRefresh={refresh}
      />

      <Show
        when={error()}
        fallback={
          <Show
            when={loading() && !hasData()}
            fallback={
              <Show when={hasData()} fallback={<EmptyState />}>
                <SuccessContent
                  months={months()}
                  series={series()}
                  universe={universe()}
                  seasonality={seasonality()}
                  transitionMatrix={transitionMatrix()}
                  risk={risk()}
                  disclaimer={disclaimer()}
                />
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
