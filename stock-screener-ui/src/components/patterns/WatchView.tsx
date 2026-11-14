import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import { Alert, Badge, Box, Loader, NumberInput, Select, Switch, Text, TextInput, ToolbarRow, Tooltip } from "@/ui";
import { TanStackTable } from "@/components/common/TanStackTable";
import { fetchMarketStatus, fetchWatch, fetchWatchSetups, streamWatch } from "@/api/chartPatterns";
import type { MarketStatus, WatchRow, WatchSetup } from "@/types/chartPatterns";
import type { WatchStreamMeta } from "@/api/chartPatterns";
import { formatCurrency, formatPercentage } from "@/utils/ui-helpers";
import type { CsvColumn } from "@/utils/copyCsv";
import { isMarketOpenIst } from "@/utils/marketClock";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { SymbolLink } from "@/components/common/SymbolLink";
import { PatternTags, hasTag, rowTags, shortIstDate } from "./rowBadges";

/** Re-fetch cadence for the watch list while the market is open. */
export const WATCH_POLL_MS = 60000;
/**
 * Auto-refresh the watch list while the market is open. Disabled for now — the
 * list reloads on the initial load, a filter change, or the REFRESH button.
 */
export const WATCH_AUTO_REFRESH = false;
/** Refresh cadence for the holiday-aware market-status probe. */
export const MARKET_STATUS_POLL_MS = 180000;
/** Re-render cadence for the snapshot-age label. Ticks `Date.now()` only — never fetches. */
export const WATCH_SNAPSHOT_TICK_MS = 30000;
/** Default "Within % of trigger" filter: open focused on actionable rows. */
export const WATCH_DEFAULT_WITHIN_PCT = 5;
/**
 * Default gate on the time-adjusted intraday volume (`vol_adj`).
 * Sent as `min_rel_volume`; the backend applies it to `vol_adj`.
 */
export const WATCH_DEFAULT_MIN_REL_VOLUME = 0.7;
/**
 * Empty-stream hint delay: when the stream has delivered no `item` for this
 * long, the loading panel adds a "Computing …" hint. Informational only —
 * the stream is never aborted because of it.
 */
export const WATCH_SLOW_HINT_MS = 8000;

/** Friendly labels for the known universe ids (singular matches ScanProgress). */
const WATCH_UNIVERSE_LABELS: Record<string, string> = {
  nifty50: "NIFTY 50",
  nifty100: "NIFTY 100",
  nifty200: "NIFTY 200",
  nifty500: "NIFTY 500",
  all_equity: "All NSE Equity",
  nse_fo: "NSE F&O",
};

/** Human label for a universe id; unknown ids fall back to the raw id. */
export function universeLabel(universe: string): string {
  return WATCH_UNIVERSE_LABELS[universe] ?? universe;
}

/**
 * Stream `meta` echo plus the optional armed `total`: the backend emits an
 * immediate first `meta` (setup + gate) and, after `arm()`, a second `meta`
 * carrying `total` so the UI can show `items.length / total`. Extended
 * locally so older backends (no `total`) keep working via the fallback.
 */
type WatchStreamMetaWithTotal = WatchStreamMeta & { total?: number | null };

/** IST offset, used only for the hh:mm snapshot stamp (not the session clock). */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Backend-supplied fields not yet in the canonical `WatchRow` type
 * (`src/types/chartPatterns.ts` is not owned here). Local extension only:
 * `trigger_date` is the 52W-high trigger date for `near_52w` rows,
 * `last_touch_date` the last time the 52W high was touched. (`tags` is read
 * via the shared `rowTags`/`hasTag` helpers instead.)
 */
type WatchRowExt = WatchRow & {
  trigger_date?: string | null;
  last_touch_date?: string | null;
};

/** 52W trigger date for `near_52w` rows (null/undefined = unknown). */
function triggerDateOf(row: WatchRow): string | null | undefined {
  return (row as WatchRowExt).trigger_date;
}

/** Last 52W-high touch date (null/undefined = never touched / unknown). */
function lastTouchDateOf(row: WatchRow): string | null | undefined {
  return (row as WatchRowExt).last_touch_date;
}

/**
 * True between 09:15–15:30 IST, Mon–Fri. Delegates to the shared NSE session
 * clock so the watch list and the daily report can never disagree.
 */
export function isWatchLiveNow(now: Date = new Date()): boolean {
  return isMarketOpenIst(now);
}

/**
 * Dimmed `snapshot HH:MM · Ns/m/h ago` label derived from the watch
 * `updated_at`. Returns null when `updated_at` is missing/invalid so the
 * caller omits the label. Pure + deterministic (`nowMs` injectable for tests).
 */
