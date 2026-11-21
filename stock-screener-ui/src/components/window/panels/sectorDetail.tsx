import { createMemo, createSignal, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { Box, Loader, Select, Text, ToolbarRow } from "@/ui";
import { TanStackTable } from "@/components/common/TanStackTable";
import { numColumn, symbolColumn } from "@/components/table/columns";
import { useSymbolDock } from "../../common/symbolDockContext";
import type { DockPanelContext, DockPanelSpec } from "../../dock/types";
import { loadSectorData } from "@/state/sector";
import {
  attachSectorPanel,
  detachSectorPanel,
  useSectorPanelState,
} from "./sectorTable";

export interface SectorConstituent {
  symbol: string;
  change: number;
}

/**
 * The sector feed carries a sector's stocks only as a compact `SYM(+1.20%)`
 * string. No price, volume or full constituent list exists in the store, so
 * only symbol and change are surfaced here — never invented fields.
 */
export function parseSectorMovers(raw: string | undefined | null): SectorConstituent[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  const out: SectorConstituent[] = [];
  for (const match of raw.matchAll(/([A-Za-z0-9&._-]+)\(([+-]?\d+(?:\.\d+)?)%\)/g)) {
    const change = Number.parseFloat(match[2]);
    if (Number.isFinite(change)) out.push({ symbol: match[1], change });
  }
  return out;
}

function SectorDetailPanel() {
  const state = useSectorPanelState();
  const dock = useSymbolDock();
  const [selected, setSelected] = createSignal<string | null>(null);
  const sectors = createMemo(() => state().data?.sectors ?? []);
  const activeName = createMemo(() => {
    const list = sectors();
    const current = selected();
    return current !== null && list.some((s) => s.sector === current)
      ? current
      : (list[0]?.sector ?? null);
  });
  const activeSector = createMemo(() => sectors().find((s) => s.sector === activeName()) ?? null);
  const members = createMemo(() => parseSectorMovers(activeSector()?.top_movers));

  onMount(attachSectorPanel);
  onCleanup(detachSectorPanel);

  return (
    <Box data-testid="sector-detail-panel" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <ToolbarRow className="shrink-0 gap-2 border-b border-fin-border px-2">
        <Text size="xs" fw={600}>SECTOR DETAIL</Text>
        <Select
          size="xs"
          w={140}
          aria-label="Sector"
          data-testid="sector-detail-select"
          value={activeName() ?? ""}
          onChange={(value) => setSelected(value == null ? null : String(value))}
          data={sectors().map((sector) => ({ value: sector.sector, label: sector.sector }))}
        />
        <Text size="xs" c="dimmed" className="min-w-0 truncate">
          {activeSector() ? `${activeSector()!.stock_count} stocks · ${members().length} in feed` : "—"}
        </Text>
      </ToolbarRow>

      <Box className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Show
          when={!state().loading || state().data != null}
          fallback={
            <Box data-testid="sector-detail-loading" className="flex min-h-0 flex-1 items-center justify-center gap-2 p-2">
              <Loader size="sm" />
              <Text size="xs" c="dimmed">Loading sector detail…</Text>
            </Box>
          }
        >
          <Show
            when={!state().error}
            fallback={
              <Box data-testid="sector-detail-error" role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center">
                <Text size="xs" c="error">{state().error}</Text>
                <button
                  type="button"
                  data-testid="sector-detail-retry"
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
                <Box data-testid="sector-detail-no-sectors" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-2">
                  <Text size="xs" c="dimmed">No sectors in the feed for this market.</Text>
                </Box>
              }
            >
              <Show
                when={members().length > 0}
                fallback={
                  <Box data-testid="sector-detail-no-members" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center">
                    <Text size="xs" c="dimmed">
                      No constituent data in the sector feed for {activeName()}.
                    </Text>
                    <Text size="xs" c="dimmed">
                      This feed only carries top movers per sector.
                    </Text>
                  </Box>
                }
              >
                <TanStackTable<SectorConstituent>
                  data={members()}
                  columns={[
                    {
                      ...symbolColumn<SectorConstituent>({ id: "symbol", header: "Stock", size: 120 }),
                      meta: { align: "left" },
                    },
                    {
                      ...numColumn<SectorConstituent>({
                        id: "change",
                        header: "Change",
                        size: 88,
                        signed: true,
                        format: (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`,
                      }),
                      meta: { align: "right" },
                    },
                  ]}
                  enableSorting={false}
                  emptyMessage="No constituent data"
                  dataTestId="sector-detail-table"
                  getRowTestId={(row) => `sector-detail-row-${row.symbol}`}
                  onRowClick={(row) => dock.open(row.symbol)}
                  dense
                  fillContainer
                  style={{ "min-width": "100%" }}
                />
              </Show>
            </Show>
          </Show>
        </Show>
      </Box>
    </Box>
  );
}

export const SECTOR_DETAIL_PANEL: DockPanelSpec = {
  id: "sector.detail",
  page: "sector",
  title: "SECTOR DETAIL",
  size: 1,
  minWidth: 260,
  singleton: false,
  requires: [],
  mount: (_ctx: Accessor<DockPanelContext>) => <SectorDetailPanel />,
};
