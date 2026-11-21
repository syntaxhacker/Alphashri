import { createEffect, createMemo, createSignal, For, Show, onCleanup } from "solid-js";
import { Alert, Badge, Button, Chip, Skeleton, Text, ToolbarRow } from "@/ui";
import { TanStackTable, type TableColumnDef } from "@/components/common/TanStackTable";
import type { JSX } from "solid-js";
import { fetchRecentEvents, fetchUpcomingEvents } from "../../api/eventWatch";
import type {
  EventWatchEvent,
  EventWatchKind,
  EventWatchResponse,
  EventWatchRow,
  EventWatchTech,
} from "../../types/eventWatch";
import type { DailyMoveRow, DailyReportResponse } from "../../types/report";
import { copyToClipboard } from "../../utils/copyCsv";
import { formatCurrency, formatPercentage, getPnLTextColor } from "../../utils/ui-helpers";

interface EventWatchProps {
  universe?: string;
  days?: number;
  /** Daily report payload reused client-side for the technical snapshot. */
  daily?: DailyReportResponse | null;
  onOpenSymbol?: (symbol: string) => void;
}

const KIND_LABEL: Record<EventWatchKind, string> = {
  results: "Results",
  update: "Update",
  qip: "QIP",
  order: "Order",
  upgrade: "Upgrade",
  dividend: "Dividend",
  split: "Split",
  bonus: "Bonus",
  agm: "AGM",
};

const KIND_COLOR: Record<EventWatchKind, "info" | "success" | "warning" | "secondary" | "primary"> = {
  results: "info",
  update: "secondary",
  qip: "warning",
  order: "success",
  upgrade: "success",
  dividend: "success",
  split: "warning",
  bonus: "warning",
  agm: "primary",
};

function kindOf(ev: EventWatchEvent): EventWatchKind {
  return ev.kind;
}

/** Parse "3.2x vol" style sub_value into a volume ratio. */
function parseVolRatio(row: DailyMoveRow): number | undefined {
  const raw = `${row.sub_value ?? ""} ${row.sub_label ?? ""}`;
  const match = /([\d.]+)\s*x/i.exec(raw);
  if (!match) return undefined;
  const v = Number(match[1]);
  return Number.isFinite(v) ? v : undefined;
}

function buildTechLookup(daily: DailyReportResponse | null | undefined): Map<string, EventWatchTech> {
  const out = new Map<string, EventWatchTech>();
  if (!daily?.moves) return out;
  const accumSymbols = new Set<string>();
  for (const panel of ["volume_surge", "turnover"] as const) {
    for (const r of daily.moves[panel] ?? []) {
      const sym = (r.symbol ?? "").trim().toUpperCase();
      if (sym) accumSymbols.add(sym);
    }
  }
  const panels = Object.values(daily.moves) as DailyMoveRow[][];
  for (const rows of panels) {
    for (const r of rows ?? []) {
      const sym = (r.symbol ?? "").trim().toUpperCase();
      if (!sym || out.has(sym)) continue;
      const tech: EventWatchTech = { accum_ok: accumSymbols.has(sym) };
      if (typeof r.close === "number" && Number.isFinite(r.close)) tech.price = r.close;
      if (typeof r.change === "number" && Number.isFinite(r.change)) tech.chg_pct_5d = r.change;
      const vol = parseVolRatio(r);
      if (vol !== undefined) tech.vol_ratio = vol;
      if (
        typeof r.price_52_week_high === "number" &&
        Number.isFinite(r.price_52_week_high) &&
        r.price_52_week_high > 0 &&
        typeof r.close === "number" &&
        Number.isFinite(r.close)
      ) {
        tech.dist_52w_pct = ((r.close - r.price_52_week_high) / r.price_52_week_high) * 100;
      }
      out.set(sym, tech);
    }
  }
  return out;
}

function withTech(events: EventWatchEvent[], lookup: Map<string, EventWatchTech>): EventWatchRow[] {
  return events.map((ev) => ({
    ...ev,
    tech: lookup.get((ev.symbol ?? "").trim().toUpperCase()) ?? {},
  }));
}