export function formatSnapshotAge(
  updatedAt: string | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!updatedAt) return null;
  const ts = new Date(updatedAt).getTime();
  if (!Number.isFinite(ts)) return null;
  const ist = new Date(ts + IST_OFFSET_MS);
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  const age =
    diffSec < 60
      ? `${diffSec}s ago`
      : diffSec < 3600
        ? `${Math.floor(diffSec / 60)}m ago`
        : `${Math.floor(diffSec / 3600)}h ago`;
  return `snapshot ${hh}:${mm} · ${age}`;
}

export interface WatchViewProps {
  universe: string;
  timeframe: string;
  minBaseDays?: number | null;
  onOpenSymbol?: (symbol: string) => void;
  /** Hover intent for the right-side preview (no-op on the Watch tab). */
  onSymbolPreview?: (symbol: string) => void;
  onSymbolPreviewEnd?: (symbol: string) => void;
}

function stateColor(state: WatchRow["state"]): "success" | "default" | "dimmed" {
  if (state === "triggered") return "success";
  if (state === "invalidated") return "dimmed";
  return "default";
}

function stateCell(ctx: { column?: { accessorKey?: unknown }; row: { original: WatchRow } }) {
  const state = ctxGet(ctx) as WatchRow["state"];
  const row = ctx.row.original as WatchRow;
  const lastTouch = lastTouchDateOf(row);
  return (
    <Box className="inline-flex items-center gap-1">
      <Badge color={stateColor(state)} size="xs" data-testid={`watch-state-${state}`}>
        {state}
      </Badge>
      {row.fresh ? (
        <Badge color="success" size="xs" data-testid={`watch-fresh-${row.symbol}`}>
          fresh
        </Badge>
      ) : null}
      {row.touched ? (
        <Badge color="info" size="xs" data-testid={`watch-touched-${row.symbol}`}>
          touched
        </Badge>
      ) : lastTouch ? (
        <Badge
          color="info"
          size="xs"
          data-testid={`watch-last-touch-${row.symbol}`}
          title={`52W high touched ${lastTouch}`}
        >
          touched {shortIstDate(lastTouch)}
        </Badge>
      ) : null}
    </Box>
  );
}

type WatchCellContext = { row: { original: WatchRow } };

/** Read a cell's field off the row using the column's accessorKey, mirroring
 * the TanStack `getValue()` ctx the columns were written against. */
const ctxGet = (ctx: { column?: { accessorKey?: unknown }; row: { original: WatchRow } }): unknown => {
  const key = ctx.column?.accessorKey;
  return typeof key === "string" ? (ctx.row.original as unknown as Record<string, unknown>)[key] : undefined;
};

/** Symbol label shared by every setup table, plus F&O/ETF tag badges. */
const symbolCell = (ctx: WatchCellContext) => {
  const row = ctx.row.original as WatchRow;
  return (
    <Box className="inline-flex min-w-0 items-center gap-1">
      <Text size="sm" fw={600}>
        {String(ctxGet(ctx))}
      </Text>
      <PatternTags tags={rowTags(row)} symbol={row.symbol} testIdPrefix="watch" compact />
    </Box>
  );
};

/** Rupee price with two decimals. */
const priceCell = (ctx: WatchCellContext) => (
  <span>{formatCurrency(Number(ctxGet(ctx) ?? 0), 2)}</span>
);

/**
 * `near_52w` 52W-high cell: the numeric trigger value stays, and when the
 * backend supplies `trigger_date` the date renders next to it (title carries
 * the full "52W high ₹X · YYYY-MM-DD" caption). No date → plain price.
 */
const high52wCell = (ctx: WatchCellContext) => {
  const row = ctx.row.original as WatchRow;
  const price = formatCurrency(Number(ctxGet(ctx) ?? 0), 2);
  const triggerDate = triggerDateOf(row);
  if (!triggerDate) return <span>{price}</span>;
  return (
    <Box className="inline-flex items-baseline gap-1">
      <span title={`52W high ${price} · ${triggerDate}`}>{price}</span>
      <Text size="xs" c="dimmed" data-testid={`watch-trigger-date-${row.symbol}`}>
        {triggerDate}
      </Text>
    </Box>
  );
};

/** Bare two-decimal number (OBV slope, up/down ratio). */
const plainNumberCell = (ctx: WatchCellContext) => {
  const raw = ctxGet(ctx) as number | null | undefined;
  if (raw == null) return <span>-</span>;
  return <span>{Number(raw).toFixed(2)}</span>;
};

