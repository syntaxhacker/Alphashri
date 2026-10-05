import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert, Badge, Box, Button, Loader, NumberInput, Select, Switch, Text, TextInput, ToolbarRow, Tooltip } from "@/ui";
import { TanStackTable } from "@/components/common/TanStackTable";
import { fetchMarketStatus, fetchWatch, fetchWatchSetups } from "@/api/chartPatterns";
import type { MarketStatus, WatchRow, WatchSetup } from "@/types/chartPatterns";
import { formatPercentage } from "@/utils/ui-helpers";

/** Re-fetch cadence for the watch list while the market is open. */
export const WATCH_POLL_MS = 20000;
/** Refresh cadence for the holiday-aware market-status probe. */
export const MARKET_STATUS_POLL_MS = 180000;
/** Default "Within % of trigger" filter: open focused on actionable rows. */
export const WATCH_DEFAULT_WITHIN_PCT = 5;

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

const COLUMNS: ColumnDef<WatchRow>[] = [
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
    cell: (ctx) => {
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
        </Box>
      );
    },
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

/**
 * Breakout Watch tab body: setup picker + rel-vol filter + live watch table.
 * Polls `/watch` every 20s while the market is open. Liveness is gated on the
 * holiday-aware `/market-status` probe (`open === true`); the IST 09:15–15:30
 * Mon–Fri clock is only a fallback when that probe fails.
 */
export function WatchView({ universe, timeframe, minBaseDays = null, onOpenSymbol }: WatchViewProps) {
  const [setups, setSetups] = useState<WatchSetup[]>([]);
  const [setup, setSetup] = useState("breakout");
  const [relVol, setRelVol] = useState<number | string>(1.5);
  const [relVolDefaulted, setRelVolDefaulted] = useState(false);
  const [items, setItems] = useState<WatchRow[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
            setRelVol(current.default_min_rel_volume ?? 1.5);
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
      if (background) setRefreshing(true);
      else setLoading(true);
      try {
        const payload = await fetchWatch({
          setup,
          universe,
          timeframe,
          minBaseDays,
          minRelVolume,
        });
        if (requestRef.current !== token) return;
        setItems(payload.items ?? []);
        setUpdatedAt(payload.updated_at ?? null);
        setError(null);
      } catch (err) {
        if (requestRef.current !== token) return;
        setError(err instanceof Error && err.message ? err.message : "Failed to load watch list");
      } finally {
        if (requestRef.current === token) {
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

  // Holiday-aware market status: fetched once on mount, refreshed every few
  // minutes. While available it gates the live badge + the 20s poll; when the
  // probe fails we fall back to the client-side IST clock.
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

  // Live polling: every 20s, fetch in the background while the market is open.
  useEffect(() => {
    const tickLive = (): boolean => {
      const server = marketStatusRef.current;
      const open = server ? server.open : isWatchLiveNow();
      setLive(open);
      return open;
    };
    setLive(tickLive());
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
    return items.filter((row) => {
      if (q && !String(row.symbol || "").toUpperCase().includes(q)) return false;
      if (hideInvalidated && row.state === "invalidated") return false;
      if (stateFilter !== "all" && row.state !== stateFilter) return false;
      if (maxAbs != null) {
        const pct = row.pct_to_trigger;
        if (pct == null || Math.abs(pct) > maxAbs) return false;
      }
      return true;
    });
  }, [items, search, stateFilter, withinPct, hideInvalidated]);

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
          <NumberInput
            label="Rel vol ≥"
            value={relVol}
            onChange={(v) => setRelVol(typeof v === "number" ? v : v === "" ? "" : Number(v))}
            min={0}
            step={0.1}
            w={140}
            size="sm"
            data-testid="watch-relvol-input"
          />
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
          data={filtered}
          columns={COLUMNS}
          dataTestId="watch-table"
          loading={loading}
          emptyMessage={items.length > 0 ? "No rows match the filters." : "No breakout candidates right now."}
          initialState={{ sorting: [{ id: "pct_to_trigger", desc: true }] }}
          onRowClick={(row) => onOpenSymbol?.(row.symbol)}
          getRowTestId={(row) => `watch-row-${row.symbol}`}
        />
      )}
    </Box>
  );
}
