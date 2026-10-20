import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Box, Button, SegmentedControl, Select, Skeleton, Tab, Tabs, TabsList, TabsPanel, Text, TextInput, ToolbarRow, Tooltip } from "@/ui";
import { fetchDailyReport, fetchReportBreakouts, fetchReportDelivery, fetchReportEvents, fetchReportFollowThrough, todayIST } from "../../api/report";
import { fetchRegime } from "../../api/eventWatch";
import type { RegimeResponse } from "../../types/eventWatch";
import type { DailyReportResponse, DeliveryResponse, FollowThroughResponse, ReportBreakoutsResponse, ReportEventsResponse, SectorLeader, SectorLeaderBoard } from "../../types/report";
import { copyToClipboard, toCsv, toSymbolList } from "../../utils/copyCsv";
import { formatNumber, formatPercentage, formatTimeOnly, getPnLTextColor } from "../../utils/ui-helpers";
import { ReportBreakoutTable } from "./ReportBreakoutTable";
import { ReportDeliveryStrip } from "./ReportDeliveryStrip";
import { ReportEventsStrip } from "./ReportEventsStrip";
import { ReportFollowThroughTable } from "./ReportFollowThrough";
import { EventWatch } from "./EventWatch";
import { ReportMovePanels } from "./ReportMovePanels";

export interface DailyReportPageProps {
  universe?: string;
  onOpenSymbol?: (symbol: string) => void;
}

const UNIVERSE_OPTIONS = [
  { value: "nifty500", label: "Nifty 500" },
  { value: "all", label: "All NSE" },
];

/** Per-section fetch timeout: a hung scan surfaces as a retryable section
 * error instead of an endless page spinner. */
const REPORT_FETCH_TIMEOUT_MS = 120000;

function formatVolume(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatNumber(v);
}

