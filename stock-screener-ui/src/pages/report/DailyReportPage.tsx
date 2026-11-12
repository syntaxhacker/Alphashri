import { formatNumberIN } from "@/utils/ui-helpers";
import { createEffect, createMemo, createSignal, For, Show, onCleanup } from "solid-js";
import { Alert, Badge, Button, SegmentedControl, Select, Skeleton, Text, TextInput, ToolbarRow, Tooltip } from "@/ui";
import { fetchDailyReport, fetchReportBreakouts, fetchReportDelivery, fetchReportEvents, fetchReportFollowThrough, todayIST } from "../../api/report";
import { fetchRegime } from "../../api/eventWatch";
import type { RegimeResponse } from "../../types/eventWatch";
import type { DailyReportResponse, DeliveryResponse, FollowThroughResponse, ReportBreakoutsResponse, ReportEventsResponse } from "../../types/report";
import { copyToClipboard, toCsv, toSymbolList } from "../../utils/copyCsv";
import { formatNumber, formatPercentage, formatTimeOnly, getPnLTextColor } from "../../utils/ui-helpers";
import { ReportBreakoutTable } from "./ReportBreakoutTable";
import { ReportDeliveryStrip } from "./ReportDeliveryStrip";
import { ReportEventsStrip } from "./ReportEventsStrip";
import { ReportFollowThroughTable } from "./ReportFollowThrough";
import { EventWatch } from "./EventWatch";
import { ReportMovePanels } from "./ReportMovePanels";
import { BreadthStat, LeaderStrip } from "./ReportLeaderStrip";

