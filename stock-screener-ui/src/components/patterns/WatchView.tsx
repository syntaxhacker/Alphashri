import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  CopyButton,
  Loader,
  NumberInput,
  Select,
  Switch,
  Text,
  TextInput,
  ToolbarRow,
  Tooltip,
} from "@/ui";
import { TanStackTable } from "@/components/common/TanStackTable";
import { fetchMarketStatus, fetchWatch, fetchWatchSetups, streamWatch } from "@/api/chartPatterns";
import type { MarketStatus, WatchRow, WatchSetup } from "@/types/chartPatterns";
import type { WatchStreamMeta } from "@/api/chartPatterns";
import { formatCurrency, formatPercentage } from "@/utils/ui-helpers";
import type { CsvColumn } from "@/utils/copyCsv";
import { isMarketOpenNow } from "@/state/holidays";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { SymbolLink } from "@/components/common/SymbolLink";
import { IconCheck, IconCopy } from "@/components/common/Icons";
import { displaySymbol } from "@/config/tvSymbols";
import { PatternTags, hasTag, rowTags, shortIstDate } from "./rowBadges";
import { PatternScrollRegion } from "./PatternScrollRegion";

export const WATCH_POLL_MS = 60000;
export const WATCH_AUTO_REFRESH = false;
export const MARKET_STATUS_POLL_MS = 180000;
/** Re-render cadence for the snapshot-age label. Ticks `Date.now()` only — never fetches. */
export const WATCH_SNAPSHOT_TICK_MS = 30000;
/** Default "Within % of trigger" filter: open focused on actionable rows. */
export const WATCH_DEFAULT_WITHIN_PCT = 5;
export const WATCH_DEFAULT_MIN_REL_VOLUME = 0.7;
/**
 * Empty-stream hint delay: when the stream has delivered no `item` for this
 * long, the loading panel adds a "Computing …" hint. Informational only —
 * the stream is never aborted because of it.
 */
export const WATCH_SLOW_HINT_MS = 8000;

const WATCH_UNIVERSE_LABELS: Record<string, string> = {
  nifty50: "NIFTY 50",
  nifty100: "NIFTY 100",
  nifty200: "NIFTY 200",
  nifty500: "NIFTY 500",
  all_equity: "All NSE Equity",
  nse_fo: "NSE F&O",
};

export function universeLabel(universe: string): string {
  return WATCH_UNIVERSE_LABELS[universe] ?? universe;
}

type WatchStreamMetaWithTotal = WatchStreamMeta & { total?: number | null };

/** IST offset, used only for the hh:mm snapshot stamp (not the session clock). */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

type WatchRowExt = WatchRow & {
  trigger_date?: string | null;
  last_touch_date?: string | null;
};

function triggerDateOf(row: WatchRow): string | null | undefined {
  return (row as WatchRowExt).trigger_date;
}

function lastTouchDateOf(row: WatchRow): string | null | undefined {
  return (row as WatchRowExt).last_touch_date;
}

/**
 * Holiday-aware 09:15–15:30 IST gate. Delegates to the single user-facing
 * market gate so the watch list agrees with every other screen on holidays.
 */
