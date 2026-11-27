import { Show, createMemo, onMount } from "solid-js";
import { Box, Stack, Text } from "@/ui";
import { Button } from "@/ui";
import { Loader } from "@/ui";
import { Select } from "@/ui";
import { useColorScheme } from "@/ui";
import { IconRefresh, IconClock } from "../screener/icons";
import type { SectorCorrelationResponse } from "../../types/sector";
import {
  market as sectorMarket,
  lookbackDays,
  setMarket,
  setLookbackDays,
  isLoading as stateLoadingFlag,
  error as stateErrorRaw,
  data as stateDataRaw,
  fetchCorrelationData,
  subscribe as subscribeToState,
} from "../../state/sectorCorrelation";
import { useStoreSnapshot } from "../../hooks/useStoreSubscription";
import { CompactPanel } from "../common/compact";
import {
  SectorBetaChart,
  RotationTimeline,
  RelativeStrengthBoard,
} from "./SectorCorrelationCharts";
import { CorrelationMatrixBoard } from "./correlation/CorrelationMatrixBoard";

// 90 is the store's default; the previous 66-day "3M" option left the Select
// showing no valid value for the data that was actually fetched.
const LOOKBACK_OPTIONS = [
  { label: "5D", value: 5 },
  { label: "1M", value: 22 },
  { label: "3M", value: 90 },
  { label: "6M", value: 132 },
  { label: "1Y", value: 252 },
];

type SectorRow = SectorCorrelationResponse["sectors"][number];

const PANEL_CLASS =
  "flex min-w-0 flex-col overflow-hidden rounded-sm border border-fin-border bg-fin-surface";

