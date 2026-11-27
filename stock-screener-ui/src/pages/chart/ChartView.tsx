import { createEffect, createMemo, createSignal, For, onCleanup, Show, Switch, Match } from "solid-js";
import { useParams, useSearchParams, useNavigate } from "@solidjs/router";
import { Badge, Button, Center, Loader, Text, ToolbarRow, ActionIcon, Tooltip } from "@/ui";
import { IconArrowsMaximize } from "@/ui/icons";
import { fetchTimeframes, fetchSymbolChart } from "@/api/chartPatterns";
import type {
  ChartCandle,
  ChartDataSource,
  ChartIndicators,
  ChartPayload,
  PatternHitDTO,
  PatternOverlay,
  SRZone,
  TFSpec,
} from "@/types/chartPatterns";
import {
  newestHit,
  sortHitsNewest,
} from "@/components/patterns/FullscreenPatternList";
import { PatternChartBody } from "@/components/patterns/PatternChartBody";
import { PatternChartToolbar } from "@/components/patterns/PatternChartToolbar";
import { PatternFullscreenView } from "@/components/patterns/PatternFullscreenView";
import { FALLBACK_TIMEFRAMES } from "@/components/patterns/TimeframeSelect";
import { SymbolTvLink } from "@/components/patterns/SymbolTvLink";
import { MARKET_TIME_ZONE, toEpochMs, type ChartMarket } from "@/utils/chart/time";
import { formatAgeLong } from "@/utils/ui-helpers";

/** Patterns read best on the daily frame; the URL can override it (`?tf=1W`). */
const DEFAULT_TIMEFRAME = "1D";

/** Timeframes the US provider serves; the India registry is never reused for US. */
const US_TIMEFRAMES = ["1D", "1m", "5m", "15m", "1h"] as const;

/** Quick-switch timeframes offered when the current frame has no patterns. */
const EMPTY_STATE_TIMEFRAMES = ["1D", "1W", "1h", "15m"];

/** A stale live chart retries its tail at this cadence while the session is open. */
const LIVE_POLL_MS = 20_000;

/** Canonical frames offered when a timeframe returns no candles at all. */
const NO_CANDLE_TIMEFRAMES = [
  { id: "1D", label: "1D" },
  { id: "1W", label: "1W" },
  { id: "1h", label: "1H" },
] as const;

