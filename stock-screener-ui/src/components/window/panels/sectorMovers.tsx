import { createMemo, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { Box, Loader, Text, ToolbarRow } from "@/ui";
import type { StockMover } from "@/types/sector";
import type { InternalStockMover } from "../../sector/sectorUtils";
import { IntervalMoversTable } from "../../sector/IntervalMoversTable";
import type { DockPanelContext, DockPanelSpec } from "../../dock/types";
import { loadSectorData } from "@/state/sector";
import { attachSectorPanel, detachSectorPanel, useSectorPanelState } from "./sectorTable";

/** The feed carries change only for some rows; omit those rather than invent a delta. */
function toIntervalMovers(movers: StockMover[]): InternalStockMover[] {
  return movers.flatMap((mover) => {
    if (typeof mover.prev_change !== "number") return [];
    const delta = typeof mover.delta === "number" ? mover.delta : mover.change - mover.prev_change;
    return [{ ...mover, prev_change: mover.prev_change, delta }];
  });
}

function SectorMoversPanel() {
  const state = useSectorPanelState();
  const movers = createMemo(() => toIntervalMovers(state().data?.top_stock_movers ?? []));

  onMount(attachSectorPanel);
  onCleanup(detachSectorPanel);

  return (
    <Box data-testid="sector-movers-panel" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <ToolbarRow className="shrink-0 gap-2 border-b border-fin-border px-2">
        <Text size="xs" fw={600}>INTERVAL MOVERS</Text>
        <Text size="xs" c="dimmed" className="min-w-0 truncate">
          {state().market} · {movers().length} movers
        </Text>
      </ToolbarRow>

      <Box className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Show
          when={!state().loading || state().data != null}
          fallback={
            <Box data-testid="sector-movers-loading" className="flex min-h-0 flex-1 items-center justify-center gap-2 p-2">
              <Loader size="sm" />
              <Text size="xs" c="dimmed">Loading interval movers…</Text>
            </Box>
          }
        >
          <Show
            when={!state().error}
            fallback={
              <Box data-testid="sector-movers-error" role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center">
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
              when={movers().length > 0}
              fallback={
                <Box data-testid="sector-movers-empty" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-2">
                  <Text size="xs" c="dimmed">No interval movers for this market.</Text>
                  <button
                    type="button"
                    class="rounded-sm border border-fin-border px-2 text-[11px] text-fin-text hover:bg-fin-surface-alt"
                    data-testid="sector-movers-empty-retry"
                    onClick={() => void loadSectorData(state().market)}
                  >
                    Retry
                  </button>
                </Box>
              }
            >
              <IntervalMoversTable movers={movers()} />
            </Show>
          </Show>
        </Show>
      </Box>
    </Box>
  );
}

export const SECTOR_MOVERS_PANEL: DockPanelSpec = {
  id: "sector.movers",
  page: "sector",
  title: "INTERVAL MOVERS",
  size: 1,
  minWidth: 280,
  singleton: false,
  requires: [],
  mount: (_ctx: Accessor<DockPanelContext>) => <SectorMoversPanel />,
};