interface DailyReportPageProps {
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

/** Compact breadth volume ("1.2Cr"), dash when the feed sent no number. */
const formatVolume = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? "—" : formatNumber(v);

/** Shift a YYYY-MM-DD date by ±days. Weekends/holidays are NOT skipped here —
 * the backend remaps non-trading days to the nearest session. */
function shiftDate(dateStr: string, deltaDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return todayIST();
  const base = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

export function DailyReportPage(props: DailyReportPageProps) {
  const [date, setDate] = createSignal<string>(todayIST());
  const [universe, setUniverse] = createSignal<string>(props.universe ?? "nifty500");
  const [refreshKey, setRefreshKey] = createSignal(0);
  const [daily, setDaily] = createSignal<DailyReportResponse | null>(null);
  const [breakouts, setBreakouts] = createSignal<ReportBreakoutsResponse | null>(null);
  const [followThrough, setFollowThrough] = createSignal<FollowThroughResponse | null>(null);
  const [dailyLoading, setDailyLoading] = createSignal(true);
  const [breakoutLoading, setBreakoutLoading] = createSignal(true);
  const [followLoading, setFollowLoading] = createSignal(true);
  const [deliveryLoading, setDeliveryLoading] = createSignal(true);
  const [eventsLoading, setEventsLoading] = createSignal(true);
  const [dailyError, setDailyError] = createSignal<string | null>(null);
  const [breakoutError, setBreakoutError] = createSignal<string | null>(null);
  const [followError, setFollowError] = createSignal<string | null>(null);
  const [delivery, setDelivery] = createSignal<DeliveryResponse | null>(null);
  const [deliveryError, setDeliveryError] = createSignal<string | null>(null);
  const [events, setEvents] = createSignal<ReportEventsResponse | null>(null);
  const [eventsError, setEventsError] = createSignal<string | null>(null);
  const [regime, setRegime] = createSignal<RegimeResponse | null>(null);
  const [copied, setCopied] = createSignal<"csv" | "symbols" | null>(null);
  const [sparkRange, setSparkRange] = createSignal<"intraday" | "5d">("intraday");
  const [tab, setTab] = createSignal<string>("breakouts");
  let abortController: AbortController | null = null;

  // Universe prop is the initial value, not a controlled mirror of it — the
  // Select owns the signal afterwards.
  createEffect(() => {
    const next = props.universe;
    if (next) setUniverse(next);
  });

  // The three sections load independently: a slow breakout scan must never
  // blank the (usually instant) market-moves section, and vice versa. Each
  // request gets its own timeout so a hung scan surfaces as a retryable
  // section error instead of an endless spinner.
  createEffect(() => {
    // Track the scope; re-runs when date/universe/refreshKey change.
    date(); universe(); refreshKey();
    abortController?.abort();
    const controller = new AbortController();
    abortController = controller;
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
    withTimeout(fetchDailyReport(date(), universe(), controller.signal), REPORT_FETCH_TIMEOUT_MS, "Market moves")
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
    withTimeout(fetchReportBreakouts(date(), universe(), controller.signal), REPORT_FETCH_TIMEOUT_MS, "Breakout scan")
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
    withTimeout(fetchReportDelivery(date(), universe(), 15, controller.signal), REPORT_FETCH_TIMEOUT_MS, "Delivery")
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
    if (date()) {
      withTimeout(fetchReportFollowThrough(date(), universe(), controller.signal), REPORT_FETCH_TIMEOUT_MS, "Follow-through")
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
    onCleanup(() => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
      controller.abort();
    });
  });

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  const handleShiftDate = (deltaDays: number) => {
    setDate((prev) => shiftDate(prev, deltaDays));
  };

  // Market regime (Nifty 50 vs 20DMA) loads independently of every other
  // section: it is date/universe-agnostic, fail-soft (chip omitted on
  // error), and refetched only on manual refresh.
  createEffect(() => {
    refreshKey();
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
    onCleanup(() => {
      cancelled = true;
    });
  });

  const breakoutCsvRows = createMemo(
    () => [...(breakouts()?.breakouts.rows ?? []), ...(breakouts()?.breakdowns.rows ?? [])],
  );

  // Events cover the symbols actually on screen (top movers + breakout
  // rows), capped: per-symbol yfinance fan-out can't cover 500 tickers.
  const eventSymbols = createMemo(() => {
    const out: string[] = [];
    const push = (s: string | undefined) => {
      const sym = (s ?? "").trim().toUpperCase();
      if (sym && !out.includes(sym) && out.length < 60) out.push(sym);
    };
    for (const r of (daily()?.moves?.gainers ?? []).slice(0, 10)) push(r.symbol);
    for (const r of (daily()?.moves?.losers ?? []).slice(0, 10)) push(r.symbol);
    for (const r of breakoutCsvRows()) push(r.symbol);
    return out;
  });

  // Events load after the mover/breakout symbols are known; failures stay
  // inside the strip (fail-soft) and never touch the other sections.
  createEffect(() => {
    const symbols = eventSymbols();
    date();
    refreshKey();
    if (symbols.length === 0) {
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
    fetchReportEvents(symbols, date(), shiftDate(date(), 21))
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
    onCleanup(() => {
      cancelled = true;
      clearTimeout(timer);
    });
  });

  const handleCopyCsv = async () => {
    const csv = toCsv(
      breakoutCsvRows().map((r) => ({
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
  };

  const handleCopySymbols = async () => {
    const list = toSymbolList(breakoutCsvRows().map((r) => ({ symbol: r.symbol })));
    const ok = await copyToClipboard(list);
    setCopied(ok ? "symbols" : null);
  };

  const asOf = () => daily()?.as_of ?? breakouts()?.as_of ?? null;
  const isCached = () => daily()?.cached === true || breakouts()?.cached === true;
  const breadth = () => daily()?.breadth ?? null;
  const indexSnapshot = () => daily()?.index ?? null;
  const breadthTotal = () => {
    const b = breadth();
    return b ? b.advances + b.declines + b.unchanged : 0;
  };
  const breadthShare = (n: number) =>
    breadthTotal() > 0 ? `${(n / breadthTotal()) * 100}%` : "0%";

  // Spark range toggle only appears when at least one breakout/breakdown row
  // carries daily closes; otherwise rows keep the single intraday spark.
  const hasDailyCloses = createMemo(() => {
    const rows = [...(breakouts()?.breakouts.rows ?? []), ...(breakouts()?.breakdowns.rows ?? [])];
    return rows.some((r) => Array.isArray(r.daily_closes) && r.daily_closes.length > 0);
  });

  // Page-level states (kept for compatibility): loading only while both
  // sections are still pending; error only when both failed.
  const loading = () => dailyLoading() && breakoutLoading();
  const error = () => (dailyError() != null && breakoutError() != null ? dailyError() : null);

  const isEmpty = () =>
    !dailyLoading() &&
    !breakoutLoading() &&
    !dailyError() &&
    !breakoutError() &&
    (breakouts()?.breakouts.count ?? 0) === 0 &&
    (breakouts()?.breakdowns.count ?? 0) === 0 &&
    Object.values(daily()?.moves ?? {}).every((rows) => (rows ?? []).length === 0);

  const tabs: { value: string; label: string; testId: string }[] = [
    { value: "scan", label: "Scan", testId: "report-tab-scan" },
    { value: "breakouts", label: "Breakouts", testId: "report-tab-breakouts" },
    { value: "moves", label: "Moves", testId: "report-tab-moves" },
    { value: "followthrough", label: "Follow-through", testId: "report-tab-followthrough" },
    { value: "events", label: "Events", testId: "report-tab-events" },
  ];

  return (
    <div data-testid="daily-report" class="flex flex-col gap-1 min-w-0 w-full flex-1 tabular-nums">
      <ToolbarRow gap={8} data-testid="daily-report-toolbar" style={{ "min-height": "36px", position: "sticky", top: 0, "z-index": 10, "background-color": "var(--color-fin-surface)" }}>
        <Text size="sm" fw={700} span data-testid="report-title" className="whitespace-nowrap">
          Daily Report
        </Text>
        <TextInput
          size="xs"
          w={140}
          type="date"
          value={date()}
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
          value={universe()}
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
        <Show when={regime()?.above != null && regime()?.close != null}>
          <Tooltip
            label={regime()!.rule ?? "regime_long_ok: longs only when Nifty 50 closes above its 20-day moving average"}
            position="bottom"
          >
            <Badge
              size="xs"
              color={regime()!.above ? "success" : "error"}
              data-testid="report-regime"
            >
              Nifty {formatNumberIN(Math.round(regime()!.close!))} · {regime()!.above ? "above 20DMA" : "below 20DMA"}
            </Badge>
          </Tooltip>
        </Show>
        <div class="flex-1 min-w-0" />
        <Show when={asOf()}>
          <Text size="xs" c="dimmed" truncate span data-testid="report-asof" title={isCached() ? "Cached snapshot" : "Live snapshot"}>
            as of {formatTimeOnly(asOf()!)}
            <Show when={isCached()}>
              <Text size="xs" c="dimmed" span data-testid="report-cached">
                {" "}
                (cached)
              </Text>
            </Show>
          </Text>
        </Show>
        <Button
          size="xs"
          variant="subtle"
          onClick={handleCopyCsv}
          data-testid="report-copy-csv"
          aria-label="Copy breakouts as CSV"
        >
          {copied() === "csv" ? "Copied!" : "Copy CSV"}
        </Button>
        <Button
          size="xs"
          variant="subtle"
          onClick={handleCopySymbols}
          data-testid="report-copy-symbols"
          aria-label="Copy breakout symbols"
        >
          {copied() === "symbols" ? "Copied!" : "Copy symbols"}
        </Button>
      </ToolbarRow>

      <Show
        when={loading()}
        fallback={
          <Show
            when={error()}
            fallback={
              <Show
                when={isEmpty()}
                fallback={
                  <div class="flex flex-col gap-1 min-w-0 w-full" data-testid="report-tabs">
                    <div class="overflow-x-auto min-w-0">
                      <div class="flex flex-row items-center gap-1 rounded-fin border border-fin-border bg-fin-surface p-[2px]" role="tablist" data-testid="report-tabs-list">
                        <For each={tabs}>
                          {(t) => (
                            <button
                              type="button"
                              role="tab"
                              aria-selected={tab() === t.value}
                              data-testid={t.testId}
                              class={`px-2 h-7 text-[11px] leading-none rounded-sm border transition-colors duration-150 ${
                                tab() === t.value
                                  ? "bg-neutral-800 text-neutral-100 border-neutral-700"
                                  : "text-neutral-400 border-transparent hover:text-neutral-200"
                              }`}
                              onClick={() => setTab(t.value)}
                            >
                              {t.label}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                    <div hidden={tab() !== "scan"} data-testid="report-tab-panel-scan" style={{ "padding-top": "4px", "padding-bottom": "4px" }}>
                      <div class="flex flex-col gap-1 min-w-0">
                        <Show
                          when={dailyLoading()}
                          fallback={
                            <Show
                              when={dailyError()}
                              fallback={
                                <>
                                  <Show when={breadth()}>
                                    <div class="flex flex-col gap-1 min-w-0" data-testid="report-breadth-block">
                                      <ToolbarRow gap={8} wrap data-testid="report-breadth">
                                        <Show when={indexSnapshot()}>
                                          <BreadthStat
                                            label={indexSnapshot()!.name}
                                            value={formatPercentage(indexSnapshot()!.change)}
                                            testId="report-breadth-index"
                                            color={getPnLTextColor(indexSnapshot()!.change)}
                                          />
                                        </Show>
                                        <BreadthStat label="Adv" value={String(breadth()!.advances)} testId="report-breadth-advances" color="success" />
                                        <BreadthStat label="Dec" value={String(breadth()!.declines)} testId="report-breadth-declines" color="error" />
                                        <BreadthStat label="Unch" value={String(breadth()!.unchanged)} testId="report-breadth-unchanged" color="dimmed" />
                                        <BreadthStat label="New highs" value={String(breadth()!.new_highs)} testId="report-breadth-new-highs" color="success" />
                                        <BreadthStat label="New lows" value={String(breadth()!.new_lows)} testId="report-breadth-new-lows" color="error" />
                                        <BreadthStat label="Avg" value={formatPercentage(breadth()!.avg_change)} testId="report-breadth-avg" />
                                        <BreadthStat label="Median" value={formatPercentage(breadth()!.median_change)} testId="report-breadth-median" />
                                        <BreadthStat label="Up vol" value={formatVolume(breadth()!.up_volume)} testId="report-breadth-up-volume" />
                                        <BreadthStat label="Down vol" value={formatVolume(breadth()!.down_volume)} testId="report-breadth-down-volume" />
                                      </ToolbarRow>
                                      <Show when={breadthTotal() > 0}>
                                        <div
                                          data-testid="report-breadth-bar"
                                          role="img"
                                          aria-label={`${breadth()!.advances} advances, ${breadth()!.declines} declines, ${breadth()!.unchanged} unchanged`}
                                          class="flex w-full h-[6px] rounded-[2px] overflow-hidden bg-fin-border"
                                        >
                                          <div class="bg-fin-positive" style={{ width: breadthShare(breadth()!.advances) }} />
                                          <div class="bg-fin-text-muted" style={{ width: breadthShare(breadth()!.unchanged) }} />
                                          <div class="bg-fin-negative" style={{ width: breadthShare(breadth()!.declines) }} />
                                        </div>
                                      </Show>
                                    </div>
                                  </Show>
                                  <div
                                    class="grid grid-cols-1 min-[1200px]:grid-cols-2 gap-1 min-w-0 items-start"
                                  >
                                    <LeaderStrip leaders={daily()?.sector_leaders} testId="report-sector-leaders" label="Sectors" />
                                    <LeaderStrip leaders={daily()?.theme_leaders} testId="report-theme-leaders" label="Themes" />
                                  </div>
                                </>
                              }
                            >
                              <div data-testid="report-daily-error">
                                <Alert color="error" data-testid="report-daily-error-alert">
                                  {dailyError()}
                                </Alert>
                              </div>
                            </Show>
                          }
                        >
                          <div class="flex flex-col gap-1 w-full min-w-0" data-testid="report-daily-loading">
                            <Skeleton h={16} />
                            <Skeleton h={16} />
                          </div>
                        </Show>
                      </div>
                    </div>
                    <div hidden={tab() !== "moves"} data-testid="report-tab-panel-moves" style={{ "padding-top": "4px", "padding-bottom": "4px" }}>
                      <div class="flex flex-col gap-1 min-w-0">
                        <Show
                          when={dailyLoading()}
                          fallback={
                            <Show
                              when={dailyError()}
                              fallback={
                                <>
                                  <ToolbarRow gap={8} wrap={false}>
                                    <Text size="sm" fw={700} span data-testid="report-moves-title">
                                      Unusual moves
                                    </Text>
                                  </ToolbarRow>
                                  <ReportMovePanels moves={daily()?.moves ?? null} onOpenSymbol={props.onOpenSymbol} />
                                </>
                              }
                            >
                              <div data-testid="report-moves-error">
                                <Alert color="error" data-testid="report-moves-error-alert">
                                  {dailyError()}
                                </Alert>
                              </div>
                            </Show>
                          }
                        >
                          <div class="flex flex-col gap-1 w-full min-w-0" data-testid="report-moves-loading">
                            <Skeleton h={16} />
                            <Skeleton h={16} />
                          </div>
                        </Show>
                      </div>
                    </div>
                    <div hidden={tab() !== "breakouts"} data-testid="report-tab-panel-breakouts" style={{ "padding-top": "4px", "padding-bottom": "4px" }}>
                      <div class="flex flex-col gap-1 min-w-0">
                        <Show
                          when={breakoutLoading()}
                          fallback={
                            <Show
                              when={breakoutError()}
                              fallback={
                                <>
                                  <div class="flex items-center gap-2" data-testid="report-breakouts-meta">
                                    <Badge size="xs" data-testid="report-breakouts-scanned">
                                      {breakouts()?.scanned ?? 0} scanned
                                    </Badge>
                                    <Text size="xs" c="dimmed" span>
                                      {breakouts()?.universe ?? universe()} · {breakouts()?.date ?? date()}
                                    </Text>
                                    <Show when={hasDailyCloses()}>
                                      <SegmentedControl
                                        size="xs"
                                        value={sparkRange()}
                                        onChange={(v) => setSparkRange(v === "5d" ? "5d" : "intraday")}
                                        data={[
                                          { value: "intraday", label: "Intraday" },
                                          { value: "5d", label: "5D" },
                                        ]}
                                        data-testid="report-spark-range"
                                      />
                                    </Show>
                                  </div>
                                  {/* Full-width stacked tables: nine columns per side do not fit in
                                      a half-width cell, and each table grew its own horizontal
                                      scrollbar. Stacking keeps one reading column and no inner
                                      horizontal scroll. */}
                                  <div
                                    class="grid grid-cols-1 gap-1 items-start min-w-0 w-full"
                                  >
                                    <ReportBreakoutTable
                                      title="Breakouts TODAY"
                                      side={breakouts()?.breakouts ?? null}
                                      direction="up"
                                      testId="report-breakouts-table"
                                      onOpenSymbol={props.onOpenSymbol}
                                      emptyMessage="No breakouts today"
                                      sparkRange={sparkRange()}
                                    />
                                    <ReportBreakoutTable
                                      title="Breakdowns TODAY"
                                      side={breakouts()?.breakdowns ?? null}
                                      direction="down"
                                      testId="report-breakdowns-table"
                                      onOpenSymbol={props.onOpenSymbol}
                                      emptyMessage="No breakdowns today"
                                      sparkRange={sparkRange()}
                                    />
                                  </div>
                                </>
                              }
                            >
                              <div data-testid="report-breakouts-error">
                                <Alert color="error" data-testid="report-breakouts-error-alert">
                                  {breakoutError()}
                                </Alert>
                              </div>
                            </Show>
                          }
                        >
                          <div class="flex flex-col gap-1 w-full min-w-0" data-testid="report-breakouts-loading">
                            <Skeleton h={16} />
                            <Skeleton h={16} />
                          </div>
                        </Show>
                      </div>
                    </div>
                    <div hidden={tab() !== "followthrough"} data-testid="report-tab-panel-followthrough" style={{ "padding-top": "4px", "padding-bottom": "4px" }}>
                      <div class="flex flex-col gap-1 min-w-0">
                        <ReportDeliveryStrip data={delivery()} loading={deliveryLoading()} error={deliveryError()} onOpenSymbol={props.onOpenSymbol} />
                        <Show
                          when={followLoading()}
                          fallback={
                            <Show
                              when={followError()}
                              fallback={
                                <div data-testid="report-followthrough" class="grid grid-cols-1 min-[1200px]:grid-cols-2 gap-1 items-start min-w-0">
                                  <ReportFollowThroughTable
                                    title="Breakout follow-through"
                                    side={followThrough()?.breakouts ?? null}
                                    testId="report-followthrough-breakouts"
                                    onOpenSymbol={props.onOpenSymbol}
                                    emptyMessage="No breakout follow-through"
                                    emptyNote={
                                      followThrough()?.date
                                        ? `No breakouts on ${followThrough()!.date} to follow`
                                        : undefined
                                    }
                                  />
                                  <ReportFollowThroughTable
                                    title="Breakdown follow-through"
                                    side={followThrough()?.breakdowns ?? null}
                                    testId="report-followthrough-breakdowns"
                                    onOpenSymbol={props.onOpenSymbol}
                                    emptyMessage="No breakdown follow-through"
                                    emptyNote={
                                      followThrough()?.date
                                        ? `No breakdowns on ${followThrough()!.date} to follow`
                                        : undefined
                                    }
                                  />
                                </div>
                              }
                            >
                              <div data-testid="report-followthrough-error">
                                <Alert color="error" data-testid="report-followthrough-error-alert">
                                  {followError()}
                                </Alert>
                              </div>
                            </Show>
                          }
                        >
                          <div class="flex flex-col gap-1 w-full min-w-0" data-testid="report-followthrough-loading">
                            <Skeleton h={16} />
                            <Skeleton h={16} />
                          </div>
                        </Show>
                      </div>
                    </div>
                    <div hidden={tab() !== "events"} data-testid="report-tab-panel-events" style={{ "padding-top": "4px", "padding-bottom": "4px" }}>
                      <div class="flex flex-col gap-1 min-w-0">
                        <EventWatch universe={universe()} daily={daily()} onOpenSymbol={props.onOpenSymbol} />
                        <ReportEventsStrip data={events()} loading={eventsLoading()} error={eventsError()} onOpenSymbol={props.onOpenSymbol} />
                      </div>
                    </div>
                  </div>
                }
              >
                <div class="p-2 text-center w-full" data-testid="report-empty">
                  <Text size="xs" c="dimmed">
                    No unusual moves or breakouts for {date()}
                  </Text>
                </div>
              </Show>
            }
          >
            <div data-testid="report-error">
              <Alert color="error" data-testid="report-error-alert">
                {error()}
              </Alert>
            </div>
          </Show>
        }
      >
        <div class="flex flex-col gap-1 w-full min-w-0" data-testid="report-loading">
          <Skeleton h={16} />
          <Skeleton h={16} />
          <Skeleton h={16} />
          <Skeleton h={16} />
        </div>
      </Show>
    </div>
  );
}

export default DailyReportPage;
