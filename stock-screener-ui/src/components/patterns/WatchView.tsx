import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert, Badge, Box, Button, Loader, NumberInput, Select, Switch, Text, TextInput, ToolbarRow, Tooltip } from "@/ui";
import { TanStackTable } from "@/components/common/TanStackTable";
import { fetchMarketStatus, fetchWatch, fetchWatchSetups, streamWatch } from "@/api/chartPatterns";
import type { MarketStatus, WatchRow, WatchSetup, WatchStreamMeta } from "@/types/chartPatterns";
import { formatPercentage } from "@/utils/ui-helpers";
import { copyToClipboard, toCsv, toSymbolList, type CsvColumn } from "@/utils/copyCsv";

/** Re-fetch cadence for the watch list while the market is open. */
export const WATCH_POLL_MS = 60000;
/**
 * Auto-refresh the watch list while the market is open. Disabled for now — the
 * list reloads on the initial load, a filter change, or the REFRESH button.
 */
export const WATCH_AUTO_REFRESH = false;
/** Refresh cadence for the holiday-aware market-status probe. */
export const MARKET_STATUS_POLL_MS = 180000;
/** Default "Within % of trigger" filter: open focused on actionable rows. */
export const WATCH_DEFAULT_WITHIN_PCT = 5;
/**
 * Default gate on the time-adjusted intraday volume (`vol_adj`).
 * Sent as `min_rel_volume`; the backend applies it to `vol_adj`.
 */
export const WATCH_DEFAULT_MIN_REL_VOLUME = 0.7;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MARKET_OPEN_MIN = 9 * 60 + 15;
const MARKET_CLOSE_MIN = 15 * 60 + 30;

/**
 * True between 09:15–15:30 IST, Mon–Fri. Pure IST-clock helper so the watch
 * list polls live during market hours and pauses otherwise.
 */
export function isWatchLiveNow(now: Date = new Date()): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutes >= MARKET_OPEN_MIN && minutes <= MARKET_CLOSE_MIN;
}

export interface WatchViewProps {
  universe: string;
  timeframe: string;
  minBaseDays?: number | null;
  onOpenSymbol?: (symbol: string) => void;
}

function stateColor(state: WatchRow["state"]): "success" | "default" | "dimmed" {
  if (state === "triggered") return "success";
  if (state === "invalidated") return "dimmed";
  return "default";
}

function stateCell(ctx: { getValue: () => unknown; row: { original: WatchRow } }) {
  const state = ctx.getValue() as WatchRow["state"];
  const row = ctx.row.original as WatchRow;
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
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
      ) : null}
    </Box>
  );
}

