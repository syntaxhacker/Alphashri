import { createMemo, onMount, Show, type Accessor } from "solid-js";
import { Box, Loader, Select, Text, ToolbarRow, useColorScheme } from "@/ui";
import { useStoreSubscription } from "@/hooks/useStoreSubscription";
import type { SectorCorrelationResponse } from "@/types/sector";
import {
  market as storeMarket,
  lookbackDays as storeLookbackDays,
  data as storeData,
  isLoading as storeIsLoading,
  error as storeError,
  subscribe,
  setMarket,
  setLookbackDays,
  fetchCorrelationData,
} from "@/state/sectorCorrelation";
import {
  CorrelationHeatmap,
  SectorBetaChart,
} from "../../sector/SectorCorrelationCharts";
import type { DockPanelContext, DockPanelSpec } from "../../dock/types";

/** The market union comes from the store binding, so it cannot drift from the API client. */
type CorrelationMarket = typeof storeMarket;

/** Canonical client options for the correlation controls (endpoint accepts 30–365 days). */
export const CORRELATION_MARKETS: ReadonlyArray<{ value: CorrelationMarket; label: string }> = [
  { value: "india", label: "India" },
  { value: "america", label: "US" },
];

export const CORRELATION_LOOKBACKS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 30, label: "1M" },
  { value: 90, label: "3M" },
  { value: 180, label: "6M" },
  { value: 365, label: "1Y" },
];

const BENCHMARK_BY_MARKET: Record<CorrelationMarket, string> = {
  india: "NIFTY 50",
  america: "SPY",
};

type CorrelationSnapshot = {
  market: CorrelationMarket;
  lookbackDays: number;
  data: SectorCorrelationResponse | null;
  isLoading: boolean;
  error: string | null;
};

function SectorCorrelationPanel() {
  const version = useStoreSubscription(subscribe);
  const state = createMemo<CorrelationSnapshot>(() => {
    version();
    return {
      market: storeMarket,
      lookbackDays: storeLookbackDays,
      data: storeData,
      isLoading: storeIsLoading,
      error: storeError,
    };
  });
  const { colorScheme } = useColorScheme();
  const isDark = () => colorScheme() === "dark";

  const sortedSectors = createMemo(() => {
    const sectors = state().data?.sectors;
    if (!sectors) return [];
    return [...sectors].sort((a, b) => a.rank_current - b.rank_current);
  });

  const showLoading = () => state().isLoading && !state().data;
  const showError = () => !!state().error && !showLoading();
  const showEmpty = () =>
    !showLoading() &&
    !showError() &&
    (!state().data || state().data!.sector_names.length === 0);

  // fetchCorrelationData() flips the store's isLoading synchronously (before its
  // first await). Read the live bindings, not the memo: a sibling panel mounting
  // in the same tick has a memo cached from before the flag flipped, but the
  // binding itself is already true. No module-level counter to leak between windows.
  onMount(() => {
    if (storeData || storeError || storeIsLoading) return;
    void fetchCorrelationData();
  });

  const onMarketChange = (value: string | null) => {
    if (!value || value === state().market) return;
    setMarket(value as CorrelationMarket);
    void fetchCorrelationData();
  };

  const onLookbackChange = (value: string | null) => {
    if (!value || Number(value) === state().lookbackDays) return;
    setLookbackDays(Number(value));
    void fetchCorrelationData();
  };

  return (
    <Box
      data-testid="window-sector-correlation"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <ToolbarRow className="shrink-0 gap-2 border-b border-fin-border px-2">
        <Text size="xs" fw={700} className="whitespace-nowrap">
          SECTOR CORRELATION
        </Text>
        <Select
          size="xs"
          h={24}
          w={92}
          data-testid="window-sector-correlation-market"
          aria-label="Correlation market"
          value={state().market}
          onChange={onMarketChange}
          data={CORRELATION_MARKETS.map((option) => ({ value: option.value, label: option.label }))}
        />
        <Select
          size="xs"
          h={24}
          w={72}
          data-testid="window-sector-correlation-lookback"
          aria-label="Correlation lookback"
          value={String(state().lookbackDays)}
          onChange={onLookbackChange}
          data={CORRELATION_LOOKBACKS.map((option) => ({ value: String(option.value), label: option.label }))}
        />
      </ToolbarRow>

      <Show
        when={!showLoading()}
        fallback={
          <Box
            data-testid="window-sector-correlation-loading"
            className="flex min-h-0 min-w-0 flex-1 items-center justify-center gap-2 p-2"
          >
            <Loader size="xs" />
            <Text size="xs" c="dimmed">
              Loading sector correlation…
            </Text>
          </Box>
        }
      >
        <Show
          when={!showError()}
          fallback={
            <Box
              data-testid="window-sector-correlation-error"
              role="alert"
              className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center"
            >
              <Text size="xs" c="error">
                {state().error}
              </Text>
              <button
                type="button"
                class="rounded-sm border border-fin-border px-2 text-[11px] text-fin-text hover:bg-fin-surface-alt"
                onClick={() => void fetchCorrelationData()}
              >
                Retry
              </button>
            </Box>
          }
        >
          <Show
            when={!showEmpty()}
            fallback={
              <Box
                data-testid="window-sector-correlation-empty"
                className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-2"
              >
                <Text size="xs" c="dimmed">
                  No correlation data available.
                </Text>
              </Box>
            }
          >
            {/*
              * Side-by-side when the window is wide enough. Stacking two
              * charts in a 396px window gave the heatmap ~200px, and ECharts
              * cannot fit an n×n grid plus both label axes in that — it
              * collapsed the plot to a 100px sliver with clipped sector
              * names. A row split gives each chart the full height and half
              * the width, which is the shape both of them want.
              */}
            <Box className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-1 overflow-auto p-1 min-[520px]:grid-cols-2">
              <Box
                data-testid="window-sector-correlation-heatmap"
                className="flex min-h-[300px] min-w-0 flex-col overflow-hidden"
              >
                <Text size="xs" fw={700} className="shrink-0">
                  Cross-Sector Correlation
                </Text>
                <Box className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                  <CorrelationHeatmap
                    matrix={state().data!.correlation_matrix}
                    symbols={state().data!.sector_names}
                    isDark={isDark()}
                    testId="window-sector-correlation-matrix"
                  />
                </Box>
              </Box>
              <Box
                data-testid="window-sector-correlation-beta"
                className="flex min-h-[220px] min-w-0 flex-col overflow-hidden"
              >
                <Text size="xs" fw={700} className="shrink-0">
                  Sector Beta vs Benchmark
                </Text>
                <Box className="flex min-h-0 min-w-0 flex-1">
                  <SectorBetaChart
                    sectors={sortedSectors()}
                    benchmark={BENCHMARK_BY_MARKET[state().market]}
                    isDark={isDark()}
                  />
                </Box>
              </Box>
            </Box>
          </Show>
        </Show>
      </Show>
    </Box>
  );
}

export const SECTOR_CORRELATION_PANEL: DockPanelSpec = {
  id: "sector.correlation",
  page: "sector",
  title: "SECTOR CORRELATION",
  size: 1,
  minWidth: 360,
  singleton: false,
  requires: [],
  mount: (_ctx: Accessor<DockPanelContext>) => <SectorCorrelationPanel />,
};
