import { createMemo, Show } from "solid-js";
import { Box, Button, Loader, Select, Text, ToolbarRow } from "@/ui";
import { useStoreSubscription } from "@/hooks/useStoreSubscription";
import {
  getChartPatternsState,
  selectTimeframe,
  selectUniverse,
  subscribe,
  triggerScan,
} from "@/state/chartPatterns";
import { useSymbolDock } from "../../common/symbolDockContext";
import { PatternListView } from "../../patterns/PatternListView";
import type { DockPanelSpec } from "../../dock/types";

function PatternResultsPanel() {
  const dock = useSymbolDock();
  const version = useStoreSubscription(subscribe);
  const state = createMemo(() => {
    version();
    return getChartPatternsState();
  });

  // Both selects read the store's own registries — a new timeframe or universe
  // appears here without this panel knowing its id.
  const timeframeOptions = createMemo(() =>
    state().timeframes.map((tf) => ({ value: tf.id, label: tf.label })),
  );
  const universeOptions = createMemo(() =>
    state().universes.map((universe) => ({ value: universe.id, label: universe.label })),
  );
  const asOfLabel = createMemo(() => {
    const { dataThrough, lastScanAsOf } = state();
    return [
      dataThrough ? `Data through ${dataThrough}` : null,
      lastScanAsOf ? `As of ${lastScanAsOf}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  });

  return (
    <Box data-testid="patterns-results-panel" className="flex h-full min-h-0 min-w-0 flex-col">
      <Box className="shrink-0 border-b border-fin-border" data-testid="patterns-results-toolbar">
        <ToolbarRow gap={8} wrap={false} clip className="h-8 px-2">
          <Select
            size="xs"
            w={104}
            value={state().timeframe}
            onChange={(value) => value && selectTimeframe(value)}
            data={timeframeOptions()}
            aria-label="Pattern timeframe"
            data-testid="patterns-results-timeframe"
          />
          <Select
            size="xs"
            w={128}
            value={state().universe}
            onChange={(value) => value && selectUniverse(value)}
            data={universeOptions()}
            aria-label="Pattern universe"
            data-testid="patterns-results-universe"
          />
          <Button
            size="xs"
            variant="default"
            onClick={() => void triggerScan()}
            data-testid="patterns-results-scan"
          >
            Scan
          </Button>
          <Box className="min-w-0 flex-1" />
          <Text size="xs" c="dimmed" className="whitespace-nowrap" data-testid="patterns-results-total">
            {state().total} hits
          </Text>
        </ToolbarRow>
        <Show when={asOfLabel()}>
          <Box className="px-2 pb-1" data-testid="patterns-results-asof">
            <Text size="xs" c="dimmed" className="truncate">
              {asOfLabel()}
            </Text>
          </Box>
        </Show>
      </Box>

      <Box className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Show
          when={!state().error}
          fallback={
            <Box
              data-testid="patterns-results-error"
              role="alert"
              className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 p-3 text-center"
            >
              <Text size="xs" fw={600}>Patterns unavailable</Text>
              <Text size="xs" c="error">{state().error}</Text>
            </Box>
          }
        >
          <Show
            when={!state().scanning || state().results.length > 0}
            fallback={
              <Box
                data-testid="patterns-results-loading"
                className="flex min-h-0 flex-1 items-center justify-center gap-2 p-2"
              >
                <Loader size="sm" />
                <Text size="xs" c="dimmed">Scanning patterns…</Text>
              </Box>
            }
          >
            <Show
              when={state().results.length > 0}
              fallback={
                <Box
                  data-testid="patterns-results-empty"
                  className="flex min-h-0 flex-1 items-center justify-center p-2"
                >
                  <Text size="xs" c="dimmed">No patterns — run a scan</Text>
                </Box>
              }
            >
              <PatternListView
                hits={state().results}
                sort={state().filters.sort}
                onSelect={(hit) => dock.open(hit.symbol)}
                onSymbolOpen={(symbol) => dock.open(symbol)}
              />
            </Show>
          </Show>
        </Show>
      </Box>
    </Box>
  );
}

export const PATTERN_RESULTS_PANEL: DockPanelSpec = {
  id: "patterns.results",
  page: "patterns",
  title: "PATTERNS",
  size: 1.2,
  minWidth: 360,
  singleton: true,
  requires: [],
  mount: () => <PatternResultsPanel />,
};