const BREAKOUT_COLUMNS: ColumnDef<WatchRow>[] = [
  {
    id: "symbol",
    header: "Symbol",
    accessorKey: "symbol",
    meta: { align: "left" },
    cell: (ctx) => <Text size="sm" fw={600}>{String(ctx.getValue())}</Text>,
  },
  {
    id: "state",
    header: "State",
    accessorKey: "state",
    meta: { align: "center" },
    cell: (ctx) => stateCell(ctx as never),
  },
  {
    id: "ltp",
    header: "LTP",
    accessorKey: "ltp",
    meta: { align: "right" },
    cell: (ctx) => <span>{`₹${Number(ctx.getValue() ?? 0).toFixed(2)}`}</span>,
  },
  {
    id: "trigger",
    header: "Trigger",
    accessorKey: "trigger_level",
    meta: { align: "right" },
    cell: (ctx) => <span>{`₹${Number(ctx.getValue() ?? 0).toFixed(2)}`}</span>,
  },
  {
    id: "pct_to_trigger",
    header: "% to trigger",
    accessorKey: "pct_to_trigger",
    meta: { align: "right" },
    cell: (ctx) => {
      const v = Number(ctx.getValue() ?? 0);
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
    cell: (ctx) => <span>{Number(ctx.getValue() ?? 0).toFixed(2)}x</span>,
  },
  {
    id: "vol_adj",
    header: "Vol (adj)",
    accessorKey: "vol_adj",
    meta: { align: "right" },
    cell: (ctx) => {
      const row = ctx.row.original as WatchRow;
      const raw = ctx.getValue() as number | null | undefined;
      if (raw == null) return <span data-testid={`watch-vol-adj-${row.symbol}`}>—</span>;
      const v = Number(raw);
      return (
        <Text size="sm" c={v >= 1 ? "success" : undefined}>
          <span data-testid={`watch-vol-adj-${row.symbol}`}>{`${v.toFixed(2)}x`}</span>
        </Text>
      );
    },
  },
  {
    id: "base_days",
    header: "Base (d)",
    accessorKey: "base_days",
    meta: { align: "right" },
    cell: (ctx) => <span>{String(ctx.getValue() ?? "-")}</span>,
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    meta: { align: "center" },
    cell: (ctx) => {
      const status = String(ctx.getValue() ?? "");
      return (
        <Badge color="default" size="xs" data-testid={`watch-status-${status || "unknown"}`}>
          {status || "-"}
        </Badge>
      );
    },
  },
];

/** `near_52w` accumulation columns: 52W-high proximity + accumulation gauges. */
const NEAR_52W_COLUMNS: ColumnDef<WatchRow>[] = [
  {
    id: "symbol",
    header: "Symbol",
    accessorKey: "symbol",
    meta: { align: "left" },
    cell: (ctx) => <Text size="sm" fw={600}>{String(ctx.getValue())}</Text>,
  },
  {
    id: "state",
    header: "State",
    accessorKey: "state",
    meta: { align: "center" },
    cell: (ctx) => stateCell(ctx as never),
  },
  {
    id: "ltp",
    header: "LTP",
    accessorKey: "ltp",
    meta: { align: "right" },
    cell: (ctx) => <span>{`₹${Number(ctx.getValue() ?? 0).toFixed(2)}`}</span>,
  },
  {
    id: "high_52w",
    header: "52W high",
    accessorKey: "trigger_level",
    meta: { align: "right" },
    cell: (ctx) => <span>{`₹${Number(ctx.getValue() ?? 0).toFixed(2)}`}</span>,
  },
  {
    id: "high_gap",
    header: "Hi gap %",
    accessorKey: "high_gap",
    meta: { align: "right" },
    cell: (ctx) => {
      const raw = ctx.getValue() as number | null | undefined;
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
      const raw = ctx.getValue() as number | null | undefined;
      if (raw == null) return <span>-</span>;
      return <span>{formatPercentage(Number(raw))}</span>;
    },
  },
  {
    id: "obv_slope",
    header: "OBV",
    accessorKey: "obv_slope",
    meta: { align: "right" },
    cell: (ctx) => {
      const raw = ctx.getValue() as number | null | undefined;
      if (raw == null) return <span>-</span>;
      return <span>{Number(raw).toFixed(2)}</span>;
    },
  },
  {
    id: "updown",
    header: "Up/Dn",
    accessorKey: "updown",
    meta: { align: "right" },
    cell: (ctx) => {
      const raw = ctx.getValue() as number | null | undefined;
      if (raw == null) return <span>-</span>;
      return <span>{Number(raw).toFixed(2)}</span>;
    },
  },
  {
    id: "vol_ratio",
    header: "VolR",
    accessorKey: "vol_ratio",
    meta: { align: "right" },
    cell: (ctx) => {
      const raw = ctx.getValue() as number | null | undefined;
      if (raw == null) return <span>-</span>;
      return <span>{`${Number(raw).toFixed(2)}x`}</span>;
    },
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
    cell: (ctx) => {
      const raw = ctx.getValue() as number | null | undefined;
      if (raw == null) return <span>-</span>;
      return <span>{`${Number(raw).toFixed(2)}x`}</span>;
    },
  },
  {
    id: "vol_adj",
    header: "Vol (adj)",
    accessorKey: "vol_adj",
    meta: { align: "right" },
    cell: (ctx) => {
      const row = ctx.row.original as WatchRow;
      const raw = ctx.getValue() as number | null | undefined;
      if (raw == null) return <span data-testid={`watch-vol-adj-${row.symbol}`}>—</span>;
      const v = Number(raw);
      return (
        <Text size="sm" c={v >= 1 ? "success" : undefined}>
          <span data-testid={`watch-vol-adj-${row.symbol}`}>{`${v.toFixed(2)}x`}</span>
        </Text>
      );
    },
  },
];

/**
 * Setup-aware column registry. Adding a future setup is one entry here plus
 * its default sort in `SORT_BY_SETUP`.
 */
export const COLUMNS_BY_SETUP: Record<string, ColumnDef<WatchRow>[]> = {
  breakout: BREAKOUT_COLUMNS,
  near_52w: NEAR_52W_COLUMNS,
};

/** Default sort per setup: breakout = most advanced first, near_52w = nearest close first. */
export const SORT_BY_SETUP: Record<string, Array<{ id: string; desc: boolean }>> = {
  breakout: [{ id: "pct_to_trigger", desc: true }],
  near_52w: [{ id: "close_gap", desc: false }],
};

/** Columns for the active setup (falls back to the generic breakout columns). */
export function columnsFor(setup: string): ColumnDef<WatchRow>[] {
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
export function WatchView({ universe, timeframe, minBaseDays = null, onOpenSymbol }: WatchViewProps) {
  const [setups, setSetups] = useState<WatchSetup[]>([]);
  const [setup, setSetup] = useState("breakout");
  const [relVol, setRelVol] = useState<number | string>(WATCH_DEFAULT_MIN_REL_VOLUME);
  const [relVolDefaulted, setRelVolDefaulted] = useState(false);
  const [items, setItems] = useState<WatchRow[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** True while a `/watch/stream` connection is still appending rows. */
  const [streaming, setStreaming] = useState(false);
  /** Stream `meta` echo (setup + gate), shown as soon as it arrives. */
  const [streamMeta, setStreamMeta] = useState<WatchStreamMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(() => isWatchLiveNow());
  // Holiday-aware market status (server clock wins over the client clock).
  // Null = probe unavailable/failed → fall back to `isWatchLiveNow()`.
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const marketStatusRef = useRef<MarketStatus | null>(null);
  // Client-side quick filters over the loaded rows (instant, no refetch).
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<WatchRow["state"] | "all">("all");
  const [withinPct, setWithinPct] = useState<number | string>(WATCH_DEFAULT_WITHIN_PCT);
  const [hideInvalidated, setHideInvalidated] = useState(true);
  const requestRef = useRef(0);
  const streamControllerRef = useRef<AbortController | null>(null);

  // Abort any in-flight stream when the view unmounts.
  useEffect(
    () => () => {
      streamControllerRef.current?.abort();
    },
    [],
  );
  // Copy-to-clipboard feedback (transient "Copied N rows" / error toast).
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const flashCopy = useCallback((message: string, failed: boolean) => {
    setCopyMsg(message);
    setCopyFailed(failed);
    if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      setCopyMsg(null);
      setCopyFailed(false);
      copyTimerRef.current = null;
    }, 3000);
  }, []);

  // Load the setup registry once; adopt the active setup's default rel-vol.
  useEffect(() => {
    let active = true;
    fetchWatchSetups()
      .then((list) => {
        if (!active) return;
        setSetups(list);
        const current = list.find((s) => s.id === "breakout") ?? list[0] ?? null;
        if (current) {
          setSetup((prev) => (list.some((s) => s.id === prev) ? prev : current.id));
          if (!relVolDefaulted) {
            setRelVol(current.default_min_rel_volume ?? WATCH_DEFAULT_MIN_REL_VOLUME);
            setRelVolDefaulted(true);
          }
        }
      })
      .catch(() => {
        if (active) setSetups([]);
      });
    return () => {
      active = false;
    };
    // Mount-only: the default applies once, the user owns the input after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const minRelVolume = typeof relVol === "number" ? relVol : Number(relVol) || null;

  const load = useCallback(
    async (background: boolean) => {
      const token = requestRef.current + 1;
      requestRef.current = token;
      streamControllerRef.current?.abort();
      const controller = new AbortController();
      streamControllerRef.current = controller;
      if (background) setRefreshing(true);
      else {
        setLoading(true);
        setItems([]);
      }
      setError(null);
      setStreaming(false);
      setStreamMeta(null);
      const query = { setup, universe, timeframe, minBaseDays, minRelVolume };

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
              if (requestRef.current !== token) return;
              setStreamMeta(meta);
              if (meta.updated_at) setUpdatedAt(meta.updated_at);
            },
            onItem: (row) => {
              if (requestRef.current !== token) return;
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
        if (requestRef.current !== token) return;
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
        if (requestRef.current !== token) return;
        setItems(payload.items ?? []);
        setUpdatedAt(payload.updated_at ?? null);
        setError(null);
      } catch (err) {
        if (requestRef.current !== token) return;
        setError(err instanceof Error && err.message ? err.message : "Failed to load watch list");
      } finally {
        if (requestRef.current === token) {
          setStreaming(false);
          if (background) setRefreshing(false);
          else setLoading(false);
        }
      }
    },
    [setup, universe, timeframe, minBaseDays, minRelVolume],
  );

  // Initial + filter-driven load.
  useEffect(() => {
    void load(false);
  }, [load]);

  // Holiday-aware market status: fetched once on mount, refreshed every
  // MARKET_STATUS_POLL_MS (3 min). While available it gates the live badge + the
  // live poll; when the probe fails we fall back to the client-side IST clock.
  useEffect(() => {
    let active = true;
    const refreshStatus = (): Promise<void> =>
      fetchMarketStatus()
        .then((status) => {
          if (!active) return;
          marketStatusRef.current = status;
          setMarketStatus(status);
          setLive(status.open);
        })
        .catch(() => {
          if (!active) return;
          marketStatusRef.current = null;
          setMarketStatus(null);
          setLive(isWatchLiveNow());
        });
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), MARKET_STATUS_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  // Live badge + (optional) polling. Auto-refresh is disabled via
  // `WATCH_AUTO_REFRESH` — when off, the list only reloads on the initial load,
  // a filter change, or the REFRESH button.
  useEffect(() => {
    const tickLive = (): boolean => {
      const server = marketStatusRef.current;
      const open = server ? server.open : isWatchLiveNow();
      setLive(open);
      return open;
    };
    setLive(tickLive());
    if (!WATCH_AUTO_REFRESH) return;
    const timer = setInterval(() => {
      if (tickLive()) void load(true);
    }, WATCH_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const setupOptions = useMemo(
    () => setups.map((s) => ({ value: s.id, label: s.label })),
    [setups],
  );
  const activeSetup = setups.find((s) => s.id === setup) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    const maxAbs = typeof withinPct === "number" ? withinPct : null;
    // `near_52w` rows carry no `pct_to_trigger`; filter on `close_gap` instead.
    const distanceOf = (row: WatchRow): number | null | undefined =>
      setup === "near_52w" ? row.close_gap : row.pct_to_trigger;
    return items.filter((row) => {
      if (q && !String(row.symbol || "").toUpperCase().includes(q)) return false;
      if (hideInvalidated && row.state === "invalidated") return false;
      if (stateFilter !== "all" && row.state !== stateFilter) return false;
      if (maxAbs != null) {
        const pct = distanceOf(row);
        if (pct == null || Math.abs(pct) > maxAbs) return false;
      }
      return true;
    });
  }, [items, search, stateFilter, withinPct, hideInvalidated, setup]);

  const columns = useMemo(() => columnsFor(setup), [setup]);
  const initialSorting = useMemo(() => sortFor(setup), [setup]);
  const csvColumns = useMemo(() => watchCsvColumns(setup), [setup]);

  const handleCopyCsv = useCallback(async () => {
    const csv = toCsv(filtered as unknown as Array<Record<string, unknown>>, csvColumns);
    const ok = await copyToClipboard(csv);
    flashCopy(
      ok ? `Copied ${filtered.length} row${filtered.length === 1 ? "" : "s"}` : "Copy failed",
      !ok,
    );
  }, [filtered, csvColumns, flashCopy]);

  const handleCopySymbols = useCallback(async () => {
    const list = toSymbolList(filtered as unknown as Array<Record<string, unknown>>);
    const ok = await copyToClipboard(list);
    flashCopy(
      ok
        ? `Copied ${filtered.length} symbol${filtered.length === 1 ? "" : "s"}`
        : "Copy failed",
      !ok,
    );
  }, [filtered, flashCopy]);

  return (
    <Box data-testid="watch-view" sx={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <ToolbarRow justify="space-between" data-testid="watch-toolbar" gap={8}>
        <ToolbarRow gap={8}>
          <Select
            value={setup}
            onChange={(v) => setSetup(String(v ?? "breakout"))}
            data={setupOptions.length > 0 ? setupOptions : [{ value: "breakout", label: "Breakout" }]}
            placeholder="Setup"
            aria-label="Watch setup"
            w={200}
            size="sm"
            data-testid="watch-setup-select"
          />
          <Tooltip label="Gate on time-adjusted intraday volume (vol_adj). Triggered = price + vol_adj ≥ gate.">
            <Box data-testid="watch-vol-adj-input" sx={{ display: "inline-flex" }}>
              <NumberInput
                label="Vol (adj) ≥"
                value={relVol}
                onChange={(v) => setRelVol(typeof v === "number" ? v : v === "" ? "" : Number(v))}
                min={0}
                step={0.1}
                w={140}
                size="sm"
                data-testid="watch-relvol-input"
              />
            </Box>
          </Tooltip>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void load(true)}
            disabled={loading}
            data-testid="watch-refresh"
          >
            Refresh
          </Button>
        </ToolbarRow>
        <ToolbarRow gap={8}>
          {updatedAt ? (
            <Text size="xs" c="dimmed" data-testid="watch-updated-at">
              {`Updated ${updatedAt}`}
            </Text>
          ) : null}
          {live ? (
            <Badge color="success" size="xs" data-testid="watch-live-indicator">
              live
            </Badge>
          ) : (
            <Tooltip
              label={marketStatus?.holiday ? "NSE holiday — polling paused" : "Market closed — polling paused"}
            >
              <Badge color="default" size="xs" data-testid="watch-live-indicator">
                paused
              </Badge>
            </Tooltip>
          )}
        </ToolbarRow>
      </ToolbarRow>

      {activeSetup?.description ? (
        <Text size="xs" c="dimmed" data-testid="watch-setup-description">
          {activeSetup.description}
        </Text>
      ) : null}

      {streamMeta ? (
        <Text size="xs" c="dimmed" data-testid="watch-stream-meta">
          {`${activeSetup?.label ?? streamMeta.setup} · Vol (adj) ≥ ${streamMeta.min_rel_volume}`}
        </Text>
      ) : null}

      {streaming && items.length > 0 ? (
        <Text size="xs" c="dimmed" data-testid="watch-streaming">
          {`loading more… ${items.length} rows`}
        </Text>
      ) : null}

      <ToolbarRow gap={8} data-testid="watch-filters" style={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextInput
          placeholder="Search symbol…"
          value={search}
          onChange={(v) => setSearch(v ? String(v) : "")}
          size="sm"
          w={200}
          data-testid="watch-search"
        />
        <Select
          value={stateFilter}
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
          label="Within % of trigger"
          value={withinPct}
          onChange={(v) => setWithinPct(typeof v === "number" ? v : v === "" ? "" : Number(v))}
          min={0}
          step={1}
          size="sm"
          w={170}
          data-testid="watch-within-pct"
        />
        <Switch
          label="Hide invalidated"
          size="sm"
          checked={hideInvalidated}
          onChange={(e) => setHideInvalidated(e.target.checked)}
          data-testid="watch-hide-invalidated"
        />
        <Text size="xs" c="dimmed" data-testid="watch-count">
          {`${filtered.length} / ${items.length}`}
        </Text>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleCopyCsv()}
          disabled={filtered.length === 0}
          data-testid="watch-copy-csv"
        >
          Copy CSV
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleCopySymbols()}
          disabled={filtered.length === 0}
          data-testid="watch-copy-symbols"
        >
          Copy symbols
        </Button>
        {copyMsg ? (
          <Text size="xs" c={copyFailed ? "error" : "success"} data-testid="watch-copy-toast">
            {copyMsg}
          </Text>
        ) : null}
      </ToolbarRow>

      {refreshing ? (
        <Text size="xs" c="dimmed" data-testid="watch-refreshing">
          Refreshing…
        </Text>
      ) : null}

      {error ? (
        <Alert color="error" data-testid="watch-error">
          {error}
        </Alert>
      ) : null}

      {loading && items.length === 0 ? (
        <Box
          data-testid="watch-loading"
          sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, py: 6 }}
        >
          <Loader size="lg" />
          <Text size="sm" c="dimmed">
            Loading watch list…
          </Text>
        </Box>
      ) : items.length === 0 && !error ? (
        <Box
          data-testid="watch-empty"
          sx={{
            border: "1px dashed",
            borderColor: "divider",
            borderRadius: 1,
            bgcolor: "background.paper",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1,
            py: 6,
            px: 2,
            textAlign: "center",
          }}
        >
          <Text size="sm" c="dimmed">
            No breakout candidates right now.
          </Text>
          <Text size="xs" c="dimmed">
            {`${universe} · ${timeframe} · ${setup}`}
          </Text>
        </Box>
      ) : (
        <TanStackTable<WatchRow>
          key={setup}
          data={filtered}
          columns={columns}
          dataTestId="watch-table"
          loading={loading}
          emptyMessage={items.length > 0 ? "No rows match the filters." : "No breakout candidates right now."}
          initialState={{ sorting: initialSorting }}
          onRowClick={(row) => onOpenSymbol?.(row.symbol)}
          getRowTestId={(row) => `watch-row-${row.symbol}`}
        />
      )}
    </Box>
  );
}