function numCell(value: number | undefined, format: (v: number) => string, color?: "success" | "error") {
  if (value === undefined || !Number.isFinite(value)) {
    return (
      <Text size="xs" c="dimmed" span className="tabular-nums">
        —
      </Text>
    );
  }
  return (
    <Text size="xs" c={color} span className="tabular-nums">
      {format(value)}
    </Text>
  );
}

function TableWrap(props: { children: JSX.Element }) {
  return (
    <div
      class="min-w-0 w-full overflow-hidden border border-fin-border rounded-[1px] bg-fin-surface"
    >
      {props.children}
    </div>
  );
}

export function EventWatch(props: EventWatchProps) {
  const universe = () => props.universe ?? "nifty500";
  const days = () => props.days ?? 7;
  const [upcoming, setUpcoming] = createSignal<EventWatchResponse | null>(null);
  const [recent, setRecent] = createSignal<EventWatchResponse | null>(null);
  const [upcomingDone, setUpcomingDone] = createSignal(false);
  const [recentDone, setRecentDone] = createSignal(false);
  const [upcomingError, setUpcomingError] = createSignal<string | null>(null);
  const [recentError, setRecentError] = createSignal<string | null>(null);
  const [kindFilter, setKindFilter] = createSignal<string>("all");
  const [copiedKey, setCopiedKey] = createSignal<string | null>(null);

  const handleCopy = async (key: string, symbol: string) => {
    const ok = await copyToClipboard(symbol);
    setCopiedKey(ok ? key : null);
  };

  createEffect(() => {
    universe();
    days();
    let cancelled = false;
    setUpcomingDone(false);
    setRecentDone(false);
    setUpcomingError(null);
    setRecentError(null);
    fetchUpcomingEvents(days(), universe())
      .then((payload) => {
        if (cancelled) return;
        setUpcoming(payload);
        setUpcomingDone(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setUpcoming(null);
        setUpcomingError(err instanceof Error ? err.message : "Failed to load upcoming events");
        setUpcomingDone(true);
      });
    fetchRecentEvents(universe())
      .then((payload) => {
        if (cancelled) return;
        setRecent(payload);
        setRecentDone(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRecent(null);
        setRecentError(err instanceof Error ? err.message : "Failed to load recent events");
        setRecentDone(true);
      });
    onCleanup(() => {
      cancelled = true;
    });
  });

  const lookup = createMemo(() => buildTechLookup(props.daily));

  const upcomingRows = createMemo(
    () => withTech(upcoming()?.events ?? [], lookup()),
  );
  const recentRows = createMemo(() => withTech(recent()?.events ?? [], lookup()));

  const kindCounts = createMemo(() => {
    const counts = new Map<string, number>();
    for (const ev of [...upcomingRows(), ...recentRows()]) {
      const k = kindOf(ev);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  });

  const filterKeys = createMemo(() => {
    const keys = [...kindCounts().keys()].sort();
    return ["all", ...keys];
  });

  const filteredUpcoming = createMemo(
    () => (kindFilter() === "all" ? upcomingRows() : upcomingRows().filter((r) => kindOf(r) === kindFilter())),
  );
  const filteredRecent = createMemo(
    () => (kindFilter() === "all" ? recentRows() : recentRows().filter((r) => kindOf(r) === kindFilter())),
  );

  const groupedUpcoming = createMemo(() => {
    const groups = new Map<string, EventWatchRow[]>();
    const sorted = [...filteredUpcoming()].sort((a, b) => a.date.localeCompare(b.date));
    for (const row of sorted) {
      const list = groups.get(row.date) ?? [];
      list.push(row);
      groups.set(row.date, list);
    }
    return [...groups.entries()];
  });

  const buildColumns = (prefix: string): TableColumnDef<EventWatchRow>[] => [
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      meta: { align: "left" },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div class="min-w-0 flex flex-col">
            <Text size="xs" fw={700} truncate span>
              {r.symbol}
            </Text>
            <Show when={r.name}>
              <Text size="xs" c="dimmed" truncate span>
                {r.name}
              </Text>
            </Show>
          </div>
        );
      },
    },
    {
      id: "kind",
      header: "Kind",
      accessorKey: "kind",
      meta: { align: "center" },
      cell: ({ row }) => (
        <Badge size="xs" color={KIND_COLOR[kindOf(row.original)] ?? "secondary"}>
          {KIND_LABEL[kindOf(row.original)] ?? row.original.kind}
        </Badge>
      ),
    },
    {
      id: "title",
      header: "Event",
      accessorKey: "title",
      meta: { align: "left" },
      cell: ({ row }) => (
        <Text size="xs" c="dimmed" truncate span title={row.original.title} className="block max-w-[320px]">
          {row.original.title}
        </Text>
      ),
    },
    {
      id: "price",
      header: "Price",
      // The value lives under `tech`; an accessorKey of "price" made getValue
      // return undefined, so both sides coerced to 0 and the sort never moved.
      accessorFn: (row) => row.tech.price,
      meta: { align: "right" },
      cell: ({ row }) => numCell(row.original.tech.price, (v) => formatCurrency(v, 2)),
    },
    {
      id: "chg",
      header: "Chg %",
      accessorFn: (row) => row.tech.chg_pct_5d,
      meta: { align: "right" },
      cell: ({ row }) => {
        const v = row.original.tech.chg_pct_5d;
        return numCell(
          v,
          (x) => formatPercentage(x),
          v === undefined ? undefined : getPnLTextColor(v),
        );
      },
    },
    {
      id: "vol",
      header: "Vol ×",
      accessorFn: (row) => row.tech.vol_ratio,
      meta: { align: "right" },
      cell: ({ row }) =>
        numCell(row.original.tech.vol_ratio, (v) => `${v.toFixed(1)}x`),
    },
    {
      id: "dist52w",
      header: "52W %",
      accessorFn: (row) => row.tech.dist_52w_pct,
      meta: { align: "right" },
      cell: ({ row }) => {
        const v = row.original.tech.dist_52w_pct;
        return numCell(
          v,
          (x) => formatPercentage(x),
          v === undefined ? undefined : getPnLTextColor(v),
        );
      },
    },
    {
      id: "accum",
      header: "Accum",
      accessorFn: (row) => (row.tech.accum_ok ? 1 : 0),
      meta: { align: "center" },
      cell: ({ row }) =>
        row.original.tech.accum_ok ? (
          <Text size="xs" c="success" span>
            ✓
          </Text>
        ) : (
          <Text size="xs" c="dimmed" span>
            —
          </Text>
        ),
    },
    {
      id: "copy",
      header: "",
      meta: { align: "center" },
      cell: ({ row }) => {
        const r = row.original;
        const key = `${prefix}-row-${r.symbol}-${r.kind}`;
        return (
          <Button
            size="xs"
            variant="subtle"
            onClick={() => void handleCopy(key, r.symbol)}
            data-testid={`${key}-copy`}
            aria-label={`Copy ${r.symbol} symbol`}
          >
            {copiedKey() === key ? "Copied!" : "Copy"}
          </Button>
        );
      },
    },
  ];

  const columns = createMemo(() => buildColumns("event-watch-upcoming"));

  const recentColumns = createMemo<TableColumnDef<EventWatchRow>[]>(
    () => [
      {
        id: "date",
        header: "Date",
        accessorKey: "date",
        meta: { align: "left" },
        cell: ({ row }) => (
          <Text size="xs" c="dimmed" span className="tabular-nums whitespace-nowrap">
            {row.original.date}
          </Text>
        ),
      },
      ...buildColumns("event-watch-recent"),
    ],
  );

  const loading = () => !upcomingDone() || !recentDone();
  // Backward-compatible: both endpoints absent (null, no error) → render nothing.
  const renderNothing = () =>
    !loading() &&
    upcoming() === null &&
    recent() === null &&
    !upcomingError() &&
    !recentError();

  const totalUpcoming = () => upcomingRows().length;
  const totalRecent = () => recentRows().length;

  return (
    <Show when={!renderNothing()}>
      <div data-testid="event-watch" class="flex flex-col gap-2 min-w-0">
        <ToolbarRow gap={8} wrap={false}>
          <Text size="sm" fw={700} span data-testid="event-watch-title">
            Next-week watchlist
          </Text>
          <Badge size="xs" data-testid="event-watch-upcoming-count">
            {totalUpcoming()} scheduled
          </Badge>
          <Badge size="xs" data-testid="event-watch-recent-count">
            {totalRecent()} fresh
          </Badge>
          <div class="flex-1 min-w-0" />
        </ToolbarRow>

        <Show
          when={!loading()}
          fallback={
            <div class="flex flex-col gap-2" data-testid="event-watch-loading">
              <Skeleton h={16} />
              <Skeleton h={16} />
            </div>
          }
        >
          <ToolbarRow gap={4} wrap data-testid="event-watch-filters">
            <For each={filterKeys()}>
              {(key) => (
                <Chip
                  size="xs"
                  checked={kindFilter() === key}
                  onChange={() => setKindFilter(key)}
                  data-testid={`event-watch-filter-${key}`}
                >
                  {key === "all"
                    ? `All (${totalUpcoming() + totalRecent()})`
                    : `${KIND_LABEL[key as EventWatchKind] ?? key} (${kindCounts().get(key) ?? 0})`}
                </Chip>
              )}
            </For>
          </ToolbarRow>

          <Show when={upcomingError()}>
            <div data-testid="event-watch-upcoming-error">
              <Alert color="error" data-testid="event-watch-upcoming-error-alert">
                {upcomingError()}
              </Alert>
            </div>
          </Show>
          <Show when={!upcomingError() && upcoming() !== null}>
            <div data-testid="event-watch-upcoming" class="flex flex-col gap-2 min-w-0">
              <Text size="xs" fw={600} c="dimmed" span data-testid="event-watch-upcoming-title">
                Scheduled — results & event calendar
              </Text>
              <Show
                when={filteredUpcoming().length === 0}
                fallback={
                  <For each={groupedUpcoming()}>
                    {([date, rows]) => (
                      <div class="flex flex-col gap-1 min-w-0">
                        <ToolbarRow gap={8} wrap={false} data-testid={`event-watch-upcoming-group-${date}`}>
                          <Text size="xs" fw={700} span className="tabular-nums">
                            {date}
                          </Text>
                          <Badge size="xs">{rows.length}</Badge>
                        </ToolbarRow>
                        <TableWrap>
                          <TanStackTable
                            data={rows}
                            columns={columns()}
                            dataTestId="event-watch-upcoming-table"
                            emptyMessage="No scheduled events"
                            stickyHeader
                            bare
                            dense
                            onRowClick={props.onOpenSymbol ? (row) => props.onOpenSymbol!(row.symbol) : undefined}
                            getRowTestId={(row) => `event-watch-upcoming-row-${row.symbol}-${row.kind}`}
                          />
                        </TableWrap>
                      </div>
                    )}
                  </For>
                }
              >
                <div data-testid="event-watch-upcoming-empty">
                  <Text size="xs" c="dimmed">
                    No scheduled events{kindFilter() !== "all" ? ` for ${KIND_LABEL[kindFilter() as EventWatchKind] ?? kindFilter()}` : ""}
                  </Text>
                </div>
              </Show>
            </div>
          </Show>

          <Show when={recentError()}>
            <div data-testid="event-watch-recent-error">
              <Alert color="error" data-testid="event-watch-recent-error-alert">
                {recentError()}
              </Alert>
            </div>
          </Show>
          <Show when={!recentError() && recent() !== null}>
            <div data-testid="event-watch-recent" class="flex flex-col gap-2 min-w-0">
              <Text size="xs" fw={600} c="dimmed" span data-testid="event-watch-recent-title">
                Fresh fuel — trailing-7d updates, QIPs, upgrades & orders
              </Text>
              <Show
                when={filteredRecent().length === 0}
                fallback={
                  <TableWrap>
                    <TanStackTable
                      data={[...filteredRecent()].sort((a, b) => b.date.localeCompare(a.date))}
                      columns={recentColumns()}
                      dataTestId="event-watch-recent-table"
                      emptyMessage="No fresh events"
                      stickyHeader
                      bare
                      dense
                      onRowClick={props.onOpenSymbol ? (row) => props.onOpenSymbol!(row.symbol) : undefined}
                      getRowTestId={(row) => `event-watch-recent-row-${row.symbol}-${row.kind}`}
                    />
                  </TableWrap>
                }
              >
                <div data-testid="event-watch-recent-empty">
                  <Text size="xs" c="dimmed">
                    No fresh events{kindFilter() !== "all" ? ` for ${KIND_LABEL[kindFilter() as EventWatchKind] ?? kindFilter()}` : ""}
                  </Text>
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </Show>
  );
}

export default EventWatch;