/** `1.23x` multiple, dash when missing. */
const ratioCell = (ctx: WatchCellContext) => {
  const raw = ctxGet(ctx) as number | null | undefined;
  if (raw == null) return <span>-</span>;
  return <span>{`${Number(raw).toFixed(2)}x`}</span>;
};

/** Time-adjusted volume multiple; greens once it clears 1x. */
const volAdjCell = (ctx: WatchCellContext) => {
  const row = ctx.row.original as WatchRow;
  const raw = ctxGet(ctx) as number | null | undefined;
  if (raw == null) return <span data-testid={`watch-vol-adj-${row.symbol}`}>—</span>;
  const v = Number(raw);
  return (
    <Text size="sm" c={v >= 1 ? "success" : undefined}>
      <span data-testid={`watch-vol-adj-${row.symbol}`}>{`${v.toFixed(2)}x`}</span>
    </Text>
  );
};

/** Identical first two columns of every setup registry. */
const SYMBOL_COLUMN: TableColumnDef<WatchRow> = {
  id: "symbol",
  header: "Symbol",
  accessorKey: "symbol",
  meta: { align: "left" },
  cell: (ctx) => symbolCell(ctx),
};

const STATE_COLUMN: TableColumnDef<WatchRow> = {
  id: "state",
  header: "State",
  accessorKey: "state",
  meta: { align: "center" },
  cell: (ctx) => stateCell({ column: ctx.column, row: { original: ctx.row.original as WatchRow } }),
};

const BREAKOUT_COLUMNS: TableColumnDef<WatchRow>[] = [
  SYMBOL_COLUMN,
  STATE_COLUMN,
  {
    id: "ltp",
    header: "LTP",
    accessorKey: "ltp",
    meta: { align: "right" },
    cell: (ctx) => priceCell(ctx),
  },
  {
    id: "trigger",
    header: "Trigger",
    accessorKey: "trigger_level",
    meta: { align: "right" },
    cell: (ctx) => priceCell(ctx),
  },
  {
    id: "pct_to_trigger",
    header: "% to trigger",
    accessorKey: "pct_to_trigger",
    meta: { align: "right" },
    cell: (ctx) => {
      const v = Number(ctxGet(ctx) ?? 0);
      return (
        <Text size="sm" c={v >= 0 ? "success" : "error"}>
          {formatPercentage(v)}
        </Text>
      );
    },
  },
  {
    id: "rel_volume",
    header: "Rel vol",
    accessorKey: "rel_volume",
    meta: { align: "right" },
    cell: (ctx) => ratioCell(ctx),
  },
  {
    id: "vol_adj",
    header: "Vol (adj)",
    accessorKey: "vol_adj",
    meta: { align: "right" },
    cell: (ctx) => volAdjCell(ctx),
  },
  {
    id: "base_days",
    header: "Base (d)",
    accessorKey: "base_days",
    meta: { align: "right" },
    cell: (ctx) => <span>{String(ctxGet(ctx) ?? "-")}</span>,
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    meta: { align: "center" },
    cell: (ctx) => {
      const status = String(ctxGet(ctx) ?? "");
      return (
        <Badge color="default" size="xs" data-testid={`watch-status-${status || "unknown"}`}>
          {status || "-"}
        </Badge>
      );
    },
  },
];