function BreadthStat({ label, value, testId, color }: { label: string; value: string; testId: string; color?: "success" | "error" | "dimmed" }) {
  return (
    <Box data-testid={testId} sx={{ display: "flex", alignItems: "baseline", gap: 0.5, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
      <Text size="xs" c="dimmed" span>
        {label}
      </Text>
      <Text size="xs" fw={700} c={color ?? "default"} span sx={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Text>
    </Box>
  );
}

/** One side of the leadership board: fixed header + aligned rows. Names are
 * left, change is right, so the eye scans a single numeric column. */
function LeaderRows({
  items,
  side,
  testId,
}: {
  items: SectorLeader[];
  side: "up" | "down";
  testId: string;
}) {
  if (items.length === 0) return null;
  const up = side === "up";
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.25,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Text size="xs" c={up ? "success" : "error"} fw={700} span>
          {up ? "▲ Leaders" : "▼ Laggards"}
        </Text>
        <Text size="xs" c="dimmed" fw={600} span>
          CHG
        </Text>
      </Box>
      {items.map((leader) => (
        <Tooltip
          key={leader.name}
          label={`${leader.stock_count} stocks · ${leader.advances} adv / ${leader.declines} dec`}
          withArrow
          placement="left"
        >
          <Box
            data-testid={`${testId}-item-${leader.name}`}
            sx={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              alignItems: "center",
              gap: 1,
              px: 1,
              minHeight: 20,
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <Text size="xs" span truncate>
              {leader.name}
            </Text>
            <Text
              size="xs"
              fw={600}
              c={leader.change >= 0 ? "success" : "error"}
              span
              sx={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatPercentage(leader.change)}
            </Text>
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}

/** Leadership board: sectors/themes split into leaders and laggards inside one
 * bordered section. Unlike a pill tape this never overflows horizontally —
 * every group is always visible at any width. */
function LeaderStrip({ leaders, testId, label }: { leaders: SectorLeader[] | SectorLeaderBoard | undefined; testId: string; label: string }) {
  // Backend sends `{top: [...5], bottom: [...5]}`; accept a flat array too.
  const all = (Array.isArray(leaders) ? leaders : [...(leaders?.top ?? []), ...(leaders?.bottom ?? [])]).filter(
    (l) => l && typeof l.name === "string",
  );
  if (all.length === 0) return null;
  const board = Array.isArray(leaders) ? null : leaders;
  const winners = (board ? board.top : all.filter((l) => l.change >= 0)).filter((l) => l && typeof l.name === "string");
  const losers = (board ? board.bottom : all.filter((l) => l.change < 0)).filter((l) => l && typeof l.name === "string");
  return (
    <Box
      data-testid={testId}
      sx={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 1, px: 1, py: 0.5, bgcolor: "action.hover" }}>
        <Text size="xs" c="dimmed" fw={700} tt="uppercase" span>
          {label}
        </Text>
        <Text size="xs" c="dimmed" span>
          {winners.length} up · {losers.length} down
        </Text>
      </Box>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
          columnGap: 2,
          rowGap: 1,
          p: 1,
          minWidth: 0,
        }}
      >
        <LeaderRows items={winners} side="up" testId={testId} />
        <LeaderRows items={losers} side="down" testId={testId} />
      </Box>
    </Box>
  );
}

/** Shift a YYYY-MM-DD date by ±days. Weekends/holidays are NOT skipped here —
 * the backend remaps non-trading days to the nearest session. */
function shiftDate(dateStr: string, deltaDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return todayIST();
  const base = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

export function DailyReportPage({ universe: universeProp = "nifty500", onOpenSymbol }: DailyReportPageProps) {
  const [date, setDate] = useState<string>(() => todayIST());
  const [universe, setUniverse] = useState<string>(universeProp);
  const [refreshKey, setRefreshKey] = useState(0);
  const [daily, setDaily] = useState<DailyReportResponse | null>(null);
  const [breakouts, setBreakouts] = useState<ReportBreakoutsResponse | null>(null);
  const [followThrough, setFollowThrough] = useState<FollowThroughResponse | null>(null);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [breakoutLoading, setBreakoutLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(true);
  const [deliveryLoading, setDeliveryLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [breakoutError, setBreakoutError] = useState<string | null>(null);
  const [followError, setFollowError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<DeliveryResponse | null>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [events, setEvents] = useState<ReportEventsResponse | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [regime, setRegime] = useState<RegimeResponse | null>(null);
  const [copied, setCopied] = useState<"csv" | "symbols" | null>(null);
  const [sparkRange, setSparkRange] = useState<"intraday" | "5d">("intraday");
  const [tab, setTab] = useState<string>("breakouts");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setUniverse(universeProp);
  }, [universeProp]);

  // The three sections load independently: a slow breakout scan must never
  // blank the (usually instant) market-moves section, and vice versa. Each
  // request gets its own timeout so a hung scan surfaces as a retryable
  // section error instead of an endless spinner.
  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
        timers.push(t);
        p.then(
          (v) => {
            clearTimeout(t);
            resolve(v);
          },
          (e) => {
            clearTimeout(t);
            reject(e);
          },
        );
      });
    setDailyLoading(true);
    setBreakoutLoading(true);
    setFollowLoading(true);
    setDeliveryLoading(true);
    setDailyError(null);
    setBreakoutError(null);
    setFollowError(null);
    setDeliveryError(null);
    withTimeout(fetchDailyReport(date, universe, controller.signal), REPORT_FETCH_TIMEOUT_MS, "Market moves")
      .then((payload) => {
        if (cancelled) return;
        setDaily(payload);
        setDailyLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setDailyError(err instanceof Error ? err.message : "Failed to load market moves");
        setDaily(null);
        setDailyLoading(false);
      });
    withTimeout(fetchReportBreakouts(date, universe, controller.signal), REPORT_FETCH_TIMEOUT_MS, "Breakout scan")
      .then((payload) => {
        if (cancelled) return;
        setBreakouts(payload);
        setBreakoutLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setBreakoutError(err instanceof Error ? err.message : "Failed to load breakout scan");
        setBreakouts(null);
        setBreakoutLoading(false);
      });
    // Delivery % (NSE bhavcopy) is date+universe scoped like the other
    // sections and loads independently; empty rows render as nothing.
    withTimeout(fetchReportDelivery(date, universe, 15, controller.signal), REPORT_FETCH_TIMEOUT_MS, "Delivery")
      .then((payload) => {
        if (cancelled) return;
        setDelivery(payload);
        setDeliveryLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setDeliveryError(err instanceof Error ? err.message : "Failed to load delivery data");
        setDelivery(null);
        setDeliveryLoading(false);
      });
    // Follow-through loads independently of the other two sections. The date
    // picker always holds a date, so this always fetches alongside them.
    if (date) {
      withTimeout(fetchReportFollowThrough(date, universe, controller.signal), REPORT_FETCH_TIMEOUT_MS, "Follow-through")
        .then((payload) => {
          if (cancelled) return;
          setFollowThrough(payload);
          setFollowLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          setFollowError(err instanceof Error ? err.message : "Failed to load follow-through");
          setFollowThrough(null);
          setFollowLoading(false);
        });
    } else {
      setFollowThrough(null);
      setFollowLoading(false);
    }
    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
      controller.abort();
    };
  }, [date, universe, refreshKey]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleShiftDate = useCallback((deltaDays: number) => {
    setDate((prev) => shiftDate(prev, deltaDays));
  }, []);

  // Market regime (Nifty 50 vs 20DMA) loads independently of every other
  // section: it is date/universe-agnostic, fail-soft (chip omitted on
  // error), and refetched only on manual refresh.
  useEffect(() => {
    let cancelled = false;
    fetchRegime()
      .then((payload) => {
        if (cancelled) return;
        setRegime(payload);
      })
      .catch(() => {
        if (cancelled) return;
        setRegime(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const breakoutCsvRows = useMemo(
    () => [...(breakouts?.breakouts.rows ?? []), ...(breakouts?.breakdowns.rows ?? [])],
    [breakouts],
  );

  // Events cover the symbols actually on screen (top movers + breakout
  // rows), capped: per-symbol yfinance fan-out can't cover 500 tickers.
  const eventSymbols = useMemo(() => {
    const out: string[] = [];
    const push = (s: string | undefined) => {
      const sym = (s ?? "").trim().toUpperCase();
      if (sym && !out.includes(sym) && out.length < 60) out.push(sym);
    };
    for (const r of (daily?.moves?.gainers ?? []).slice(0, 10)) push(r.symbol);
    for (const r of (daily?.moves?.losers ?? []).slice(0, 10)) push(r.symbol);
    for (const r of breakoutCsvRows) push(r.symbol);
    return out;
  }, [daily, breakoutCsvRows]);

  // Events load after the mover/breakout symbols are known; failures stay
  // inside the strip (fail-soft) and never touch the other sections.
  useEffect(() => {
    if (eventSymbols.length === 0) {
      setEvents(null);
      setEventsError(null);
      setEventsLoading(false);
      return;
    }
    let cancelled = false;
    setEventsLoading(true);
    setEventsError(null);
    const timer = setTimeout(() => {
      if (!cancelled) {
        setEventsError("Events timed out");
        setEvents(null);
        setEventsLoading(false);
      }
    }, REPORT_FETCH_TIMEOUT_MS);
    fetchReportEvents(eventSymbols, date, shiftDate(date, 21))
      .then((payload) => {
        if (cancelled) return;
        clearTimeout(timer);
        setEvents(payload);
        setEventsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        clearTimeout(timer);
        setEventsError(err instanceof Error ? err.message : "Failed to load events");
        setEvents(null);
        setEventsLoading(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [eventSymbols, date, refreshKey]);

  const handleCopyCsv = useCallback(async () => {
    const csv = toCsv(
      breakoutCsvRows.map((r) => ({
        symbol: r.symbol,
        name: r.name ?? "",
        type: r.type,
        level: r.level,
        close: r.close,
        pct_above: r.pct_above,
        volume_ratio: r.volume_ratio ?? "",
        change: r.change,
        sector: r.sector ?? "",
      })),
    );
    const ok = await copyToClipboard(csv);
    setCopied(ok ? "csv" : null);
  }, [breakoutCsvRows]);

  const handleCopySymbols = useCallback(async () => {
    const list = toSymbolList(breakoutCsvRows.map((r) => ({ symbol: r.symbol })));
    const ok = await copyToClipboard(list);
    setCopied(ok ? "symbols" : null);
  }, [breakoutCsvRows]);

  const asOf = daily?.as_of ?? breakouts?.as_of ?? null;
  const isCached = daily?.cached === true || breakouts?.cached === true;
  const breadth = daily?.breadth ?? null;
  const indexSnapshot = daily?.index ?? null;
  const breadthTotal = breadth ? breadth.advances + breadth.declines + breadth.unchanged : 0;
  const breadthShare = (n: number) => (breadthTotal > 0 ? `${(n / breadthTotal) * 100}%` : "0%");

  // Spark range toggle only appears when at least one breakout/breakdown row
  // carries daily closes; otherwise rows keep the single intraday spark.
  const hasDailyCloses = useMemo(() => {
    const rows = [...(breakouts?.breakouts.rows ?? []), ...(breakouts?.breakdowns.rows ?? [])];
    return rows.some((r) => Array.isArray(r.daily_closes) && r.daily_closes.length > 0);
  }, [breakouts]);

  // Page-level states (kept for compatibility): loading only while both
  // sections are still pending; error only when both failed.
  const loading = dailyLoading && breakoutLoading;
  const error = dailyError != null && breakoutError != null ? dailyError : null;

  const isEmpty =
    !dailyLoading &&
    !breakoutLoading &&
    !dailyError &&
    !breakoutError &&
    (breakouts?.breakouts.count ?? 0) === 0 &&
    (breakouts?.breakdowns.count ?? 0) === 0 &&
    Object.values(daily?.moves ?? {}).every((rows) => (rows ?? []).length === 0);

  return (
    <Box data-testid="daily-report" sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, width: "100%", flex: 1, fontVariantNumeric: "tabular-nums" }}>
      <ToolbarRow gap={8} data-testid="daily-report-toolbar" style={{ minHeight: 48, position: "sticky", top: 0, zIndex: 10, backgroundColor: "var(--mui-palette-background-paper)" }}>
        <Text size="sm" fw={700} span data-testid="report-title" sx={{ whiteSpace: "nowrap" }}>
          Daily Report
        </Text>
        <TextInput
          size="xs"
          w={140}
          type="date"
          value={date}
          onChange={setDate}
          data-testid="report-date"
          aria-label="Report date"
        />
        <Button size="xs" variant="subtle" onClick={() => handleShiftDate(-1)} data-testid="report-date-prev" aria-label="Previous day">
          ‹
        </Button>
        <Button size="xs" variant="subtle" onClick={() => handleShiftDate(1)} data-testid="report-date-next" aria-label="Next day">
          ›
        </Button>
        <Select
          size="xs"
          w={140}
          value={universe}
          onChange={(v) => {
            if (v) setUniverse(v);
          }}
          data={UNIVERSE_OPTIONS}
          data-testid="report-universe"
          aria-label="Universe"
        />
        <Button size="xs" variant="subtle" onClick={handleRefresh} data-testid="report-refresh" aria-label="Refresh report">
          Refresh
        </Button>
        {regime?.above != null && regime.close != null ? (
          <Tooltip
            label={regime.rule ?? "regime_long_ok: longs only when Nifty 50 closes above its 20-day moving average"}
            position="bottom"
          >
            <Badge
              size="xs"
              color={regime.above ? "success" : "error"}
              data-testid="report-regime"
            >
              Nifty {Math.round(regime.close).toLocaleString("en-IN")} · {regime.above ? "above 20DMA" : "below 20DMA"}
            </Badge>
          </Tooltip>
        ) : null}
        <Box sx={{ flex: 1, minWidth: 0 }} />
        {asOf ? (
          <Text size="xs" c="dimmed" truncate span data-testid="report-asof" title={isCached ? "Cached snapshot" : "Live snapshot"}>
            as of {formatTimeOnly(asOf)}
            {isCached ? (
              <Text size="xs" c="dimmed" span data-testid="report-cached">
                {" "}
                (cached)
              </Text>
            ) : null}
          </Text>
        ) : null}
        <Button
          size="xs"
          variant="subtle"
          onClick={handleCopyCsv}
          data-testid="report-copy-csv"
          aria-label="Copy breakouts as CSV"
        >
          {copied === "csv" ? "Copied!" : "Copy CSV"}
        </Button>
        <Button
          size="xs"
          variant="subtle"
          onClick={handleCopySymbols}
          data-testid="report-copy-symbols"
          aria-label="Copy breakout symbols"
        >
          {copied === "symbols" ? "Copied!" : "Copy symbols"}
        </Button>
      </ToolbarRow>

      {loading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, width: "100%", minWidth: 0 }} data-testid="report-loading">
          <Skeleton h={16} />
          <Skeleton h={16} />
          <Skeleton h={16} />
          <Skeleton h={16} />
        </Box>
      ) : error ? (
        <Box data-testid="report-error">
          <Alert color="error" data-testid="report-error-alert">
            {error}
          </Alert>
        </Box>
      ) : isEmpty ? (
        <Box sx={{ p: 2, textAlign: "center", width: "100%" }} data-testid="report-empty">
          <Text size="xs" c="dimmed">
            No unusual moves or breakouts for {date}
          </Text>
        </Box>
      ) : (
        <Tabs value={tab} onChange={(v) => { if (v) setTab(v); }} data-testid="report-tabs">
          <Box sx={{ overflowX: "auto", minWidth: 0 }}>
            <TabsList data-testid="report-tabs-list">
              <Tab value="scan" data-testid="report-tab-scan">
                Scan
              </Tab>
              <Tab value="breakouts" data-testid="report-tab-breakouts">
                Breakouts
              </Tab>
              <Tab value="moves" data-testid="report-tab-moves">
                Moves
              </Tab>
              <Tab value="followthrough" data-testid="report-tab-followthrough">
                Follow-through
              </Tab>
              <Tab value="events" data-testid="report-tab-events">
                Events
              </Tab>
            </TabsList>
          </Box>
          <TabsPanel value="scan" keepMounted data-testid="report-tab-panel-scan" sx={{ py: 1 }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          {dailyLoading ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, width: "100%", minWidth: 0 }} data-testid="report-daily-loading">
              <Skeleton h={16} />
              <Skeleton h={16} />
            </Box>
          ) : dailyError ? (
            <Box data-testid="report-daily-error">
              <Alert color="error" data-testid="report-daily-error-alert">
                {dailyError}
              </Alert>
            </Box>
          ) : (
            <>
              {breadth ? (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }} data-testid="report-breadth-block">
                  <ToolbarRow gap={8} wrap data-testid="report-breadth">
                    {indexSnapshot ? (
                      <BreadthStat
                        label={indexSnapshot.name}
                        value={formatPercentage(indexSnapshot.change)}
                        testId="report-breadth-index"
                        color={getPnLTextColor(indexSnapshot.change)}
                      />
                    ) : null}
                    <BreadthStat label="Adv" value={String(breadth.advances)} testId="report-breadth-advances" color="success" />
                    <BreadthStat label="Dec" value={String(breadth.declines)} testId="report-breadth-declines" color="error" />
                    <BreadthStat label="Unch" value={String(breadth.unchanged)} testId="report-breadth-unchanged" color="dimmed" />
                    <BreadthStat label="New highs" value={String(breadth.new_highs)} testId="report-breadth-new-highs" color="success" />
                    <BreadthStat label="New lows" value={String(breadth.new_lows)} testId="report-breadth-new-lows" color="error" />
                    <BreadthStat label="Avg" value={formatPercentage(breadth.avg_change)} testId="report-breadth-avg" />
                    <BreadthStat label="Median" value={formatPercentage(breadth.median_change)} testId="report-breadth-median" />
                    <BreadthStat label="Up vol" value={formatVolume(breadth.up_volume)} testId="report-breadth-up-volume" />
                    <BreadthStat label="Down vol" value={formatVolume(breadth.down_volume)} testId="report-breadth-down-volume" />
                  </ToolbarRow>
                  {breadthTotal > 0 ? (
                    <Box
                      data-testid="report-breadth-bar"
                      role="img"
                      aria-label={`${breadth.advances} advances, ${breadth.declines} declines, ${breadth.unchanged} unchanged`}
                      sx={{ display: "flex", width: "100%", height: 6, borderRadius: 0.5, overflow: "hidden", bgcolor: "divider" }}
                    >
                      <Box sx={{ width: breadthShare(breadth.advances), bgcolor: "success.main" }} />
                      <Box sx={{ width: breadthShare(breadth.unchanged), bgcolor: "text.disabled" }} />
                      <Box sx={{ width: breadthShare(breadth.declines), bgcolor: "error.main" }} />
                    </Box>
                  ) : null}
                </Box>
              ) : null}
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
                  gap: 1,
                  minWidth: 0,
                  alignItems: "start",
                }}
              >
                <LeaderStrip leaders={daily?.sector_leaders} testId="report-sector-leaders" label="Sectors" />
                <LeaderStrip leaders={daily?.theme_leaders} testId="report-theme-leaders" label="Themes" />
              </Box>
            </>
          )}
            </Box>
          </TabsPanel>
          <TabsPanel value="moves" keepMounted data-testid="report-tab-panel-moves" sx={{ py: 1 }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              {dailyLoading ? (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, width: "100%", minWidth: 0 }} data-testid="report-moves-loading">
                  <Skeleton h={16} />
                  <Skeleton h={16} />
                </Box>
              ) : dailyError ? (
                <Box data-testid="report-moves-error">
                  <Alert color="error" data-testid="report-moves-error-alert">
                    {dailyError}
                  </Alert>
                </Box>
              ) : (
                <>
                  <ToolbarRow gap={8} wrap={false}>
                    <Text size="sm" fw={700} span data-testid="report-moves-title">
                      Unusual moves
                    </Text>
                  </ToolbarRow>
                  <ReportMovePanels moves={daily?.moves ?? null} onOpenSymbol={onOpenSymbol} />
                </>
              )}
            </Box>
          </TabsPanel>
          <TabsPanel value="breakouts" keepMounted data-testid="report-tab-panel-breakouts" sx={{ py: 1 }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          {breakoutLoading ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, width: "100%", minWidth: 0 }} data-testid="report-breakouts-loading">
              <Skeleton h={16} />
              <Skeleton h={16} />
            </Box>
          ) : breakoutError ? (
            <Box data-testid="report-breakouts-error">
              <Alert color="error" data-testid="report-breakouts-error-alert">
                {breakoutError}
              </Alert>
            </Box>
          ) : (
            <>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }} data-testid="report-breakouts-meta">
            <Badge size="xs" data-testid="report-breakouts-scanned">
              {breakouts?.scanned ?? 0} scanned
            </Badge>
            <Text size="xs" c="dimmed" span>
              {breakouts?.universe ?? universe} · {breakouts?.date ?? date}
            </Text>
            {hasDailyCloses ? (
              <SegmentedControl
                size="xs"
                value={sparkRange}
                onChange={(v) => setSparkRange(v === "5d" ? "5d" : "intraday")}
                data={[
                  { value: "intraday", label: "Intraday" },
                  { value: "5d", label: "5D" },
                ]}
                data-testid="report-spark-range"
              />
            ) : null}
          </Box>
          <Box
            sx={{
              display: "grid",
              // Full-width stacked tables: nine columns per side do not fit in
              // a half-width cell, and each table grew its own horizontal
              // scrollbar. Stacking keeps one reading column and no inner
              // horizontal scroll.
              gridTemplateColumns: "minmax(0, 1fr)",
              gap: 1,
              alignItems: "start",
              minWidth: 0,
              width: "100%",
            }}
          >
          <ReportBreakoutTable
            title="Breakouts TODAY"
            side={breakouts?.breakouts ?? null}
            direction="up"
            testId="report-breakouts-table"
            onOpenSymbol={onOpenSymbol}
            emptyMessage="No breakouts today"
            sparkRange={sparkRange}
          />
          <ReportBreakoutTable
            title="Breakdowns TODAY"
            side={breakouts?.breakdowns ?? null}
            direction="down"
            testId="report-breakdowns-table"
            onOpenSymbol={onOpenSymbol}
            emptyMessage="No breakdowns today"
            sparkRange={sparkRange}
          />
          </Box>
            </>
          )}
            </Box>
          </TabsPanel>
          <TabsPanel value="followthrough" keepMounted data-testid="report-tab-panel-followthrough" sx={{ py: 1 }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <ReportDeliveryStrip data={delivery} loading={deliveryLoading} error={deliveryError} onOpenSymbol={onOpenSymbol} />
          {followLoading ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, width: "100%", minWidth: 0 }} data-testid="report-followthrough-loading">
              <Skeleton h={16} />
              <Skeleton h={16} />
            </Box>
          ) : followError ? (
            <Box data-testid="report-followthrough-error">
              <Alert color="error" data-testid="report-followthrough-error-alert">
                {followError}
              </Alert>
            </Box>
          ) : (
            <Box data-testid="report-followthrough" sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" }, gap: 1, alignItems: "start", minWidth: 0 }}>
              <ReportFollowThroughTable
                title="Breakout follow-through"
                side={followThrough?.breakouts ?? null}
                testId="report-followthrough-breakouts"
                onOpenSymbol={onOpenSymbol}
                emptyMessage="No breakout follow-through"
                emptyNote={
                  followThrough?.date
                    ? `No breakouts on ${followThrough.date} to follow`
                    : undefined
                }
              />
              <ReportFollowThroughTable
                title="Breakdown follow-through"
                side={followThrough?.breakdowns ?? null}
                testId="report-followthrough-breakdowns"
                onOpenSymbol={onOpenSymbol}
                emptyMessage="No breakdown follow-through"
                emptyNote={
                  followThrough?.date
                    ? `No breakdowns on ${followThrough.date} to follow`
                    : undefined
                }
              />
            </Box>
          )}
            </Box>
          </TabsPanel>
          <TabsPanel value="events" keepMounted data-testid="report-tab-panel-events" sx={{ py: 1 }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <EventWatch universe={universe} daily={daily} onOpenSymbol={onOpenSymbol} />
              <ReportEventsStrip data={events} loading={eventsLoading} error={eventsError} onOpenSymbol={onOpenSymbol} />
            </Box>
          </TabsPanel>
        </Tabs>
      )}
    </Box>
  );
}

export default DailyReportPage;