interface ChartMessageProps {
  testId: string;
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/** Centered message used by the error / no-data / missing-symbol states. */
function ChartMessage(props: ChartMessageProps) {
  return (
    <div
      data-testid={props.testId}
      class="flex w-full flex-1 min-h-0 flex-col items-center justify-center gap-3 p-4"
    >
      <Text size="sm" fw={600}>
        {props.title}
      </Text>
      <Show when={props.detail}>
        <Text size="xs" c="dimmed" style={{ "text-align": "center", "max-width": "520px" }}>
          {props.detail}
        </Text>
      </Show>
      <Show when={props.actionLabel || props.secondaryLabel}>
        <ToolbarRow gap={8} justify="center">
          <Show when={props.actionLabel}>
            <Button size="xs" variant="light" onClick={props.onAction} data-testid="chart-retry-btn">
              {props.actionLabel}
            </Button>
          </Show>
          <Show when={props.secondaryLabel}>
            <Button size="xs" variant="subtle" onClick={props.onSecondary} data-testid="chart-back-btn">
              {props.secondaryLabel}
            </Button>
          </Show>
        </ToolbarRow>
      </Show>
    </div>
  );
}

/**
 * Right-hand panel shown when the symbol has candles but no detected pattern
 * on the active timeframe. Offers a one-click switch to a frame that may.
 */
function NoPatternsPanel(props: {
  symbol: string;
  timeframe: string;
  timeframes: TFSpec[];
  onChange: (timeframe: string) => void;
}) {
  const alternatives = createMemo(() => {
    const available = props.timeframes.filter((tf) => tf.id !== props.timeframe);
    const preferred = EMPTY_STATE_TIMEFRAMES.filter((id) =>
      available.some((tf) => tf.id === id),
    );
    return preferred.length > 0 ? preferred : available.slice(0, 4).map((tf) => tf.id);
  });

  const labelFor = (id: string) => props.timeframes.find((tf) => tf.id === id)?.label ?? id;

  return (
    <div
      data-testid="chart-no-patterns"
      class="flex h-full min-w-0 flex-col gap-3 rounded-fin border border-fin-border bg-fin-surface p-3"
    >
      <Text size="sm" fw={600}>
        No patterns detected
      </Text>
      <Text size="xs" c="dimmed" style={{ "overflow-wrap": "anywhere" }}>
        {props.symbol} has no detected pattern on {props.timeframe}. Try another timeframe.
      </Text>
      <Show when={alternatives().length > 0}>
        <ToolbarRow gap={8} wrap>
          <For each={alternatives()}>
            {(id) => (
              <Button
                size="xs"
                variant="outline"
                onClick={() => props.onChange(id)}
                data-testid={`chart-empty-timeframe-${id}`}
              >
                {labelFor(id)}
              </Button>
            )}
          </For>
        </ToolbarRow>
      </Show>
    </div>
  );
}

/**
 * Zero-candle frames get a complete empty state: a label alone tells the user
 * nothing about why the chart is gone or what to do next. The card stays
 * compact and centered on wide screens and stacks inside the chart area on
 * narrow ones; the chart/indicator strip is not mounted in this branch.
 */
function NoCandlesPanel(props: {
  symbol: string;
  timeframe: string;
  note: string | null;
  onTimeframeChange: (timeframe: string) => void;
  onRetry: () => void;
}) {
  const reason = () =>
    props.note?.trim() ||
    `No ${props.timeframe} bars were returned for ${props.symbol} in this session. Try another timeframe or retry.`;

  return (
    <div
      data-testid="chart-empty"
      class="flex w-full min-h-0 flex-1 items-center justify-center p-4"
    >
      <div
        data-testid="chart-no-candles"
        class="flex w-full max-w-[520px] flex-col items-center gap-3 rounded-fin border border-fin-border bg-fin-surface px-4 py-5 text-center"
      >
        <Text size="sm" fw={700} data-testid="chart-no-candles-title">
          {`No ${props.timeframe} candles for this session`}
        </Text>
        <Text size="xs" c="dimmed" data-testid="chart-no-candles-reason">
          {reason()}
        </Text>
        <ToolbarRow gap={8} justify="center" wrap>
          <For each={NO_CANDLE_TIMEFRAMES}>
            {(tf) => (
              <Button
                size="xs"
                variant="outline"
                disabled={tf.id === props.timeframe}
                onClick={() => props.onTimeframeChange(tf.id)}
                data-testid={`chart-empty-timeframe-${tf.id}`}
              >
                {tf.label}
              </Button>
            )}
          </For>
          <Button
            size="xs"
            variant="light"
            onClick={props.onRetry}
            data-testid="chart-retry-btn"
          >
            Retry
          </Button>
        </ToolbarRow>
      </div>
    </div>
  );
}

type HitSource = "scan" | "live";

/** Optional provenance carried by newer chart payloads, absent on older ones. */
type SourcedHit = PatternHitDTO & { source?: unknown };
type SourcedPayload = ChartPayload & { source?: unknown };

/** US chart metadata added on top of the base contract (India omits all of it). */
type MarketChartPayload = ChartPayload & {
  market?: unknown;
  feed?: unknown;
  delay_label?: unknown;
  session_date?: unknown;
};

function readMetaString(raw: unknown): string | null {
  return typeof raw === "string" && raw ? raw : null;
}

/** Shortcuts stay out of the way while the user is typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable === true
  );
}

function normalizeSource(raw: unknown): HitSource | null {
  if (typeof raw !== "string") return null;
  const value = raw.toLowerCase();
  if (value === "scan" || value === "stored" || value === "db") return "scan";
  if (value === "live" || value === "detected" || value === "detect") return "live";
  return null;
}

/** Read provenance from the selected hit, then the payload; never invent it. */
function readHitSource(hit: PatternHitDTO | null, chart: ChartPayload): HitSource | null {
  return (
    normalizeSource((hit as SourcedHit | null)?.source) ??
    normalizeSource((chart as SourcedPayload).source)
  );
}

interface ChartLoaderState {
  symbol: string;
  hit: PatternHitDTO | null;
  hits: PatternHitDTO[];
  overlays: PatternOverlay[];
  candles: ChartCandle[];
  /** Indicator series for the chart/menu (null when the backend omits them). */
  indicators: ChartIndicators | null;
  /** Historical reaction zones for the chart/menu. */
  srZones: SRZone[];
  loading: boolean;
  error: string | null;
  /** Endpoint/empty-state explanation; informational notes stay off the banner. */
  note: string | null;
  /** Non-fatal warning for the compact banner (tail failure, degraded frame). */
  warning: string | null;
  /** Timeframe that produced `candles`; null while clearing or loading another. */
  candlesTimeframe: string | null;
  /** SCAN/LIVE badge source, only when the payload actually reports one. */
  source: HitSource | null;
  /** Active feed; US payloads additionally carry source/delay/session metadata. */
  market: ChartMarket;
  feed: string | null;
  delayLabel: string | null;
  sessionDate: string | null;
  /** Candle provenance reported by the live-edge chart endpoint. */
  dataSource: ChartDataSource | null;
  stale: boolean;
  appended: number;
  updated: number;
  marketOpen: boolean;
  cacheThrough: string | null;
  latestBar: string | null;
  cacheAgeSec: number | null;
  refreshing: boolean;
}

const EMPTY_LISTS = {
  hit: null,
  hits: [] as PatternHitDTO[],
  overlays: [] as PatternOverlay[],
  candles: [] as ChartCandle[],
  candlesTimeframe: null as string | null,
  indicators: null as ChartIndicators | null,
  srZones: [] as SRZone[],
  source: null as HitSource | null,
  market: "india" as ChartMarket,
  feed: null as string | null,
  delayLabel: null as string | null,
  sessionDate: null as string | null,
  warning: null as string | null,
  dataSource: null as ChartDataSource | null,
  stale: false,
  appended: 0,
  updated: 0,
  marketOpen: false,
  cacheThrough: null as string | null,
  latestBar: null as string | null,
  cacheAgeSec: null as number | null,
  refreshing: false,
};

const CHART_DATA_SOURCES: ReadonlySet<string> = new Set([
  "provider",
  "cache",
  "cache+tail",
  "cache+tail-failed",
  "none",
]);

function readDataSource(raw: unknown): ChartDataSource | null {
  return typeof raw === "string" && CHART_DATA_SOURCES.has(raw)
    ? (raw as ChartDataSource)
    : null;
}

/** Bar counts are additive metadata; a malformed value must never grow a badge. */
function readBarCount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

function readCacheAge(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

/** A note can report a degraded frame even when the backend omits `error`. */
const FAILURE_NOTE_RE = /\b(failed?|failure|error|timeout|unavailable|could not|couldn't)\b/i;

const SESSION_TIMEFRAMES: ReadonlySet<string> = new Set(["1D", "1W", "1M"]);

/**
 * Humanize a bar timestamp in the chart's market zone. A daily/weekly/monthly
 * bar is a session date, so its clock time would be midnight noise.
 */
function formatBarTime(
  raw: string | null,
  timeZone: string,
  timeframe: string,
): string | null {
  if (!raw) return null;
  const ms = toEpochMs(raw, timeZone);
  if (!Number.isFinite(ms)) return null;
  const coarse = SESSION_TIMEFRAMES.has(timeframe);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    ...(coarse ? {} : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }),
  }).format(new Date(ms));
}