/** `near_52w` accumulation columns: 52W-high proximity + accumulation gauges. */
const NEAR_52W_COLUMNS: TableColumnDef<WatchRow>[] = [
  SYMBOL_COLUMN,
  STATE_COLUMN,
  {
    id: "ltp",
    header: "LTP",
    accessorKey: "ltp",
    meta: { align: "right" },
    cell: (ctx) => priceCell(ctx),
  },
  {
    id: "high_52w",
    header: "52W high",
    accessorKey: "trigger_level",
    meta: { align: "right" },
    cell: (ctx) => high52wCell(ctx),
  },
  {
    id: "high_gap",
    header: "Hi gap %",
    accessorKey: "high_gap",
    meta: { align: "right" },
    cell: (ctx) => {
      const raw = ctxGet(ctx) as number | null | undefined;
      if (raw == null) return <span>-</span>;
      const v = Number(raw);
      return (
        <Text size="sm" c={v <= 0 ? "success" : undefined}>
          {formatPercentage(v)}
        </Text>
      );
    },
  },
  {
    id: "close_gap",
    header: "Close gap %",
    accessorKey: "close_gap",
    meta: { align: "right" },
    cell: (ctx) => {
      const raw = ctxGet(ctx) as number | null | undefined;
      if (raw == null) return <span>-</span>;
      return <span>{formatPercentage(Number(raw))}</span>;
    },
  },
  {
    id: "obv_slope",
    header: "OBV",
    accessorKey: "obv_slope",
    meta: { align: "right" },
    cell: (ctx) => plainNumberCell(ctx),
  },
  {
    id: "updown",
    header: "Up/Dn",
    accessorKey: "updown",
    meta: { align: "right" },
    cell: (ctx) => plainNumberCell(ctx),
  },
  {
    id: "vol_ratio",
    header: "VolR",
    accessorKey: "vol_ratio",
    meta: { align: "right" },
    cell: (ctx) => ratioCell(ctx),
  },
  {
    id: "rising_lows",
    header: "Lows",
    accessorKey: "rising_lows",
    meta: { align: "center" },
    cell: (ctx) => {
      const row = ctx.row.original as WatchRow;
      return row.rising_lows ? (
        <Badge color="success" size="xs" data-testid={`watch-lows-${row.symbol}`}>
          ↑↑
        </Badge>
      ) : (
        <span data-testid={`watch-lows-${row.symbol}`}>—</span>
      );
    },
  },
  {
    id: "rel_volume",
    header: "Rel vol",
    accessorKey: "rel_volume",
    meta: { align: "right" },
    cell: (ctx) => ratioCell(ctx),
  },
  {
    id: "vol_adj",
    header: "Vol (adj)",
    accessorKey: "vol_adj",
    meta: { align: "right" },
    cell: (ctx) => volAdjCell(ctx),
  },
];

/**
 * Setup-aware column registry. Adding a future setup is one entry here plus
 * its default sort in `SORT_BY_SETUP`.
 */
export const COLUMNS_BY_SETUP: Record<string, TableColumnDef<WatchRow>[]> = {
  breakout: BREAKOUT_COLUMNS,
  near_52w: NEAR_52W_COLUMNS,
};

/** Default sort per setup: breakout = most advanced first, near_52w = nearest close first. */
export const SORT_BY_SETUP: Record<string, Array<{ id: string; desc: boolean }>> = {
  breakout: [{ id: "pct_to_trigger", desc: true }],
  near_52w: [{ id: "close_gap", desc: false }],
};

/** Columns for the active setup (falls back to the generic breakout columns). */
export function columnsFor(setup: string): TableColumnDef<WatchRow>[] {
  return COLUMNS_BY_SETUP[setup] ?? BREAKOUT_COLUMNS;
}

/**
 * CSV column mapping for the active setup: same keys/headers as the table so
 * the copied CSV matches the visible columns.
 */
export function watchCsvColumns(setup: string): CsvColumn[] {
  return columnsFor(setup).map((col) => {
    const accessorKey = (col as { accessorKey?: unknown }).accessorKey;
    const key = typeof accessorKey === "string" ? accessorKey : (col.id ?? "");
    const header = typeof col.header === "string" ? col.header : (col.id ?? key);
    return { key, header };
  });
}

/** Default `TanStackTable` sorting for the active setup. */
export function sortFor(setup: string): Array<{ id: string; desc: boolean }> {
  return SORT_BY_SETUP[setup] ?? SORT_BY_SETUP.breakout;
}

/**
 * Breakout Watch tab body: setup picker + rel-vol filter + live watch table.
 * Polls `/watch` every 20s while the market is open. Liveness is gated on the
 * holiday-aware `/market-status` probe (`open === true`); the IST 09:15–15:30
 * Mon–Fri clock is only a fallback when that probe fails.
 */
