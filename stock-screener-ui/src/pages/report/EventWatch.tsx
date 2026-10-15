import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert, Badge, Box, Button, Chip, Skeleton, Text, ToolbarRow } from "@/ui";
import { BORDER, SURFACE } from "@/ui/palette";
import { TanStackTable } from "@/components/common/TanStackTable";
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

export interface EventWatchProps {
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
      <Text size="xs" c="dimmed" span sx={{ fontVariantNumeric: "tabular-nums" }}>
        —
      </Text>
    );
  }
  return (
    <Text size="xs" c={color} span sx={{ fontVariantNumeric: "tabular-nums" }}>
      {format(value)}
    </Text>
  );
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        minWidth: 0,
        width: "100%",
        overflow: "hidden",
        border: 1,
        borderColor: BORDER,
        borderRadius: 1,
        bgcolor: SURFACE,
      }}
    >
      {children}
    </Box>
  );
}

export function EventWatch({ universe = "nifty500", days = 7, daily, onOpenSymbol }: EventWatchProps) {
  const [upcoming, setUpcoming] = useState<EventWatchResponse | null>(null);
  const [recent, setRecent] = useState<EventWatchResponse | null>(null);
  const [upcomingDone, setUpcomingDone] = useState(false);
  const [recentDone, setRecentDone] = useState(false);
  const [upcomingError, setUpcomingError] = useState<string | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Per-row copy-symbol (clipboard only — never touches paper-trading state).
  const handleCopy = useCallback(async (key: string, symbol: string) => {
    const ok = await copyToClipboard(symbol);
    setCopiedKey(ok ? key : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setUpcomingDone(false);
    setRecentDone(false);
    setUpcomingError(null);
    setRecentError(null);
    fetchUpcomingEvents(days, universe)
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
    fetchRecentEvents(universe)
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
    return () => {
      cancelled = true;
    };
  }, [days, universe]);

  const lookup = useMemo(() => buildTechLookup(daily), [daily]);

  const upcomingRows = useMemo(
    () => withTech(upcoming?.events ?? [], lookup),
    [upcoming, lookup],
  );
  const recentRows = useMemo(() => withTech(recent?.events ?? [], lookup), [recent, lookup]);

  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ev of [...upcomingRows, ...recentRows]) {
      const k = kindOf(ev);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [upcomingRows, recentRows]);

  const filterKeys = useMemo(() => {
    const keys = [...kindCounts.keys()].sort();
    return ["all", ...keys];
  }, [kindCounts]);

  const filteredUpcoming = useMemo(
    () => (kindFilter === "all" ? upcomingRows : upcomingRows.filter((r) => kindOf(r) === kindFilter)),
    [upcomingRows, kindFilter],
  );
  const filteredRecent = useMemo(
    () => (kindFilter === "all" ? recentRows : recentRows.filter((r) => kindOf(r) === kindFilter)),
    [recentRows, kindFilter],
  );

  const groupedUpcoming = useMemo(() => {
    const groups = new Map<string, EventWatchRow[]>();
    const sorted = [...filteredUpcoming].sort((a, b) => a.date.localeCompare(b.date));
    for (const row of sorted) {
      const list = groups.get(row.date) ?? [];
      list.push(row);
      groups.set(row.date, list);
    }
    return [...groups.entries()];
  }, [filteredUpcoming]);

  const buildColumns = useCallback(
    (prefix: string): ColumnDef<EventWatchRow>[] => [
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "symbol",
        meta: { align: "left" },
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
              <Text size="xs" fw={700} truncate span>
                {r.symbol}
              </Text>
              {r.name ? (
                <Text size="xs" c="dimmed" truncate span>
                  {r.name}
                </Text>
              ) : null}
            </Box>
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
          <Text size="xs" c="dimmed" truncate span title={row.original.title} sx={{ display: "block", maxWidth: 320 }}>
            {row.original.title}
          </Text>
        ),
      },
      {
        id: "price",
        header: "Price",
        accessorKey: "price",
        meta: { align: "right" },
        cell: ({ row }) => numCell(row.original.tech.price, (v) => formatCurrency(v, 2)),
      },
      {
        id: "chg",
        header: "Chg %",
        accessorKey: "chg",
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
        accessorKey: "vol",
        meta: { align: "right" },
        cell: ({ row }) =>
          numCell(row.original.tech.vol_ratio, (v) => `${v.toFixed(1)}x`),
      },
      {
        id: "dist52w",
        header: "52W %",
        accessorKey: "dist52w",
        meta: { align: "right" },
        cell: ({ row }) => {
          const v = row.original.tech.dist_52w_pct;
          return numCell(
            v,
            (x) => formatPercentage(x),
            v === undefined ? undefined : getPnLTextColor(-Math.abs(v) === 0 ? 0 : v),
          );
        },
      },
      {
        id: "accum",
        header: "Accum",
        accessorKey: "accum",
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
              {copiedKey === key ? "Copied!" : "Copy"}
            </Button>
          );
        },
      },
    ],
    [copiedKey, handleCopy],
  );

  const columns = useMemo(() => buildColumns("event-watch-upcoming"), [buildColumns]);

  const recentColumns = useMemo<ColumnDef<EventWatchRow>[]>(
    () => [
      {
        id: "date",
        header: "Date",
        accessorKey: "date",
        meta: { align: "left" },
        cell: ({ row }) => (
          <Text size="xs" c="dimmed" span sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {row.original.date}
          </Text>
        ),
      },
      ...buildColumns("event-watch-recent"),
    ],
    [buildColumns],
  );

  const loading = !upcomingDone || !recentDone;
  // Backward-compatible: both endpoints absent (null, no error) → render nothing.
  if (!loading && upcoming === null && recent === null && !upcomingError && !recentError) return null;

  const totalUpcoming = upcomingRows.length;
  const totalRecent = recentRows.length;

  return (
    <Box data-testid="event-watch" sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
      <ToolbarRow gap={8} wrap={false}>
        <Text size="sm" fw={700} span data-testid="event-watch-title">
          Next-week watchlist
        </Text>
        <Badge size="xs" data-testid="event-watch-upcoming-count">
          {totalUpcoming} scheduled
        </Badge>
        <Badge size="xs" data-testid="event-watch-recent-count">
          {totalRecent} fresh
        </Badge>
        <Box sx={{ flex: 1, minWidth: 0 }} />
      </ToolbarRow>

      {loading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }} data-testid="event-watch-loading">
          <Skeleton h={16} />
          <Skeleton h={16} />
        </Box>
      ) : (
        <>
          <ToolbarRow gap={4} wrap data-testid="event-watch-filters">
            {filterKeys.map((key) => (
              <Chip
                key={key}
                size="xs"
                checked={kindFilter === key}
                onChange={() => setKindFilter(key)}
                data-testid={`event-watch-filter-${key}`}
              >
                {key === "all"
                  ? `All (${totalUpcoming + totalRecent})`
                  : `${KIND_LABEL[key as EventWatchKind] ?? key} (${kindCounts.get(key) ?? 0})`}
              </Chip>
            ))}
          </ToolbarRow>

          {upcomingError ? (
            <Box data-testid="event-watch-upcoming-error">
              <Alert color="error" data-testid="event-watch-upcoming-error-alert">
                {upcomingError}
              </Alert>
            </Box>
          ) : upcoming !== null ? (
            <Box data-testid="event-watch-upcoming" sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <Text size="xs" fw={600} c="dimmed" span data-testid="event-watch-upcoming-title">
                Scheduled — results & event calendar
              </Text>
              {filteredUpcoming.length === 0 ? (
                <Box data-testid="event-watch-upcoming-empty">
                  <Text size="xs" c="dimmed">
                    No scheduled events{kindFilter !== "all" ? ` for ${KIND_LABEL[kindFilter as EventWatchKind] ?? kindFilter}` : ""}
                  </Text>
                </Box>
              ) : (
                groupedUpcoming.map(([date, rows]) => (
                  <Box key={date} sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
                    <ToolbarRow gap={8} wrap={false} data-testid={`event-watch-upcoming-group-${date}`}>
                      <Text size="xs" fw={700} span sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {date}
                      </Text>
                      <Badge size="xs">{rows.length}</Badge>
                    </ToolbarRow>
                    <TableWrap>
                      <TanStackTable
                        data={rows}
                        columns={columns}
                        dataTestId="event-watch-upcoming-table"
                        emptyMessage="No scheduled events"
                        stickyHeader
                        bare
                        onRowClick={onOpenSymbol ? (row) => onOpenSymbol(row.symbol) : undefined}
                        getRowTestId={(row) => `event-watch-upcoming-row-${row.symbol}-${row.kind}`}
                      />
                    </TableWrap>
                  </Box>
                ))
              )}
            </Box>
          ) : null}

          {recentError ? (
            <Box data-testid="event-watch-recent-error">
              <Alert color="error" data-testid="event-watch-recent-error-alert">
                {recentError}
              </Alert>
            </Box>
          ) : recent !== null ? (
            <Box data-testid="event-watch-recent" sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <Text size="xs" fw={600} c="dimmed" span data-testid="event-watch-recent-title">
                Fresh fuel — trailing-7d updates, QIPs, upgrades & orders
              </Text>
              {filteredRecent.length === 0 ? (
                <Box data-testid="event-watch-recent-empty">
                  <Text size="xs" c="dimmed">
                    No fresh events{kindFilter !== "all" ? ` for ${KIND_LABEL[kindFilter as EventWatchKind] ?? kindFilter}` : ""}
                  </Text>
                </Box>
              ) : (
                <TableWrap>
                  <TanStackTable
                    data={[...filteredRecent].sort((a, b) => b.date.localeCompare(a.date))}
                    columns={recentColumns}
                    dataTestId="event-watch-recent-table"
                    emptyMessage="No fresh events"
                    stickyHeader
                    bare
                    onRowClick={onOpenSymbol ? (row) => onOpenSymbol(row.symbol) : undefined}
                    getRowTestId={(row) => `event-watch-recent-row-${row.symbol}-${row.kind}`}
                  />
                </TableWrap>
              )}
            </Box>
          ) : null}
        </>
      )}
    </Box>
  );
}

export default EventWatch;
