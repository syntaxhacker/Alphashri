import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import {
  Badge,
  Box,
  Button,
  SegmentedControl,
  Select,
  Text,
  ToolbarRow,
  useMediaQuery,
} from "@/ui";
import { EmptyState, ErrorAlert, InlineLoader } from "@/components/common/states";
import { TanStackTable, type TableColumnDef } from "@/components/common/TanStackTable";
import { IconRefresh } from "@/components/common/Icons";
import { useCatalystToday } from "@/state/catalystStore";
import { buildRadarColumns, joinOrDash, upper } from "./CatalystRadarPanel.columns";
import {
  CATALYST_FILTERS,
  confirmationText,
  confirmedCount,
  filterCatalystRows,
  formatIstClock,
  formatIstStamp,
  isSafeSourceUrl,
  isStale,
  rowSectorBreadth,
  sortCatalystRows,
  warningLabels,
  type CatalystBreadth,
  type CatalystFilter,
  type CatalystRowLike,
  type CatalystTodayView,
} from "./catalystRows";

export interface CatalystRadarPanelProps {
  /** Injectable clock so the stale state is testable without waiting. */
  now?: () => number;
}

/** One labelled line of the inline detail; label column stays fixed so rows scan. */
function DetailLine(props: { label: string; children: JSX.Element }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <Text
        component="span"
        c="dimmed"
        className="w-[64px] shrink-0 font-mono text-[9px] uppercase tracking-[0.08em]"
      >
        {props.label}
      </Text>
      <div className="min-w-0 flex-1 text-[11px] leading-snug text-fin-text">{props.children}</div>
    </div>
  );
}

function CatalystDetail(props: { row: CatalystRowLike; breadth: CatalystBreadth | null }) {
  const reasons = () => props.row.reasons ?? [];
  const invalidates = () => props.row.invalidates ?? [];
  const sourceUrl = () => (isSafeSourceUrl(props.row.source_url) ? props.row.source_url! : null);
  const meta = () =>
    joinOrDash([
      upper(props.row.kind, ""),
      props.row.first_seen ? `first seen ${formatIstStamp(props.row.first_seen)}` : null,
      props.row.event_at ? `event ${formatIstClock(props.row.event_at)}` : null,
    ]);

  return (
    <Box
      data-testid={`catalyst-detail-${props.row.symbol}`}
      className="flex flex-col gap-1 px-3 py-2 text-left"
    >
      <Text component="span" c="dimmed" className="text-[10px]">
        {meta()}
      </Text>

      <DetailLine label="Why now">
        <Show
          when={reasons().length > 0}
          fallback={<Text component="span" c="dimmed">No published reason.</Text>}
        >
          <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4">
            <For each={reasons()}>{(reason) => <li>{reason}</li>}</For>
          </ul>
        </Show>
      </DetailLine>

      <DetailLine label="Confirm">
        <Text
          component="span"
          className="font-mono tabular-nums"
          c={props.breadth != null || props.row.move_pct != null ? undefined : "dimmed"}
        >
          {confirmationText(props.row, props.breadth)}
        </Text>
      </DetailLine>

      <DetailLine label="Invalid">
        <Show
          when={invalidates().length > 0}
          fallback={<Text component="span" c="dimmed">No invalidation published.</Text>}
        >
          <ul className="m-0 flex list-disc flex-col gap-0.5 pl-4">
            <For each={invalidates()}>{(item) => <li>{item}</li>}</For>
          </ul>
        </Show>
      </DetailLine>

      <DetailLine label="Source">
        <Show
          when={sourceUrl()}
          fallback={<Text component="span" c="dimmed">{props.row.source || "No link published."}</Text>}
        >
          {(url) => (
            <a
              href={url()}
              target="_blank"
              rel="noopener noreferrer"
              class="cursor-pointer text-xs text-fin-primary hover:underline"
              data-testid={`catalyst-source-${props.row.symbol}`}
            >
              {props.row.source || url()}
            </a>
          )}
        </Show>
      </DetailLine>
    </Box>
  );
}