export function WatchView(props: WatchViewProps) {
  const universe = () => props.universe;
  const timeframe = () => props.timeframe;
  const minBaseDays = () => props.minBaseDays ?? null;

  const [setups, setSetups] = createSignal<WatchSetup[]>([]);
  const [setup, setSetup] = createSignal("breakout");
  const [relVol, setRelVol] = createSignal<number | string>(WATCH_DEFAULT_MIN_REL_VOLUME);
  const [relVolDefaulted, setRelVolDefaulted] = createSignal(false);
  const [items, setItems] = createSignal<WatchRow[]>([]);
  const [updatedAt, setUpdatedAt] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [refreshing, setRefreshing] = createSignal(false);
  /** True while a `/watch/stream` connection is still appending rows. */
  const [streaming, setStreaming] = createSignal(false);
  /** Stream `meta` echo (setup + gate + optional total), shown as soon as it arrives. */
  const [streamMeta, setStreamMeta] = createSignal<WatchStreamMetaWithTotal | null>(null);
  /** True once the empty-stream "Computing …" hint becomes relevant. */
  const [showSlowHint, setShowSlowHint] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [live, setLive] = createSignal(isWatchLiveNow());
  // Holiday-aware market status (server clock wins over the client clock).
  // Null = probe unavailable/failed → fall back to `isWatchLiveNow()`.
  const [marketStatus, setMarketStatus] = createSignal<MarketStatus | null>(null);
  let marketStatusRef: MarketStatus | null = null;
  // Client-side quick filters over the loaded rows (instant, no refetch).
  const [search, setSearch] = createSignal("");
  const [stateFilter, setStateFilter] = createSignal<WatchRow["state"] | "all">("all");
  const [withinPct, setWithinPct] = createSignal<number | string>(WATCH_DEFAULT_WITHIN_PCT);
  const [hideInvalidated, setHideInvalidated] = createSignal(true);
  /** Hide ETF-tagged rows by default (the All NSE Equity 52W list is ETF-heavy). */
  const [hideEtfs, setHideEtfs] = createSignal(true);
  let requestRef = 0;
  let streamControllerRef: AbortController | null = null;

  // Abort any in-flight stream when the view unmounts.
  onCleanup(() => {
    streamControllerRef?.abort();
  });

  // Clock for the snapshot-age label only: recomputes the relative age string,
  // never fetches (polling stays OFF via WATCH_AUTO_REFRESH).
  const [nowMs, setNowMs] = createSignal(Date.now());
  onMount(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), WATCH_SNAPSHOT_TICK_MS);
    onCleanup(() => window.clearInterval(timer));
  });
  // Empty-stream hint: while `streaming` with no `item` yet, surface the
  // "Computing …" hint after WATCH_SLOW_HINT_MS. Informational only — the
  // stream keeps running and is never aborted because of the timer.
  createEffect(() => {
    if (!streaming() || items().length !== 0) {
      setShowSlowHint(false);
      return;
    }
    const timer = window.setTimeout(() => setShowSlowHint(true), WATCH_SLOW_HINT_MS);
    onCleanup(() => window.clearTimeout(timer));
  });
  // Load the setup registry once; adopt the active setup's default rel-vol.
  onMount(() => {
    let active = true;
    fetchWatchSetups()
      .then((list) => {
        if (!active) return;
        setSetups(list);
        const current = list.find((s) => s.id === "breakout") ?? list[0] ?? null;
        if (current) {
          setSetup((prev) => (list.some((s) => s.id === prev) ? prev : current.id));
          if (!relVolDefaulted()) {
            setRelVol(current.default_min_rel_volume ?? WATCH_DEFAULT_MIN_REL_VOLUME);
            setRelVolDefaulted(true);
          }
        }
      })
      .catch(() => {
        if (active) setSetups([]);
      });
    onCleanup(() => {
      active = false;
    });
  });

  const minRelVolume = () => {
    const v = relVol();
    return typeof v === "number" ? v : Number(v) || null;
  };

  const load = async (background: boolean) => {
      const token = requestRef + 1;
      requestRef = token;
      streamControllerRef?.abort();
      const controller = new AbortController();
      streamControllerRef = controller;
      if (background) setRefreshing(true);
      else {
        setLoading(true);
        setItems([]);
      }
      setError(null);
      setStreaming(false);
      setStreamMeta(null);
      const query = { setup: setup(), universe: universe(), timeframe: timeframe(), minBaseDays: minBaseDays(), minRelVolume: minRelVolume() };

      // Progressive path: append rows as they arrive (`meta` first, then one
      // `item` per row, then `done`). The 60s poll / Refresh just restart the
      // stream. Any stream failure falls back to the plain `GET /watch` fetch.
      {
        const streamed: WatchRow[] = [];
        let streamOk = false;
        let streamFailed = false;
        setStreaming(true);
        try {
          await streamWatch(query, {
            signal: controller.signal,
            onMeta: (meta) => {
              if (requestRef !== token) return;
              setStreamMeta(meta);
              if (meta.updated_at) setUpdatedAt(meta.updated_at);
            },
            onItem: (row) => {
              if (requestRef !== token) return;
              streamed.push(row);
              setItems([...streamed]);
              // First row renders before `done`: drop the full-page spinner
              // while the stream keeps appending.
              if (!background) setLoading(false);
            },
            onDone: () => {
              streamOk = true;
            },
            onError: () => {
              streamFailed = true;
            },
          });
        } catch {
          streamFailed = true;
        }
        if (requestRef !== token) return;
        if (controller.signal.aborted) {
          if (background) setRefreshing(false);
          else setLoading(false);
          setStreaming(false);
          return;
        }
        if (streamOk && !streamFailed) {
          setStreaming(false);
          setRefreshing(false);
          setLoading(false);
          setError(null);
          return;
        }
        // Stream failed: fall through to the non-streaming fetch below.
      }

      try {
        const payload = await fetchWatch(query);
        if (requestRef !== token) return;
        setItems(payload.items ?? []);
        setUpdatedAt(payload.updated_at ?? null);
        setError(null);
      } catch (err) {
        if (requestRef !== token) return;
        setError(err instanceof Error && err.message ? err.message : "Failed to load watch list");
      } finally {
        if (requestRef === token) {
          setStreaming(false);
          if (background) setRefreshing(false);
          else setLoading(false);
        }
      }
    };

  // Initial + filter-driven load. `load` reads setup/universe/… signals
  // synchronously, so the effect re-runs exactly when those change.
  createEffect(() => {
    void load(false);
  });


  // Holiday-aware market status: fetched once on mount, refreshed every
  // MARKET_STATUS_POLL_MS (3 min). While available it gates the live badge + the
  // live poll; when the probe fails we fall back to the client-side IST clock.
  onMount(() => {
    let active = true;
    const refreshStatus = (): Promise<void> =>
      fetchMarketStatus()
        .then((status) => {
          if (!active) return;
          marketStatusRef = status;
          setMarketStatus(status);
          setLive(status.open);
        })
        .catch(() => {
          if (!active) return;
          marketStatusRef = null;
          setMarketStatus(null);
          setLive(isWatchLiveNow());
        });
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), MARKET_STATUS_POLL_MS);
    onCleanup(() => {
      active = false;
      window.clearInterval(timer);
    });
  });

  // Live badge + (optional) polling. Auto-refresh is disabled via
  // `WATCH_AUTO_REFRESH` — when off, the list only reloads on the initial load,
  // a filter change, or the REFRESH button.
  onMount(() => {
    const tickLive = (): boolean => {
      const server = marketStatusRef;
      const open = server ? server.open : isWatchLiveNow();
      setLive(open);
      return open;
    };
    setLive(tickLive());
    if (!WATCH_AUTO_REFRESH) return;
    const timer = window.setInterval(() => {
      if (tickLive()) void load(true);
    }, WATCH_POLL_MS);
    onCleanup(() => window.clearInterval(timer));
  });

  const setupOptions = createMemo(() =>
    setups().map((s) => ({ value: s.id, label: s.label })),
  );
  const activeSetup = () => setups().find((s) => s.id === setup()) ?? null;

  const filtered = createMemo(() => {
    const q = search().trim().toUpperCase();
    const maxAbs = typeof withinPct() === "number" ? (withinPct() as number) : null;
    // `near_52w` rows carry no `pct_to_trigger`; filter on `close_gap` instead.
    const distanceOf = (row: WatchRow): number | null | undefined =>
      setup() === "near_52w" ? row.close_gap : row.pct_to_trigger;
    return items().filter((row) => {
      // Client-side ETF gate first: ETF rows are excluded before the
      // search/state/distance filters. `filtered.length` (and the count
      // label) therefore already reflect the hiding.
      if (hideEtfs() && hasTag(row, "ETF")) return false;
      if (q && !String(row.symbol || "").toUpperCase().includes(q)) return false;
      if (hideInvalidated() && row.state === "invalidated") return false;
      if (stateFilter() !== "all" && row.state !== stateFilter()) return false;
      if (maxAbs != null) {
        const pct = distanceOf(row);
        if (pct == null || Math.abs(pct) > maxAbs) return false;
      }
      return true;
    });
  });

  const columns = createMemo(() => {
    const base = columnsFor(setup());
    if (!props.onOpenSymbol) return base;
    return base.map((col) =>
      col.id === "symbol"
        ? {
            ...col,
            cell: (ctx: { column?: { accessorKey?: unknown }; row: { original: WatchRow } }) => {
              const symbol = String(ctxGet(ctx) ?? "");
              return (
                <Box className="inline-flex min-w-0 items-center gap-1">
                  <SymbolLink
                    symbol={symbol}
                    testId={`watch-tv-${symbol}`}
                    chartTestId={`watch-chart-${symbol}`}
                    onOpen={props.onOpenSymbol}
                    onPreview={props.onSymbolPreview}
                    onPreviewEnd={props.onSymbolPreviewEnd}
                  />
                  <PatternTags tags={rowTags(ctx.row.original)} symbol={ctx.row.original.symbol} testIdPrefix="watch" compact />
                </Box>
              );
            },
          }
        : col,
    );
  });
  const initialSorting = createMemo(() => sortFor(setup()));
  const csvColumns = createMemo(() => watchCsvColumns(setup()));
  const snapshotAge = createMemo(() => formatSnapshotAge(updatedAt(), nowMs()));
  // Stream progress: when the second `meta` carries `total`, the counter
  // shows how many `item`s have arrived against that armed total. Older
  // backends / pre-`total` metas keep the `filtered / items` display.
  const streamTotal = () => {
    const meta = streamMeta();
    return typeof meta?.total === "number" && Number.isFinite(meta.total) ? meta.total : null;
  };
  const countLabel = () =>
    streamTotal() != null
      ? `${filtered().length} / ${streamTotal()}`
      : `${filtered().length} / ${items().length}`;

  const { copyMsg, copyFailed, copyRows, copySymbols } = useCopyFeedback();
  const handleCopyCsv = () => {
    void copyRows(filtered(), csvColumns());
  };
  const handleCopySymbols = () => {
    void copySymbols(filtered());
  };

  return (
    <Box data-testid="watch-view" className="flex min-w-0 flex-col gap-1">
      <ToolbarRow justify="space-between" data-testid="watch-toolbar" gap={8} wrap={false} className="h-9">
        <ToolbarRow gap={8} wrap={false}>
          <Select
            value={setup()}
            onChange={(v) => setSetup(String(v ?? "breakout"))}
            data={setupOptions().length > 0 ? setupOptions() : [{ value: "breakout", label: "Breakout" }]}
            placeholder="Setup"
            aria-label="Watch setup"
            w={200}
            size="sm"
            data-testid="watch-setup-select"
          />
          <Tooltip label="Gate on time-adjusted intraday volume (vol_adj). Triggered = price + vol_adj ≥ gate.">
            <Box data-testid="watch-vol-adj-input" className="inline-flex">
              <NumberInput
                placeholder="Vol (adj) ≥"
                aria-label="Vol (adj) gate"
                value={relVol()}
                onChange={(v) => setRelVol(typeof v === "number" ? v : v === "" ? "" : Number(v))}
                min={0}
                step={0.1}
                w={120}
                size="sm"
                data-testid="watch-relvol-input"
              />
            </Box>
          </Tooltip>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading()}
            data-testid="watch-refresh"
            className="inline-flex h-7 items-center rounded-fin border border-fin-border px-2 text-xs text-fin-text transition-colors hover:bg-fin-surface-alt disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh
          </button>
        </ToolbarRow>
        <ToolbarRow gap={8} wrap={false}>
          <Show when={updatedAt()}>
            <Text size="xs" c="dimmed" truncate className="min-w-0" data-testid="watch-updated-at">
              {`Updated ${updatedAt()}`}
            </Text>
          </Show>
          <Show when={snapshotAge()}>
            <Text size="xs" c="dimmed" data-testid="watch-snapshot-age">
              {snapshotAge()}
            </Text>
          </Show>
          <Show when={live()} fallback={
            <Tooltip
              label={marketStatus()?.holiday ? "NSE holiday — polling paused" : "Market closed — polling paused"}
            >
              <Badge color="default" size="xs" data-testid="watch-live-indicator">
                paused
              </Badge>
            </Tooltip>
          }>
            <Badge color="success" size="xs" data-testid="watch-live-indicator">
              live
            </Badge>
          </Show>
        </ToolbarRow>
      </ToolbarRow>

      <ToolbarRow gap={2} wrap={false} clip className="h-6" data-testid="watch-summary">
        <Show when={activeSetup()?.description}>
          <Text size="xs" c="dimmed" truncate className="min-w-0" data-testid="watch-setup-description">
            {activeSetup()!.description}
          </Text>
        </Show>
        <Show when={activeSetup()?.description && streamMeta()}>
          <Text size="xs" c="dimmed" className="shrink-0 px-1" aria-hidden="true">
            ·
          </Text>
        </Show>
        <Show when={streamMeta()}>
          <Text size="xs" c="dimmed" truncate className="min-w-0" data-testid="watch-stream-meta">
            {`${activeSetup()?.label ?? streamMeta()!.setup} · Vol (adj) ≥ ${streamMeta()!.min_rel_volume}`}
          </Text>
        </Show>
      </ToolbarRow>

      <ToolbarRow gap={8} data-testid="watch-filters" wrap={false} className="h-8">
        <TextInput
          placeholder="Search symbol…"
          value={search()}
          onChange={(v) => setSearch(v ? String(v) : "")}
          size="sm"
          w={200}
          data-testid="watch-search"
        />
        <Select
          value={stateFilter()}
          onChange={(v) => setStateFilter((v ?? "all") as WatchRow["state"] | "all")}
          data={[
            { value: "all", label: "All states" },
            { value: "triggered", label: "Triggered" },
            { value: "armed", label: "Armed" },
            { value: "invalidated", label: "Invalidated" },
          ]}
          size="sm"
          w={160}
          aria-label="Watch state filter"
          data-testid="watch-state-filter"
        />
        <NumberInput
          placeholder="≤ % of trigger"
          aria-label="Within % of trigger"
          value={withinPct()}
          onChange={(v) => setWithinPct(typeof v === "number" ? v : v === "" ? "" : Number(v))}
          min={0}
          step={1}
          size="sm"
          w={110}
          data-testid="watch-within-pct"
        />
        <Switch
          label="Hide inval."
          size="sm"
          checked={hideInvalidated()}
          onChange={(e) => setHideInvalidated(e.currentTarget.checked)}
          data-testid="watch-hide-invalidated"
        />
        <Switch
          label="Hide ETFs"
          size="sm"
          checked={hideEtfs()}
          onChange={(e) => setHideEtfs(e.currentTarget.checked)}
          data-testid="watch-hide-etfs"
        />
        <Text size="xs" c="dimmed" data-testid="watch-count">
          {countLabel()}
        </Text>
        <Show when={streaming() && items().length > 0}>
          <Text size="xs" c="dimmed" className="shrink-0" data-testid="watch-streaming">
            {`loading more… ${items().length} rows`}
          </Text>
        </Show>
        <button
          type="button"
          onClick={() => void handleCopyCsv()}
          disabled={filtered().length === 0}
          data-testid="watch-copy-csv"
          className="inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-fin border border-fin-border px-2 text-xs text-fin-text transition-colors hover:bg-fin-surface-alt disabled:cursor-not-allowed disabled:opacity-50"
        >
          CSV
        </button>
        <button
          type="button"
          onClick={() => void handleCopySymbols()}
          disabled={filtered().length === 0}
          data-testid="watch-copy-symbols"
          className="inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-fin border border-fin-border px-2 text-xs text-fin-text transition-colors hover:bg-fin-surface-alt disabled:cursor-not-allowed disabled:opacity-50"
        >
          Symbols
        </button>
        <Show when={copyMsg()}>
          <Text size="xs" c={copyFailed() ? "error" : "success"} data-testid="watch-copy-toast">
            {copyMsg()}
          </Text>
        </Show>
      </ToolbarRow>

      <Show when={refreshing()}>
        <Text size="xs" c="dimmed" data-testid="watch-refreshing">
          Refreshing…
        </Text>
      </Show>

      <Show when={error()}>
        <Alert color="error" data-testid="watch-error">
          {error()}
        </Alert>
      </Show>

      <Show when={loading() && items().length === 0} fallback={
        <Show when={items().length === 0 && !error()} fallback={
          <TanStackTable<WatchRow>
            key={setup()}
            data={filtered()}
            columns={columns()}
            dataTestId="watch-table"
            loading={loading()}
            emptyMessage={items().length > 0 ? "No rows match the filters." : "No breakout candidates right now."}
            initialState={{ sorting: initialSorting() }}
            onRowClick={(row) => props.onOpenSymbol?.(row.symbol)}
            getRowTestId={(row) => `watch-row-${row.symbol}`}
          />
        }>
          <Box
            data-testid="watch-empty"
            className="flex flex-col items-center gap-2 rounded-fin border border-dashed border-fin-border bg-fin-surface px-4 py-12 text-center"
          >
            <Text size="sm" c="dimmed">
              No breakout candidates right now.
            </Text>
            <Text size="xs" c="dimmed">
              {`${universe()} · ${timeframe()} · ${setup()}`}
            </Text>
          </Box>
        </Show>
      }>
        <Box
          data-testid="watch-loading"
          className="flex flex-col items-center gap-2 py-12"
        >
          <Loader size="lg" />
          <Text size="sm" c="dimmed">
            Loading watch list…
          </Text>
          <Show when={showSlowHint() && streaming()}>
            <Text size="xs" c="dimmed" data-testid="watch-loading-hint">
              {`Computing the ${universeLabel(universe())} screen — this can take a few seconds for All NSE Equity.`}
            </Text>
          </Show>
        </Box>
      </Show>
    </Box>
  );
}