export function isWatchLiveNow(now: Date = new Date()): boolean {
  return isMarketOpenNow(now);
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

const ctxGet = (ctx: {
  column?: { accessorKey?: unknown };
  row: { original: WatchRow };
}): unknown => {
  const key = ctx.column?.accessorKey;
  return typeof key === "string"
    ? (ctx.row.original as unknown as Record<string, unknown>)[key]
    : undefined;
};

const symbolCell = (ctx: WatchCellContext) => {
  const row = ctx.row.original as WatchRow;
  const label = () => displaySymbol(String(ctxGet(ctx) ?? ""));
  return (
    <Box className="inline-flex min-w-0 items-center gap-1">
      <Text size="sm" fw={600}>
        {label()}
      </Text>
      <CopyButton value={label()}>
        {({ copied, copy }) => (
          <ActionIcon
            variant="subtle"
            color={copied ? "info" : "secondary"}
            size="xs"
            style={{ width: "16px", height: "16px", "min-height": "16px", padding: "0px" }}
            onClick={(event: MouseEvent) => {
              event.stopPropagation();
              copy();
            }}
            aria-label={`Copy ${label()}`}
            data-testid={`copy-symbol-${label()}`}
          >
            {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
          </ActionIcon>
        )}
      </CopyButton>
      <PatternTags tags={rowTags(row)} symbol={row.symbol} testIdPrefix="watch" compact />
    </Box>
  );
};

const priceCell = (ctx: WatchCellContext) => (
  <span>{formatCurrency(Number(ctxGet(ctx) ?? 0), 2)}</span>
);

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

const plainNumberCell = (ctx: WatchCellContext) => {
  const raw = ctxGet(ctx) as number | null | undefined;
  if (raw == null) return <span>-</span>;
  return <span>{Number(raw).toFixed(2)}</span>;
};

const ratioCell = (ctx: WatchCellContext) => {
  const raw = ctxGet(ctx) as number | null | undefined;
  if (raw == null) return <span>-</span>;
  return <span>{`${Number(raw).toFixed(2)}x`}</span>;
};

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

export const COLUMNS_BY_SETUP: Record<string, TableColumnDef<WatchRow>[]> = {
  breakout: BREAKOUT_COLUMNS,
  near_52w: NEAR_52W_COLUMNS,
};

export const SORT_BY_SETUP: Record<string, Array<{ id: string; desc: boolean }>> = {
  breakout: [{ id: "pct_to_trigger", desc: true }],
  near_52w: [{ id: "close_gap", desc: false }],
};

export function columnsFor(setup: string): TableColumnDef<WatchRow>[] {
  return COLUMNS_BY_SETUP[setup] ?? BREAKOUT_COLUMNS;
}

export function watchCsvColumns(setup: string): CsvColumn[] {
  return columnsFor(setup).map((col) => {
    const accessorKey = (col as { accessorKey?: unknown }).accessorKey;
    const key = typeof accessorKey === "string" ? accessorKey : (col.id ?? "");
    const header = typeof col.header === "string" ? col.header : (col.id ?? key);
    return { key, header };
  });
}

export function sortFor(setup: string): Array<{ id: string; desc: boolean }> {
  return SORT_BY_SETUP[setup] ?? SORT_BY_SETUP.breakout;
}

/**
 * Breakout Watch tab body: setup picker + rel-vol filter + live watch table.
 * Polls `/watch` every 20s while the market is open. Liveness is gated on the
 * holiday-aware `/market-status` probe (`open === true`); the holiday-aware
 * `isMarketOpenNow()` gate is only a fallback when that probe fails.
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
  const [streaming, setStreaming] = createSignal(false);
  const [streamMeta, setStreamMeta] = createSignal<WatchStreamMetaWithTotal | null>(null);
  const [showSlowHint, setShowSlowHint] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [live, setLive] = createSignal(isWatchLiveNow());
  const [marketStatus, setMarketStatus] = createSignal<MarketStatus | null>(null);
  let marketStatusRef: MarketStatus | null = null;
  const [search, setSearch] = createSignal("");
  const [stateFilter, setStateFilter] = createSignal<WatchRow["state"] | "all">("all");
  const [withinPct, setWithinPct] = createSignal<number | string>(WATCH_DEFAULT_WITHIN_PCT);
  const [hideInvalidated, setHideInvalidated] = createSignal(true);
  const [hideEtfs, setHideEtfs] = createSignal(true);
  let requestRef = 0;
  let streamControllerRef: AbortController | null = null;

  // Abort any in-flight stream when the view unmounts.
  onCleanup(() => {
    streamControllerRef?.abort();
  });

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
    const query = {
      setup: setup(),
      universe: universe(),
      timeframe: timeframe(),
      minBaseDays: minBaseDays(),
      minRelVolume: minRelVolume(),
    };

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

  const setupOptions = createMemo(() => setups().map((s) => ({ value: s.id, label: s.label })));
  const activeSetup = () => setups().find((s) => s.id === setup()) ?? null;

  const filtered = createMemo(() => {
    const q = search().trim().toUpperCase();
    const maxAbs = typeof withinPct() === "number" ? (withinPct() as number) : null;
    const distanceOf = (row: WatchRow): number | null | undefined =>
      setup() === "near_52w" ? row.close_gap : row.pct_to_trigger;
    return items().filter((row) => {
      if (hideEtfs() && hasTag(row, "ETF")) return false;
      if (
        q &&
        !String(row.symbol || "")
          .toUpperCase()
          .includes(q)
      )
        return false;
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
                    showCopy
                  />
                  <PatternTags
                    tags={rowTags(ctx.row.original)}
                    symbol={ctx.row.original.symbol}
                    testIdPrefix="watch"
                    compact
                  />
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
    <Box
      data-testid="watch-view"
      className="flex h-full min-h-0 min-w-0 flex-col gap-1 overflow-hidden"
    >
      <ToolbarRow
        justify="space-between"
        data-testid="watch-toolbar"
        gap={8}
        wrap={false}
        className="h-9"
      >
        <ToolbarRow gap={8} wrap={false}>
          <Select
            value={setup()}
            onChange={(v) => setSetup(String(v ?? "breakout"))}
            data={
              setupOptions().length > 0
                ? setupOptions()
                : [{ value: "breakout", label: "Breakout" }]
            }
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
                onChange={(v: number | string) =>
                  setRelVol(typeof v === "number" ? v : v === "" ? "" : Number(v))
                }
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
          <Show
            when={live()}
            fallback={
              <Tooltip
                label={
                  marketStatus()?.holiday
                    ? "NSE holiday — polling paused"
                    : "Market closed — polling paused"
                }
              >
                <Badge color="default" size="xs" data-testid="watch-live-indicator">
                  paused
                </Badge>
              </Tooltip>
            }
          >
            <Badge color="success" size="xs" data-testid="watch-live-indicator">
              live
            </Badge>
          </Show>
        </ToolbarRow>
      </ToolbarRow>

      <ToolbarRow gap={2} wrap={false} clip className="h-6" data-testid="watch-summary">
        <Show when={activeSetup()?.description}>
          <Text
            size="xs"
            c="dimmed"
            truncate
            className="min-w-0"
            data-testid="watch-setup-description"
          >
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
          onChange={(v: number | string) =>
            setWithinPct(typeof v === "number" ? v : v === "" ? "" : Number(v))
          }
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
          onChange={(checked) => setHideInvalidated(checked)}
          data-testid="watch-hide-invalidated"
        />
        <Switch
          label="Hide ETFs"
          size="sm"
          checked={hideEtfs()}
          onChange={(checked) => setHideEtfs(checked)}
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

      <Show
        when={loading() && items().length === 0}
        fallback={
          <Show
            when={items().length === 0 && !error()}
            fallback={
              // Keyed on the setup so switching setups remounts the table: the
              // header sort and scroll position belong to the previous setup.
              <Show when={setup()} keyed>
                {(_setup) => (
                  <PatternScrollRegion
                    testId="watch-table-scroll-region"
                    cueTestId="watch-table-scroll-cue"
                    ariaLabel="Watch list, scroll sideways for more columns"
                    stickyFirstColumn
                  >
                    <TanStackTable<WatchRow>
                      data={filtered()}
                      columns={columns()}
                      dataTestId="watch-table"
                      loading={loading()}
                      emptyMessage={
                        items().length > 0
                          ? "No rows match the filters."
                          : "No breakout candidates right now."
                      }
                      initialState={{ sorting: initialSorting() }}
                      fillContainer
                      onRowClick={(row) => props.onOpenSymbol?.(row.symbol)}
                      getRowTestId={(row) => `watch-row-${row.symbol}`}
                    />
                  </PatternScrollRegion>
                )}
              </Show>
            }
          >
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
        }
      >
        <Box data-testid="watch-loading" className="flex flex-col items-center gap-2 py-12">
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
