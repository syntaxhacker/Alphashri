import { createMemo, onCleanup, onMount, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { Box, Loader, Text, ToolbarRow } from "@/ui";
import { loadSectorData } from "@/state/sector";
import type { SectorMarket } from "@/state/sector";
import { SectorTable } from "../../sector/SectorTable";
import { CompactToggle } from "../../sector/CompactToggle";
import type { DockPanelContext, DockPanelSpec } from "../../dock/types";
import {
  attachSectorPanel,
  detachSectorPanel,
  switchSectorMarket,
  useSectorPanelState,
} from "./sectorPanelStore";

export { attachSectorPanel, detachSectorPanel, switchSectorMarket, useSectorPanelState };

const MARKET_OPTIONS = [
  { value: "india", label: "India" },
  { value: "america", label: "America" },
] as const;

function SectorTablePanel() {
  const state = useSectorPanelState();
  const sectors = createMemo(() => state().data?.sectors ?? []);

  onMount(attachSectorPanel);
  onCleanup(detachSectorPanel);

  return (
    <Box data-testid="sector-table-panel" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <ToolbarRow className="shrink-0 gap-2 border-b border-fin-border px-2">
        <CompactToggle
          testId="sector-market-toggle"
          label="Sector market"
          value={state().market}
          options={MARKET_OPTIONS}
          onChange={(value) => switchSectorMarket(value as SectorMarket)}
        />
        <Text size="xs" c="dimmed" className="min-w-0 truncate">
          {state().market} · {sectors().length} sectors
        </Text>
      </ToolbarRow>

      <Box className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Show
          when={!state().loading || state().data != null}
          fallback={
            <Box data-testid="sector-table-loading" className="flex min-h-0 flex-1 items-center justify-center gap-2 p-2">
              <Loader size="sm" />
              <Text size="xs" c="dimmed">Loading sector performance…</Text>
            </Box>
          }
        >
          <Show
            when={!state().error}
            fallback={
              <Box data-testid="sector-table-error" role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center">
                <Text size="xs" c="error">{state().error}</Text>
                <button
                  type="button"
                  class="rounded-sm border border-fin-border px-2 text-[11px] text-fin-text hover:bg-fin-surface-alt"
                  onClick={() => void loadSectorData(state().market)}
                >
                  Retry
                </button>
              </Box>
            }
          >
            <Show
              when={sectors().length > 0}
              fallback={
                <Box data-testid="sector-table-empty" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-2">
                  <Text size="xs" c="dimmed">No sector data for this market.</Text>
                  <button
                    type="button"
                    class="rounded-sm border border-fin-border px-2 text-[11px] text-fin-text hover:bg-fin-surface-alt"
                    data-testid="sector-table-empty-retry"
                    onClick={() => void loadSectorData(state().market)}
                  >
                    Retry
                  </button>
                </Box>
              }
            >
              <SectorTable sectors={sectors()} />
            </Show>
          </Show>
        </Show>
      </Box>
    </Box>
  );
}

export const SECTOR_TABLE_PANEL: DockPanelSpec = {
  id: "sector.table",
  page: "sector",
  title: "SECTOR PERFORMANCE",
  size: 1,
  minWidth: 320,
  singleton: false,
  requires: [],
  mount: (_ctx: Accessor<DockPanelContext>) => <SectorTablePanel />,
};