/**
 * Inline Solid twin of src/hooks/useSymbolPatternChart (still React). A route
 * has no click — the symbol comes from the URL — so the fetch runs in an
 * effect and the same state shape is exposed (newest hit first).
 * Never throws: a transport error lands in `error` and keeps the previous candles.
 */
function useSymbolPatternChartSolid(args: {
  symbol: () => string;
  timeframe: () => string;
  asOf: () => string | null;
  fromDate: () => string | null;
  market: () => ChartMarket;
}) {
  const [state, setState] = createSignal<ChartLoaderState>({
    symbol: args.symbol(),
    ...EMPTY_LISTS,
    loading: Boolean(args.symbol()),
    error: null,
    note: null,
  });
  let requestToken = 0;
  let mounted = true;
  onCleanup(() => {
    mounted = false;
  });

  const load = (refresh = false) => {
    const symbol = args.symbol();
    const timeframe = args.timeframe();
    if (!symbol) {
      setState({ symbol, ...EMPTY_LISTS, loading: false, error: null, note: null });
      return;
    }
    const token = ++requestToken;
    // A different symbol must not keep showing the previous chart. A same-frame
    // reload keeps its candles (less flicker), but a new timeframe must not lend
    // its bars to the new frame — not even while the request is in flight.
    // Freshness metadata belongs to one response, so it is cleared on reload.
    setState((prev) => {
      if (prev.symbol !== symbol) {
        return { symbol, ...EMPTY_LISTS, loading: true, error: null, note: null };
      }
      const keepCandles = prev.candlesTimeframe === timeframe;
      return {
        ...prev,
        ...(keepCandles
          ? {}
          : {
              candles: [],
              candlesTimeframe: null,
              hit: null,
              hits: [],
              overlays: [],
              indicators: null,
              srZones: [],
              source: null,
            }),
        loading: true,
        error: null,
        note: null,
        warning: null,
        dataSource: null,
        stale: false,
        appended: 0,
        updated: 0,
        cacheThrough: null,
        latestBar: null,
        cacheAgeSec: null,
        refreshing: false,
      };
    });

    const asOf = args.asOf();
    const fromDate = args.fromDate();
    const market = args.market();
    const baseOptions = {
      ...(asOf ? { asOf } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(refresh ? { refresh: true } : {}),
    };

    const applyChart = (
      chart: ChartPayload,
      market: ChartMarket,
      fallbackNote?: string,
    ) => {
      if (!mounted || requestToken !== token) return;
      const hits = sortHitsNewest(chart.hits ?? []);
      const hit = newestHit(hits);
      const meta = chart as MarketChartPayload;
      const isUS = market === "usa";
      const dataSource = readDataSource(chart.data_source);
      const stale = chart.stale === true || dataSource === "cache+tail-failed";
      // A successful tail merge ("+N bars", "no new bar") is informational;
      // only a degraded payload or a failed fallback earns the warning banner.
      const degraded =
        stale || Boolean(chart.error) || FAILURE_NOTE_RE.test(chart.note ?? "");
      const warning =
        chart.warning ||
        (degraded ? chart.note || chart.error || null : null) ||
        fallbackNote ||
        null;
      setState({
        symbol,
        hit,
        hits,
        overlays: chart.overlays ?? [],
        candles: chart.candles ?? [],
        candlesTimeframe: timeframe,
        indicators: chart.indicators ?? null,
        srZones: chart.sr_zones ?? [],
        loading: false,
        error: null,
        note: chart.note || chart.warning || chart.error || fallbackNote || null,
        warning,
        source: readHitSource(hit, chart),
        market,
        feed: isUS ? readMetaString(meta.feed) : null,
        delayLabel: isUS ? readMetaString(meta.delay_label) : null,
        sessionDate: isUS ? readMetaString(meta.session_date) : null,
        dataSource,
        stale,
        appended: readBarCount(chart.appended),
        updated: readBarCount(chart.updated),
        marketOpen: chart.market_open === true,
        cacheThrough: readMetaString(chart.cache_through),
        latestBar: readMetaString(chart.latest_bar),
        cacheAgeSec: readCacheAge(chart.cache_age_sec),
        refreshing: chart.refreshing === true,
      });
    };

    const fail = (err: unknown) => {
      if (!mounted || requestToken !== token) return;
      const message = err instanceof Error ? err.message : "Failed to load chart";
      setState((prev) => {
        if (prev.symbol !== symbol) return prev;
        // A failed same-frame reload must never replace a usable chart with the
        // error panel; a failed frame switch must not leave the old frame's
        // candles under the new timeframe.
        const sameFrame =
          prev.candles.length > 0 && prev.candlesTimeframe === timeframe;
        if (sameFrame) {
          return {
            ...prev,
            loading: false,
            error: null,
            note: message,
            warning: message,
            stale: true,
            // Keep the session gate: a failed tick must not cancel the 20s retry.
            marketOpen: prev.marketOpen,
          };
        }
        return {
          ...prev,
          loading: false,
          error: message,
          note: null,
          warning: null,
          stale: false,
          candles: [],
          candlesTimeframe: null,
          hit: null,
          hits: [],
          overlays: [],
          indicators: null,
          srZones: [],
          source: null,
        };
      });
    };

    // US is a single live-detection read: one call, no stored scan lookup and
    // no second fallback. The backend enables `detect_patterns` for the US
    // feed, so the returned hits/trend lines render like any other chart.
    if (market === "usa") {
      void fetchSymbolChart(symbol, timeframe, { ...baseOptions, market: "usa", detectPatterns: true })
        .then((chart) => applyChart(chart, market))
        .catch(fail);
      return;
    }

    // Replay cuts are point-in-time: stored scan hits come from the latest
    // scan, so as-of goes straight to live detection (the previous behaviour).
    if (asOf) {
      void fetchSymbolChart(symbol, timeframe, { ...baseOptions, detectPatterns: true })
        .then((chart) => applyChart(chart, market))
        .catch(fail);
      return;
    }

    // Stored-first: prefer the table's scanned pattern set. Only fall back to
    // live detection for unscanned symbols, guarded by the same request token.
    void fetchSymbolChart(symbol, timeframe, { ...baseOptions, detectPatterns: false })
      .then((chart) => {
        if (!mounted || requestToken !== token) return;
        if ((chart.hits?.length ?? 0) > 0) {
          applyChart(chart, market);
          return;
        }
        void fetchSymbolChart(symbol, timeframe, { ...baseOptions, detectPatterns: true })
          .then((chart) => applyChart(chart, market))
          .catch((err) => {
            if (!mounted || requestToken !== token) return;
            // The stored payload already had usable candles; keep them with a
            // warning instead of replacing the chart with the error panel.
            if ((chart.candles?.length ?? 0) > 0) {
              applyChart(
                chart,
                market,
                err instanceof Error ? err.message : "Pattern detection failed",
              );
              return;
            }
            fail(err);
          });
      })
      .catch(fail);
  };

  createEffect(() => {
    // Track every input the fetch depends on; re-runs when any of them change.
    args.symbol();
    args.timeframe();
    args.asOf();
    args.fromDate();
    args.market();
    load();
  });

  // A stale live-edge frame is only useful until the next tail catches up.
  // Poll while the backend says the session is open and the frame is stale;
  // the request token makes a late response unable to overwrite a newer
  // symbol/timeframe, and the effect cleanup cancels a pending tick.
  createEffect(() => {
    const current = state();
    if (
      current.loading ||
      current.error ||
      !current.symbol ||
      !current.marketOpen ||
      !current.stale ||
      args.asOf() != null
    ) {
      return;
    }
    const timer = setTimeout(() => load(), LIVE_POLL_MS);
    onCleanup(() => clearTimeout(timer));
  });

  const selectHit = (hit: PatternHitDTO) =>
    setState((prev) => (prev.symbol === hit.symbol ? { ...prev, hit } : prev));

  return { state, selectHit, reload: () => load(true) };
}

/** First value if the param arrived as a (repeated) array, else the string. */
function firstParam(v: string | string[] | undefined): string | null {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw ?? null;
}

type TimeframeCatalogStatus = "loading" | "ready" | "failed";

const ChartView = () => {
  const params = useParams<{ symbol?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [timeframes, setTimeframes] = createSignal<TFSpec[]>(FALLBACK_TIMEFRAMES);
  const [catalogStatus, setCatalogStatus] = createSignal<TimeframeCatalogStatus>("loading");
  const [expanded, setExpanded] = createSignal(false);

  // `F` toggles this page's fullscreen chart. The listener lives here, not in a
  // global hook, so other routes keep their own keyboard semantics.
  createEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key?.toLowerCase() !== "f") return;
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      setExpanded((value) => !value);
    };
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  });

  const symbol = () => params.symbol ?? "";
  const timeframe = createMemo(() => firstParam(searchParams.tf) || DEFAULT_TIMEFRAME);
  const asOf = createMemo(() => firstParam(searchParams.asof));
  const fromDate = createMemo(() => firstParam(searchParams.from));
  // `?market` is an explicit override; anything other than `usa` is India.
  const market = createMemo<ChartMarket>(() =>
    firstParam(searchParams.market) === "usa" ? "usa" : "india",
  );
  const isUS = () => market() === "usa";

  /** Patch one search param while keeping the rest (notably `market=usa`). */
  const patchSearchParams = (patch: Record<string, string | string[] | null | undefined>) => {
    setSearchParams({ ...searchParams, ...patch }, { replace: true });
  };

  // Replay is NSE-only: a `?asof=`/`?from=` on a US URL must not leak into the
  // provider request (the US chart API has no as-of support).
  const chart = useSymbolPatternChartSolid({
    symbol,
    timeframe,
    asOf: () => (isUS() ? null : asOf()),
    fromDate: () => (isUS() ? null : fromDate()),
    market,
  });

  createEffect(() => {
    let active = true;
    fetchTimeframes()
      .then((list) => {
        if (!active) return;
        if (list.length > 0) setTimeframes(list);
        setCatalogStatus("ready");
      })
      .catch(() => {
        // Non-fatal: keep the fallback ladder and trust the requested frame;
        // the backend may still serve an admin-registered id.
        if (active) setCatalogStatus("failed");
      });
    onCleanup(() => {
      active = false;
    });
  });

  // The US provider serves a fixed ladder; the India registry is not reused.
  // Keep the active frame first: the shared Select does not re-apply `value`
  // when options arrive asynchronously, so it falls back to the first option.
  const visibleTimeframes = createMemo(() => {
    if (!isUS()) return timeframes();
    const ladder = timeframes().filter((tf) =>
      (US_TIMEFRAMES as readonly string[]).includes(tf.id),
    );
    const active = timeframe();
    const index = ladder.findIndex((tf) => tf.id === active);
    return index > 0
      ? [ladder[index], ...ladder.slice(0, index), ...ladder.slice(index + 1)]
      : ladder;
  });
  const usFeedLabel = createMemo(() =>
    [chart.state().feed, chart.state().delayLabel].filter(Boolean).join(" · "),
  );

  const setTimeframe = (next: string) => {
    if (next === timeframe()) return;
    patchSearchParams({ tf: next });
  };

  const setAsOf = (nextAsOf: string | null, nextFrom: string | null) => {
    patchSearchParams({
      asof: nextAsOf ? nextAsOf : null,
      from: nextFrom ? nextFrom : null,
    });
  };

  // An unknown/garbled `?tf=` falls back to 1D once the catalog proves it
  // absent. US validates against its fixed ladder immediately: the async
  // `/timeframes` response starts as the 1D-only fallback, so consulting it
  // here would clobber a valid deep link (e.g. 5m) before the real options
  // arrive and fire a spurious second request. India waits for the catalog:
  // an admin-registered frame (e.g. 3m) is not in the local fallback but is
  // still valid, and a failed catalog must not rewrite the user's frame.
  createEffect(() => {
    const tf = timeframe();
    if (tf === DEFAULT_TIMEFRAME) return;

    if (isUS()) {
      if ((US_TIMEFRAMES as readonly string[]).includes(tf)) return;
      patchSearchParams({ tf: DEFAULT_TIMEFRAME });
      return;
    }

    if (catalogStatus() !== "ready") return;

    const list = visibleTimeframes();
    if (!list.length) return;
    if (list.some((spec) => spec.id === tf)) return;
    patchSearchParams({ tf: DEFAULT_TIMEFRAME });
  });

  const showLoader = () =>
    chart.state().loading && chart.state().candles.length === 0 && !chart.state().error;
  const showEmpty = () =>
    !chart.state().loading && !chart.state().error && chart.state().candles.length === 0;

  /** Everything the freshness badges can explain without opening a panel. */
  const freshnessDetail = () => {
    const current = chart.state();
    const timeZone = MARKET_TIME_ZONE[current.market];
    // Describe the bars actually on screen, not the frame the URL names now.
    const tf = current.candlesTimeframe ?? timeframe();
    const zoneLabel = current.market === "india" ? "IST" : "ET";
    const cacheThrough = formatBarTime(current.cacheThrough, timeZone, tf);
    const latestBar = formatBarTime(current.latestBar, timeZone, tf);
    const barAge =
      current.cacheAgeSec != null ? formatAgeLong(current.cacheAgeSec * 1000) : null;
    return [
      cacheThrough ? `cache through ${cacheThrough} ${zoneLabel}` : null,
      latestBar ? `latest bar ${latestBar} ${zoneLabel}` : null,
      barAge ? `bar age ${barAge}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const showUpdatingBadge = () =>
    chart.state().refreshing || (chart.state().stale && chart.state().marketOpen);
  /** Successful tail notes stay out of the banner; only degraded frames warn. */
  const chartWarningNote = () => {
    const current = chart.state();
    return current.candles.length > 0 ? current.warning : null;
  };

  return (
    <div
      class="flex h-full min-h-0 w-full flex-col overflow-hidden"
      data-testid="chart-view-root"
    >
      <Show
        when={symbol()}
        fallback={
          <ChartMessage
            testId="chart-view-error"
            title="No symbol specified"
            detail="Open a symbol from the screener, or use /chart/SYMBOL."
            actionLabel="Back to Screener"
            onAction={() => navigate("/screener")}
          />
        }
      >
        <div
          data-testid="chart-view"
          id="chart-view"
          data-market={chart.state().market}
          data-feed={chart.state().feed ?? ""}
          data-delay-label={chart.state().delayLabel ?? ""}
          data-session-date={chart.state().sessionDate ?? ""}
          data-data-source={chart.state().dataSource ?? ""}
          data-candle-timeframe={chart.state().candlesTimeframe ?? ""}
          data-cache-through={chart.state().cacheThrough ?? ""}
          data-latest-bar={chart.state().latestBar ?? ""}
          data-market-open={chart.state().marketOpen ? "1" : "0"}
          data-appended={chart.state().appended}
          data-updated={chart.state().updated}
          data-refreshing={chart.state().refreshing ? "1" : "0"}
          class="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-fin-bg"
        >
        <div
          data-testid="chart-header"
          class="shrink-0 border-b border-fin-border px-4 py-2"
        >
          <ToolbarRow gap={8} className="min-w-0">
            <PatternChartToolbar
              leading={
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={() => navigate(-1)}
                  data-testid="chart-back-btn"
                >
                  ← Back
                </Button>
              }
              title={<SymbolTvLink symbol={symbol()} testId="chart-title">{symbol().toUpperCase()}</SymbolTvLink>}
              titleSize="md"
              timeframe={timeframe()}
              timeframes={visibleTimeframes()}
              onTimeframeChange={setTimeframe}
              loading={chart.state().loading}
              asOf={isUS() ? null : asOf()}
              fromDate={isUS() ? null : fromDate()}
              onAsOfChange={isUS() ? undefined : setAsOf}
            />
            <Show when={!isUS() && chart.state().source}>
              {(source) => (
                <Badge size="xs" color="dimmed" data-testid="chart-pattern-source">
                  {source() === "scan" ? "SCAN" : "LIVE"}
                </Badge>
              )}
            </Show>
            <Show when={chart.state().stale}>
              <Badge
                size="xs"
                color="warning"
                data-testid="chart-freshness-stale"
                title={freshnessDetail() || "Served from the candle cache"}
              >
                STALE
              </Badge>
            </Show>
            <Show when={showUpdatingBadge()}>
              <Badge
                size="xs"
                color="info"
                data-testid="chart-freshness-updating"
                title="Fetching newer bars in the background"
              >
                UPDATING
              </Badge>
            </Show>
            <Show when={chart.state().appended > 0}>
              <Badge
                size="xs"
                color="success"
                data-testid="chart-freshness-appended"
                title={freshnessDetail()}
              >
                {`+${chart.state().appended} BARS`}
              </Badge>
            </Show>
            <Show when={chart.state().appended === 0 && chart.state().updated > 0}>
              <Badge
                size="xs"
                color="success"
                data-testid="chart-freshness-updated"
                title={freshnessDetail()}
              >
                UPDATED
              </Badge>
            </Show>
            <Show when={isUS()}>
              <Show when={usFeedLabel()}>
                <Badge size="xs" color="dimmed" data-testid="chart-us-feed">
                  {usFeedLabel()}
                </Badge>
              </Show>
              <Show when={chart.state().sessionDate}>
                {(session) => (
                  <Badge size="xs" color="dimmed" data-testid="chart-us-session">
                    {session()}
                  </Badge>
                )}
              </Show>
            </Show>
            <Tooltip label="Expand chart">
              <ActionIcon
                size="xs"
                variant="subtle"
                aria-label="Expand chart"
                data-testid="chart-expand"
                onClick={() => setExpanded(true)}
              >
                <IconArrowsMaximize size={14} />
              </ActionIcon>
            </Tooltip>
          </ToolbarRow>
        </div>

        <Show when={chartWarningNote()}>
          {(note) => (
            <div
              data-testid="chart-warning"
              role="status"
              class="flex min-w-0 shrink-0 items-center gap-2 border-b border-fin-border px-4 py-2"
            >
              <Badge size="xs" color="warning">
                NOTE
              </Badge>
              <Text
                size="xs"
                c="dimmed"
                truncate
                title={note()}
                class="text-ui-micro"
                data-testid="chart-warning-text"
              >
                {note()}
              </Text>
            </div>
          )}
        </Show>

        <Switch>
          <Match when={chart.state().error}>
            {(err) => (
              <ChartMessage
                testId="chart-error"
                title={`Couldn't load ${symbol().toUpperCase()}`}
                detail={err()}
                actionLabel="Retry"
                onAction={chart.reload}
              />
            )}
          </Match>
          <Match when={showLoader()}>
            <Center
              data-testid="chart-loading"
              className="flex flex-1 min-h-0 items-center justify-center"
            >
              <Loader size="sm" />
            </Center>
          </Match>
          <Match when={showEmpty()}>
            <NoCandlesPanel
              symbol={symbol().toUpperCase()}
              timeframe={timeframe()}
              note={chart.state().note}
              onTimeframeChange={setTimeframe}
              onRetry={chart.reload}
            />
          </Match>
          <Match when={true}>
            <PatternChartBody
              fill
              market={market()}
              hit={chart.state().hit}
              hits={chart.state().hits}
              onSelectHit={chart.selectHit}
              candles={chart.state().candles}
              overlays={chart.state().overlays}
              timeframe={timeframe()}
              indicators={chart.state().indicators}
              srZones={chart.state().srZones}
              asOf={isUS() ? null : asOf()}
              emptyState={
                isUS() ? undefined : (
                  <NoPatternsPanel
                    symbol={symbol().toUpperCase()}
                    timeframe={timeframe()}
                    timeframes={visibleTimeframes()}
                    onChange={setTimeframe}
                  />
                )
              }
            />
          </Match>
        </Switch>

        <Show when={expanded()}>
          <PatternFullscreenView
            opened
            onClose={() => setExpanded(false)}
            symbol={symbol().toUpperCase()}
            hit={chart.state().hit}
            candles={chart.state().candles}
            hits={chart.state().hits}
            onSelectHit={chart.selectHit}
            overlays={chart.state().overlays}
            indicators={chart.state().indicators}
            srZones={chart.state().srZones}
            timeframe={timeframe()}
            timeframes={visibleTimeframes()}
            onTimeframeChange={setTimeframe}
            loading={chart.state().loading}
            asOf={isUS() ? null : asOf()}
            fromDate={isUS() ? null : fromDate()}
            onAsOfChange={isUS() ? undefined : setAsOf}
            chartError={chart.state().error}
            chartNote={chart.state().note}
            market={market()}
          />
        </Show>
      </div>
      </Show>
    </div>
  );
};

export default ChartView;