function CorrelationHeader(props: { currentMarket: string; currentLookback: number; lastUpdated?: string }) {
  // The header reads props at construction; force re-check on each render pass.
  const currentMarket = () => props.currentMarket;
  const currentLookback = () => props.currentLookback;
  const lastUpdated = () => props.lastUpdated;

  const handleMarketChange = (v: string | null) => {
    if (v == null) return;
    setMarket(v as "india" | "america");
    void fetchCorrelationData();
  };
  const handleLookbackChange = (v: string | null) => {
    if (v == null) return;
    setLookbackDays(Number(v));
    void fetchCorrelationData();
  };
  const handleRefresh = () => {
    void fetchCorrelationData();
  };

  return (
    <Box data-testid="sector-correlation-header" className="flex min-h-[28px] shrink-0 items-center gap-1 flex-wrap border-b border-fin-border px-1 py-0.5 overflow-x-auto">
      <Text fw={700} className="text-ui-micro whitespace-nowrap">
        Sector Correlation
      </Text>
      <Select
        size="xs"
        value={currentMarket()}
        onChange={handleMarketChange}
        data={[{ value: "india", label: "India" }, { value: "america", label: "US" }]}
        data-testid="market-segment"
        aria-label="Sector correlation market"
        className="h-[24px] text-ui-micro min-w-[84px]"
      />
      <Select
        size="xs"
        value={String(currentLookback())}
        onChange={handleLookbackChange}
        data={LOOKBACK_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
        data-testid="lookback-segment"
        aria-label="Sector correlation lookback"
        className="h-[24px] text-ui-micro min-w-[64px]"
      />
      <Box className="flex-1" />
      <Show when={lastUpdated()}>
        <Box className="flex items-center gap-1">
          <IconClock size={12} className="text-fin-text-muted" />
          <Text size="xs" className="font-numeric tabular-nums font-mono">
            {new Date(lastUpdated()!).toLocaleTimeString()}
          </Text>
        </Box>
      </Show>
      <Box
        data-testid="sector-correlation-refresh"
        className="p-1 cursor-pointer flex items-center"
        onClick={handleRefresh}
      >
        <IconRefresh size={14} />
      </Box>
    </Box>
  );
}

function LoadingState() {
  return (
    <Box data-testid="sector-correlation-loading" className="flex items-center justify-center gap-2 flex-1 min-h-[200px]">
      <Loader size="xs" />
      <Text size="xs">Loading sector correlation…</Text>
    </Box>
  );
}

function ErrorState(props: { error: string }) {
  const handleRefresh = () => {
    void fetchCorrelationData();
  };
  return (
    <Box data-testid="sector-correlation-error" className="flex min-h-0 flex-1 items-center gap-2 p-2">
      <Text size="xs" c="error">
        {props.error}
      </Text>
      <Button variant="outline" color="error" size="xs" onClick={handleRefresh} className="h-[22px] text-ui-micro">
        Retry
      </Button>
    </Box>
  );
}

export function SectorCorrelationTab() {
  const store = useStoreSnapshot(subscribeToState, () => ({
    market: sectorMarket,
    lookbackDays,
    data: stateDataRaw,
    isLoading: stateLoadingFlag,
    error: stateErrorRaw,
  }));
  const { colorScheme } = useColorScheme();
  const isDark = () => colorScheme() === "dark";

  const sortedSectors = createMemo<SectorRow[]>(() => {
    const d = store().data;
    if (!d?.sectors) return [];
    return [...d.sectors].sort((a, b) => a.rank_current - b.rank_current);
  });

  onMount(() => {
    if (!store().data && !store().isLoading) void fetchCorrelationData();
  });

  const showLoading = () => store().isLoading && !store().data;
  const showError = () => !!store().error && !showLoading();
  const showEmpty = () =>
    !showLoading() && !showError() && (!store().data || !store().data!.sector_names || store().data!.sector_names.length === 0);

  return (
    <Box
      data-testid="sector-correlation-tab"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <Show when={!showLoading()} fallback={<LoadingState />}>
        <Show when={!showError()} fallback={<ErrorState error={store().error ?? ""} />}>
          <Show
            when={!showEmpty()}
            fallback={
              <Box data-testid="sector-correlation-empty" className="flex min-h-0 flex-1 items-center justify-center p-2">
                <Text size="xs" c="dimmed">
                  No correlation data available.
                </Text>
              </Box>
            }
          >
            <CorrelationHeader
              currentMarket={store().market}
              currentLookback={store().lookbackDays}
              lastUpdated={store().data?.last_updated}
            />
            <Box data-testid="sector-correlation-scroll" className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-1">
              <Stack spacing={0.5} className="w-full min-w-0">
                {/*
                 * The 10-column matrix gets the full row: at 900/1100 a
                 * 1.1fr/1fr split made it wider than its panel and clipped the
                 * last index. The two ranked boards share the row underneath on
                 * wide screens and stack below xl.
                 */}
                <div
                  data-testid="sector-correlation-grid"
                  className="grid min-w-0 grid-cols-1 items-start gap-1 xl:grid-cols-2"
                >
                  <CompactPanel
                    flush
                    padded={false}
                    id="sector-correlation-heatmap"
                    testId="sector-correlation-heatmap"
                    title={<Text className="text-ui-micro font-bold">Cross-Sector Correlation</Text>}
                    className={`${PANEL_CLASS} xl:col-span-2`}
                  >
                    <Box className="w-full min-w-0 p-1">
                      <CorrelationMatrixBoard
                        matrix={store().data!.correlation_matrix}
                        symbols={store().data!.sector_names}
                        isDark={isDark()}
                      />
                    </Box>
                  </CompactPanel>
                  <CompactPanel
                    scrollable
                    flush
                    padded={false}
                    id="sector-beta-chart"
                    testId="sector-beta-chart"
                    title={<Text className="text-ui-micro font-bold">Sector Beta vs Benchmark</Text>}
                    className={`${PANEL_CLASS} h-[320px]`}
                  >
                    <Box className="flex min-h-0 w-full flex-1 p-1">
                      <SectorBetaChart
                        sectors={sortedSectors()}
                        benchmark={store().market === "india" ? "NIFTY 50" : "SPY"}
                        isDark={isDark()}
                      />
                    </Box>
                  </CompactPanel>
                  <CompactPanel
                    scrollable
                    flush
                    padded={false}
                    id="rotation-timeline"
                    testId="rotation-timeline"
                    title={<Text className="text-ui-micro font-bold">Sector Rotation (1-Month Rank Change)</Text>}
                    className={`${PANEL_CLASS} h-[320px]`}
                  >
                    <Box className="flex min-h-0 w-full flex-1 p-1">
                      <RotationTimeline sectors={sortedSectors()} isDark={isDark()} />
                    </Box>
                  </CompactPanel>
                </div>
                <CompactPanel
                  flush
                  padded={false}
                  id="relative-strength-table"
                  testId="relative-strength-table"
                  title={<Text className="text-ui-micro font-bold">Relative Strength Rankings</Text>}
                  className={PANEL_CLASS}
                >
                  <Box className="w-full min-w-0 p-1">
                    <RelativeStrengthBoard sectors={sortedSectors()} isDark={isDark()} />
                  </Box>
                </CompactPanel>
              </Stack>
            </Box>
          </Show>
        </Show>
      </Show>
    </Box>
  );
}
