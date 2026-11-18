import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
  type Accessor,
} from "solid-js";
import { Box, Loader, Select, Text, ToolbarRow } from "@/ui";
import { fetchRotationOverview } from "@/api/rotation";
import { dedupeInFlight } from "@/api/requestDedupe";
import type {
  RotationKind,
  RotationOverviewResponse,
  RotationPeriod,
  RotationRow,
} from "@/types/rotation";
import { RotationRrg } from "../../sector/RotationRrg";
import { useSymbolDock } from "../../common/symbolDockContext";
import type { DockPanelContext, DockPanelSpec } from "../../dock/types";

/** Values are constrained by the API client's own types, not free-form strings. */
const KIND_OPTIONS: { value: RotationKind; label: string }[] = [
  { value: "sector", label: "Sectors" },
  { value: "industry", label: "Industries" },
  { value: "theme", label: "Themes" },
];

const PERIOD_OPTIONS: { value: RotationPeriod; label: string }[] = (
  ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"] as RotationPeriod[]
).map((value) => ({ value, label: value }));

function SectorRotationPanel(props: { ctx: Accessor<DockPanelContext> }) {
  const dock = useSymbolDock();
  const market = () => props.ctx().market ?? "india";
  const [kind, setKind] = createSignal<RotationKind>("sector");
  // The client has no `period` parameter — the backend sorts rows by it, so the
  // panel applies the same ordering locally from the returned period returns.
  const [period, setPeriod] = createSignal<RotationPeriod>("1M");
  const [data, setData] = createSignal<RotationOverviewResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  createEffect(() => {
    const m = market();
    const k = kind();
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    setLoading(true);
    setError(null);
    // Only identical (market, kind) flights are joined. Each window keeps its
    // own selects and its own AbortController, so two windows showing different
    // rotation groups still issue two independent requests.
    void dedupeInFlight(
      `rotation\u0000${m}\u0000${k}`,
      (signal) =>
        fetchRotationOverview({
          market: m,
          kind: k,
          minMembers: 1,
          limit: 48,
          signal,
        }),
      controller.signal,
    )
      .then((response) => {
        if (controller.signal.aborted || response === null) return;
        setData(response);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load rotation data");
        setData(null);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
      });
  });

  const rows = createMemo<RotationRow[]>(() => {
    const source = data()?.rows ?? [];
    const p = period();
    return [...source].sort((a, b) => (b.returns[p] ?? 0) - (a.returns[p] ?? 0));
  });

  const handleSelect = (id: string) => {
    setSelectedId(id);
    // A rotation row is a group, not an instrument. Its only real symbol is the
    // leading constituent; the theme `slug` is deliberately not passed to the
    // chart dock, which expects a ticker.
    const symbol = rows().find((row) => row.id === id)?.top_movers?.[0]?.symbol?.trim();
    if (symbol) dock.open(symbol, "chart", market());
  };

  return (
    <Box
      data-testid="sector-rotation-panel"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <ToolbarRow gap={8} className="shrink-0 gap-2 border-b border-fin-border px-2">
        <Text size="xs" fw={700} className="whitespace-nowrap">
          ROTATION
        </Text>
        <Select
          size="xs"
          h={24}
          w={104}
          aria-label="Rotation kind"
          data-testid="sector-rotation-kind"
          value={kind()}
          onChange={(value) => setKind((value as RotationKind) ?? "sector")}
          data={KIND_OPTIONS}
        />
        <Select
          size="xs"
          h={24}
          w={72}
          aria-label="Rotation period"
          data-testid="sector-rotation-period"
          value={period()}
          onChange={(value) => setPeriod((value as RotationPeriod) ?? "1M")}
          data={PERIOD_OPTIONS}
        />
        <Show when={loading() && data() != null}>
          <Loader size="xs" />
        </Show>
        <Box className="min-w-[8px] flex-1" />
      </ToolbarRow>

      <Switch>
        <Match when={error()}>
          <Box
            data-testid="sector-rotation-error"
            role="alert"
            className="flex min-h-0 flex-1 items-center justify-center p-3 text-center"
          >
            <Text size="xs" c="error">
              {error()}
            </Text>
          </Box>
        </Match>
        <Match when={loading() || !data()}>
          <Box
            data-testid="sector-rotation-loading"
            className="flex min-h-0 flex-1 items-center justify-center gap-2 p-2"
          >
            <Loader size="sm" />
            <Text size="xs" c="dimmed">
              Loading rotation…
            </Text>
          </Box>
        </Match>
        <Match when={rows().length === 0}>
          <Box
            data-testid="sector-rotation-empty"
            className="flex min-h-0 flex-1 items-center justify-center p-2"
          >
            <Text size="xs" c="dimmed">
              No {kind()} rotation groups.
            </Text>
          </Box>
        </Match>
        <Match when={true}>
          <Box className="flex min-h-0 min-w-0 flex-1 flex-col">
            <RotationRrg
              rows={rows()}
              selectedId={selectedId()}
              onSelect={handleSelect}
            />
          </Box>
        </Match>
      </Switch>
    </Box>
  );
}

export const SECTOR_ROTATION_PANEL: DockPanelSpec = {
  id: "sector.rotation",
  page: "sector",
  title: "SECTOR ROTATION",
  size: 1,
  minWidth: 320,
  singleton: false,
  requires: [],
  mount: (ctx) => <SectorRotationPanel ctx={ctx} />,
};