export function CatalystRadarPanel(props: CatalystRadarPanelProps) {
  const store = useCatalystToday();
  const [filter, setFilter] = createSignal<CatalystFilter>("all");
  const narrow = useMediaQuery("(max-width: 699px)", false);

  const now = () => props.now?.() ?? Date.now();

  // The panel renders a structural subset of the store payload and never
  // re-derives it; the cast keeps this panel decoupled from the API DTO module.
  const view = () => store.data() as CatalystTodayView | null;
  const rows = (): CatalystRowLike[] => (view()?.rows ?? []) as CatalystRowLike[];
  const sector = () => view()?.sector ?? null;

  const filteredRows = createMemo(() =>
    sortCatalystRows(
      filterCatalystRows(rows(), filter(), {
        sectorLabel: sector()?.label,
        sectorId: sector()?.id,
      }),
    ),
  );

  const confirmed = createMemo(() => confirmedCount(rows()));
  const total = createMemo(() => rows().length);
  const asOfLabel = createMemo(() => formatIstClock(view()?.as_of));
  const stale = createMemo(() => isStale(view()?.as_of, now()));
  const warnings = createMemo(() => warningLabels(view()?.warnings));

  const sectorSummary = () => {
    const current = sector();
    const label = current?.label ?? current?.id ?? null;
    if (!current || !label) return null;
    const change =
      typeof current.change_pct === "number" && Number.isFinite(current.change_pct)
        ? `${current.change_pct >= 0 ? "+" : ""}${current.change_pct.toFixed(2)}%`
        : null;
    return [label, change].filter((part): part is string => !!part).join(" ");
  };

  const sectorOptions = createMemo(() => {
    const options = store.sectors();
    if (options.length > 0) {
      return options.map((option) => ({ value: option.id, label: option.label }));
    }
    const fallback = sector()?.label ?? sector()?.id ?? store.sector().toUpperCase();
    return [{ value: store.sector(), label: fallback }];
  });

  const asOfText = () => {
    if (asOfLabel() === "—") return "AS OF —";
    return `${stale() ? "STALE" : "LIVE"} ${asOfLabel()} IST`;
  };

  const emptyCopy = () => {
    if (total() === 0) {
      return {
        title: "No catalysts in this session yet",
        description:
          "Rows appear only when a live source reports a dated catalyst. Nothing is fabricated.",
      };
    }
    const option = CATALYST_FILTERS.find((entry) => entry.value === filter());
    return {
      title: `No catalysts match ${option?.label ?? filter()}`,
      description: "Widen the filter to see the rest of the tape.",
    };
  };

  /**
   * TanStackTable owns expansion state and exposes its toggle only through the
   * cell context, so the whole-row click routes to the same toggle the chevron
   * uses. Keyed by row identity, so duplicate symbols stay distinct.
   */
  const rowToggles = new WeakMap<CatalystRowLike, () => void>();
  const toggleRow = (row: CatalystRowLike) => rowToggles.get(row)?.();

  const radarColumns = createMemo<TableColumnDef<CatalystRowLike>[]>(() =>
    buildRadarColumns({ narrow: narrow(), sector: sector(), rowToggles }),
  );

  const showInitialLoading = () => store.loading() && view() == null && !store.error();
  const showFatalError = () => !!store.error() && view() == null;

  return (
    <Box
      data-testid="catalyst-radar-panel"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <ToolbarRow
        gap={8}
        justify="flex-start"
        className="shrink-0 border-b border-fin-border bg-fin-surface px-2 py-1"
      >
        <Text
          component="span"
          fw={700}
          className="font-mono text-[10px] uppercase tracking-[0.08em]"
          data-testid="catalyst-title"
        >
          CATALYST RADAR
        </Text>

        <Badge
          size="xs"
          variant="dot"
          color={stale() ? "warning" : "primary"}
          data-testid="catalyst-asof"
        >
          {asOfText()}
        </Badge>

        <Badge size="xs" variant="dot" color="secondary" data-testid="catalyst-confirmed-count">
          {`CONFIRMED ${confirmed()}/${total()}`}
        </Badge>

        <Show when={sectorSummary()}>
          {(summary) => (
            <Text component="span" c="dimmed" className="text-[10px]" data-testid="catalyst-sector">
              {summary()}
            </Text>
          )}
        </Show>

        <Select
          size="xs"
          w={176}
          aria-label="Catalyst sector"
          data-testid="catalyst-sector-select"
          data={sectorOptions()}
          value={store.sector()}
          onChange={(value) => store.setSector(value ?? store.sector())}
          disabled={store.sectors().length === 0}
        />

        <SegmentedControl
          size="xs"
          data={CATALYST_FILTERS}
          value={filter()}
          onChange={(value) => setFilter(value as CatalystFilter)}
          data-testid="catalyst-filters"
        />

        <Box className="flex-1" />

        <Button
          size="xs"
          variant="subtle"
          loading={store.loading()}
          leftSection={<IconRefresh size={12} />}
          onClick={() => store.refresh()}
          data-testid="catalyst-refresh"
        >
          REFRESH
        </Button>
      </ToolbarRow>

      <Show when={warnings().length > 0}>
        <Box
          data-testid="catalyst-warnings"
          role="status"
          className="shrink-0 border-b border-fin-border bg-fin-surface-alt px-2 py-1"
        >
          <Text component="span" c="warning" className="text-[10px]">
            {`DEAD SOURCE — ${warnings().join(" · ")}. Some rows may be missing.`}
          </Text>
        </Box>
      </Show>

      <Show when={stale() && view() != null}>
        <Box
          data-testid="catalyst-stale"
          role="status"
          className="shrink-0 border-b border-fin-border bg-fin-surface-alt px-2 py-1"
        >
          <Text component="span" c="warning" className="text-[10px]">
            {`STALE — no update since ${asOfLabel()} IST. Showing the last good read.`}
          </Text>
        </Box>
      </Show>

      <Show when={!!store.error() && view() != null}>
        <Box
          data-testid="catalyst-error-inline"
          role="alert"
          className="flex shrink-0 items-center justify-between gap-2 border-b border-fin-border bg-fin-surface-alt px-2 py-1"
        >
          <Text component="span" c="error" className="min-w-0 truncate text-[10px]">
            {store.error()}
          </Text>
          <Button
            size="xs"
            variant="subtle"
            onClick={() => store.refresh()}
            data-testid="catalyst-error-inline-retry"
          >
            RETRY
          </Button>
        </Box>
      </Show>

      <Box className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Show
          when={!showFatalError()}
          fallback={
            <Box className="flex min-h-0 flex-1 items-start justify-center p-2">
              <ErrorAlert
                title="Catalyst feed unavailable"
                message={store.error() ?? "Unknown error"}
                withRetry
                onRetry={() => store.refresh()}
                data-testid="catalyst-error"
              />
            </Box>
          }
        >
          <Show
            when={!showInitialLoading()}
            fallback={
              <Box className="flex min-h-0 flex-1 items-center justify-center">
                <InlineLoader data-testid="catalyst-loading" message="Loading catalysts…" />
              </Box>
            }
          >
            <Show
              when={filteredRows().length > 0}
              fallback={
                <Box className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3">
                  <EmptyState
                    data-testid="catalyst-empty"
                    title={emptyCopy().title}
                    description={emptyCopy().description}
                  />
                  <Show when={total() > 0}>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => setFilter("all")}
                      data-testid="catalyst-empty-clear"
                    >
                      SHOW ALL
                    </Button>
                  </Show>
                </Box>
              }
            >
              <TanStackTable<CatalystRowLike>
                data={filteredRows()}
                columns={radarColumns()}
                dataTestId="catalyst-radar-table"
                ariaLabel="Catalyst radar"
                bare
                dense
                stickyHeader
                fillContainer
                rowWindowSize={80}
                minTableWidth={narrow() ? 354 : 520}
                getRowTestId={(row) => `catalyst-row-${row.symbol}`}
                onRowClick={toggleRow}
                getRowCanExpand={() => true}
                renderSubComponent={(row) => (
                  <CatalystDetail row={row} breadth={rowSectorBreadth(row, sector())} />
                )}
              />
            </Show>
          </Show>
        </Show>
      </Box>
    </Box>
  );
}
