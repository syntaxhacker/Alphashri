import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { JSX } from "solid-js";
import { Alert, Box, SegmentedControl, Text, ToolbarRow, typeSize } from "@/ui";
import { formatPercentage, getPnLTextColor } from "@/utils/ui-helpers";
import type {
  ChartCandle,
  ChartIndicators,
  PatternHitDTO,
  PatternOverlay,
  SRZone,
} from "@/types/chartPatterns";
import { buildPatternTVData, type TVMarker } from "./patternTVData";
import { selectLastN } from "./selectLastN";
import { PatternChartLegend, legendEntryBudget } from "./PatternChartLegend";
import { ChartIndicatorsMenu } from "./ChartIndicatorsMenu";
import {
  activeChartIndicatorSpecs,
  CHART_INDICATOR_SPECS,
  chartIndicatorAvailability,
  type ChartIndicatorId,
} from "@/config/chartIndicators";
import { chartIndicatorPrefs, setChartIndicator } from "@/state/chartIndicators";
import { CROSSES_LEGEND_NAME } from "./patternIndicatorData";
import { PatternTradingViewChart } from "./PatternTradingViewChart";
import { SymbolTvLink } from "./SymbolTvLink";
import { FullscreenPatternList, fullscreenHitKey } from "./FullscreenPatternList";
import { KeyPointLegend } from "./KeyPointLegend";
import { PivotList } from "./PatternPivotList";
import { SRZoneSummary } from "./SRZoneSummary";
import { QualityBadge } from "./QualityBadge";
import { StatusBadge } from "./StatusBadge";
import { displayStatusForHit } from "./patternDisplayStatus";
import { formatChartPrice } from "./chartFormat";
import { KEY_POINTS_LEGEND_NAME, PIVOT_LEGEND_NAME } from "@/config/patterns";
import {
  MARKET_TIME_ZONE,
  sessionDateKey,
  type ChartMarket,
} from "@/utils/chart/time";
import { POSITIVE, PRIMARY, TEXT_MUTED, WARNING } from "@/ui/palette";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Calendar-only `YYYY-MM-DD` → `13 Nov` — no timezone math on a session key. */
function formatDayMonthKey(key: string): string {
  const [, month, day] = key.split("-");
  const name = MONTHS[Number(month) - 1] ?? month;
  return `${day} ${name}`;
}

function todayKey(timeZone: string): string {
  return sessionDateKey(new Date().toISOString(), timeZone) ?? "";
}

function barDateLabel(value: string, timeZone: string): string {
  const key = sessionDateKey(value, timeZone);
  if (!key) return value.toUpperCase();
  const base = formatDayMonthKey(key);
  const year = key.slice(0, 4);
  return (year === todayKey(timeZone).slice(0, 4) ? base : `${base} ${year}`).toUpperCase();
}

export interface CloseSeries {
  close: number | null;
  changePct: number | null;
  barDate: string | null;
  source: "hit" | "chart";
  /** The displayed bar is today's partial bar built from the live tape. */
  isPartial: boolean;
}

const COARSE_TIMEFRAMES = new Set(["1D", "1W", "1M"]);

/**
 * Bar change for the header. Daily/weekly/monthly keep the previous period
 * (the prior candle); intraday compares the last bar with the final bar of the
 * prior session, so 1m/5m/1h show the day's move instead of the last bar's.
 * With no earlier session (or an unknown timestamp) it falls back to the
 * previous bar's close, preserving the old behavior.
 */
function closeChangePct(
  candles: ChartCandle[],
  timeframe: string | null | undefined,
  timeZone: string,
): number | null {
  const last = candles.length ? candles[candles.length - 1] : null;
  if (!last) return null;
  const tf = typeof timeframe === "string" ? timeframe.trim() : "";
  const intraday = tf !== "" && !COARSE_TIMEFRAMES.has(tf);
  let prev = candles.length > 1 ? candles[candles.length - 2] : null;
  if (intraday) {
    const lastKey = sessionDateKey(last.t, timeZone);
    if (lastKey) {
      const prior = candles
        .slice(0, -1)
        .reverse()
        .find((candle) => {
          const key = sessionDateKey(candle.t, timeZone);
          return key != null && key < lastKey;
        });
      if (prior) prev = prior;
    }
  }
  return last && prev && prev.c ? ((last.c - prev.c) / prev.c) * 100 : null;
}

/**
 * Choose one source for the displayed close *and* its change: a hit enrichment
 * only wins when it carries a complete pair whose `close_bar_date` proves the
 * bar is not older than the chart's last candle. `end_date` is the pattern
 * formation date, not the close's bar date, so it is never used as a proxy.
 * Without that date (or without a chart bar to compare) the drawn series wins;
 * a partial enrichment never mixes with a chart bar.
 */
export function resolveCloseSeries(
  params: {
    hit: Pick<PatternHitDTO, "last_close" | "day_change_pct" | "close_bar_date">;
    candles: ChartCandle[];
    timeframe?: string | null;
  },
  timeZone: string = MARKET_TIME_ZONE.india,
): CloseSeries {
  const { hit, candles, timeframe } = params;
  const last = candles.length ? candles[candles.length - 1] : null;
  const isPartial = last?.is_partial === true;
  const chart: CloseSeries = {
    close: last?.c ?? null,
    changePct: closeChangePct(candles, timeframe, timeZone),
    // Store a canonical session key, never the raw UTC instant: a daily bar is
    // stamped 18:30Z of the previous calendar day and formatting its date part
    // directly labels the session one day early.
    barDate: sessionDateKey(last?.t ?? null, timeZone),
    source: "chart",
    isPartial,
  };

  const hasPair = hit.last_close != null && hit.day_change_pct != null;
  const hitKey = sessionDateKey(hit.close_bar_date, timeZone);
  const chartKey = sessionDateKey(last?.t ?? null, timeZone);
  if (!hasPair || !hitKey) return chart;
  if (chartKey && hitKey < chartKey) return chart;

  return {
    close: hit.last_close ?? null,
    changePct: hit.day_change_pct ?? null,
    barDate: hit.close_bar_date ?? null,
    source: "hit",
    isPartial: chartKey != null && hitKey === chartKey ? isPartial : false,
  };
}

export interface PatternChartBodyProps {
  hit: PatternHitDTO | null;
  candles: ChartCandle[];
  hits?: PatternHitDTO[];
  onSelectHit?: (hit: PatternHitDTO) => void;
  /**
   * Kept for API compatibility; the parent passes an empty list so only the
   * active pattern is drawn (no dashed siblings).
   */
  overlays?: PatternOverlay[];
  /** Active timeframe; gates intraday-only studies (VWAP). */
  timeframe?: string | null;
  /** Indicator series from the symbol-chart payload (null/absent = no rows). */
  indicators?: ChartIndicators | null;
  /** Historical reaction zones from the symbol-chart payload. */
  srZones?: SRZone[];
  asOf?: string | null;
  loading?: boolean;
  /** Chart endpoint failure code, shown under the empty state. */
  chartError?: string | null;
  chartNote?: string | null;
  /** Live quote from the market snapshot. The LTP line is omitted when null. */
  livePrice?: number | null;
  liveChange?: number | null;
  emptyState?: JSX.Element;
  /**
   * Fill the flex parent (page layout) instead of sizing to the modal viewport.
   * The fullscreen modal keeps its `calc(100vh - 72px)` body height.
   */
  fill?: boolean;
  docked?: boolean;
  /**
   * Exchange whose session defines axis/session dates. `usa` resolves to
   * America/New_York; `india` (the default) stays Asia/Kolkata. An explicit
   * `timeZone` wins over `market`.
   */
  market?: ChartMarket;
  /** IANA zone override for the session key and naive-timestamp parsing. */
  timeZone?: string;
  /** Source badge text from the chart payload (`feed`), e.g. "Yahoo". */
  feedLabel?: string;
  /** Delay badge text from the chart payload (`delay_label`), e.g. "~1 min". */
  delayLabel?: string;
}

function SectionLabel(props: { children?: JSX.Element; action?: JSX.Element }) {
  return (
    <Box className="flex items-center justify-between gap-2">
      <Text
        size="xs"
        fw={700}
        c="dimmed"
        style={{
          "font-size": `${typeSize("micro")}px`,
          "text-transform": "uppercase",
          "letter-spacing": "0.4px",
        }}
      >
        {props.children}
      </Text>
      {props.action}
    </Box>
  );
}

/**
 * Legend entries contributed by marker groups. Pivots/key points are separate
 * series; crosses collapse onto one entry keyed by their marker legendName and
 * must never masquerade as pivots (`group !== "keypoints"` used to do that).
 */
export function markerLegendEntries(
  markers: readonly TVMarker[],
  options: { crossesEnabled?: boolean } = {},
): Array<{ name: string; color: string }> {
  const hasPivots = markers.some((marker) => marker.group === "pivots");
  const hasKeys = markers.some((marker) => marker.group === "keypoints");
  // Crosses are an indicator prefs (default off), unlike pattern annotations:
  // keep their legend entry out until the session pref is explicitly enabled.
  const hasCrosses =
    options.crossesEnabled === true && markers.some((marker) => marker.group === "crosses");
  const crossLegendName =
    markers.find((marker) => marker.group === "crosses" && marker.legendName)?.legendName ??
    CROSSES_LEGEND_NAME;
  return [
    ...(hasPivots ? [{ name: PIVOT_LEGEND_NAME, color: TEXT_MUTED }] : []),
    ...(hasKeys ? [{ name: KEY_POINTS_LEGEND_NAME, color: WARNING }] : []),
    ...(hasCrosses ? [{ name: crossLegendName, color: POSITIVE }] : []),
  ];
}

/** Compact chip rail budget: three prioritized labels, then `+N`. */
export const COMPACT_CHIP_LIMIT = 3;

/**
 * Compact chip budget: at most three labels, then `+N`. Wide shows the whole
 * set. Kept pure so the 390px contract is testable without layout.
 */
export function activeIndicatorChipWindow<T>(
  items: readonly T[],
  compact: boolean,
): { visible: T[]; overflow: number } {
  if (!compact || items.length <= COMPACT_CHIP_LIMIT) {
    return { visible: [...items], overflow: 0 };
  }
  return {
    visible: items.slice(0, COMPACT_CHIP_LIMIT),
    overflow: items.length - COMPACT_CHIP_LIMIT,
  };
}

/** Compact order: SMA20, BB, S/R first; remaining rows fill only after these. */
export function prioritizeCompactChips<T extends { id: ChartIndicatorId }>(
  items: readonly T[],
): T[] {
  const rank = new Map(COMPACT_CHIP_ORDER.map((id, index) => [id, index]));
  return [...items].sort(
    (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * Map built indicator line ids/legend names back to menu spec ids. The count and
 * chips read this instead of trusting a separately-passed payload, so a line
 * that is visibly drawn can never be missing from the trigger count.
 */
const INDICATOR_LINE_IDS: Readonly<Record<string, ChartIndicatorId>> = {
  sma20: "sma20",
  sma50: "sma50",
  sma200: "sma200",
  bbUpper: "bb",
  bbMiddle: "bb",
  bbLower: "bb",
  vwap: "vwap",
};

const INDICATOR_LEGEND_IDS: Readonly<Record<string, ChartIndicatorId>> = {
  SMA20: "sma20",
  SMA50: "sma50",
  SMA200: "sma200",
  BB: "bb",
  VWAP: "vwap",
};

/** 390px keeps the three most identifiable rows; the rest fold into `+N`. */
const COMPACT_CHIP_ORDER: readonly ChartIndicatorId[] = [
  "sma20",
  "bb",
  "srZones",
  "sma50",
  "sma200",
  "vwap",
];

function FullscreenPanel(props: {
  hit: PatternHitDTO;
  hits?: PatternHitDTO[];
  onSelectHit?: (hit: PatternHitDTO) => void;
  candles?: ChartCandle[];
  docked?: boolean;
  livePrice?: number | null;
  liveChange?: number | null;
  market?: ChartMarket;
  timeZone: string;
  timeframe?: string | null;
}) {
  // Enrichment is only as fresh as the frame it was captured on; the drawn
  // candles are the authority whenever the hit cannot be dated or is older.
  const series = createMemo(() =>
    resolveCloseSeries(
      { hit: props.hit, candles: props.candles ?? [], timeframe: props.timeframe },
      props.timeZone,
    ),
  );
  const closeLabel = () => {
    const barDate = series().barDate;
    if (!barDate) return "CLOSE";
    const key = sessionDateKey(barDate, props.timeZone);
    const isPrev = key != null && key !== todayKey(props.timeZone);
    return `${isPrev ? "PREV CLOSE" : "CLOSE"} · ${barDateLabel(barDate, props.timeZone)}`;
  };
  const activeKey = () => fullscreenHitKey(props.hit);

  return (
    <Box
      data-testid="patterns-fullscreen-panel"
      className="flex h-full min-w-0 flex-col overflow-y-auto"
    >
      <Box className="flex flex-col gap-3 px-3 py-3">
        <Box className="flex items-start justify-between gap-2">
          <Box className="flex min-w-0 flex-col gap-1">
            <Box className="flex items-baseline gap-2">
              <SymbolTvLink
                symbol={props.hit.symbol}
                testId="patterns-chart-symbol-link"
                className="min-w-0"
              >
                <Text fw={700} className="truncate text-ui-body leading-none">
                  {props.hit.symbol}
                </Text>
              </SymbolTvLink>
              <Text size="xs" c="dimmed" className="whitespace-nowrap text-ui-micro">
                {props.hit.timeframe} · {props.hit.bars_ago} bar
                {props.hit.bars_ago === 1 ? "" : "s"} ago
              </Text>
            </Box>
            <Text size="xs" c="dimmed" className="truncate text-ui-micro">
              {props.hit.pattern_name}
            </Text>
          </Box>
          <Box className="flex flex-shrink-0 items-center gap-1">
            <StatusBadge status={props.hit.status} display={displayStatusForHit(props.hit)} />
            <QualityBadge quality={props.hit.quality} />
          </Box>
        </Box>

        <Box className="flex items-end justify-between gap-3">
          <Box className="flex min-w-0 flex-col gap-1">
            <Text
              size="xs"
              c="dimmed"
              className="text-ui-micro uppercase tracking-[0.4px]"
              data-testid="patterns-close-label"
            >
              {closeLabel()}
              <Show when={series().isPartial}>
                <span
                  data-testid="patterns-close-partial"
                  className="ml-1 normal-case tracking-normal"
                  style={{ color: WARNING }}
                >
                  (live)
                </span>
              </Show>
            </Text>
            <Box className="flex min-w-0 items-baseline gap-2">
              <Text fw={600} className="font-mono tabular-nums text-ui-heading leading-none">
                {formatChartPrice(series().close, props.market)}
              </Text>
              <Text
                size="xs"
                fw={600}
                className="font-mono tabular-nums text-ui-micro"
                c={getPnLTextColor(series().changePct ?? 0)}
              >
                {series().changePct != null ? formatPercentage(series().changePct!, 2) : "—"}
              </Text>
            </Box>
            <Show when={props.livePrice != null}>
              <Box className="flex min-w-0 items-baseline gap-2" data-testid="patterns-ltp-line">
                <Text size="xs" c="dimmed" className="text-ui-micro uppercase tracking-[0.4px]">
                  LTP
                </Text>
                <Text fw={600} className="font-mono tabular-nums text-ui-label leading-none">
                  {formatChartPrice(props.livePrice!, props.market)}
                </Text>
                <Text
                  size="xs"
                  fw={600}
                  className="font-mono tabular-nums text-ui-micro"
                  c={props.liveChange != null ? getPnLTextColor(props.liveChange) : undefined}
                  data-testid="patterns-ltp-change"
                >
                  {props.liveChange != null ? formatPercentage(props.liveChange, 2) : "—"}
                </Text>
              </Box>
            </Show>
          </Box>
          <Show when={props.hit.confidence != null}>
            <Box className="flex w-28 flex-shrink-0 flex-col items-end gap-1">
              <Text size="xs" c="dimmed" className="text-ui-micro uppercase tracking-[0.4px]">
                Confidence{" "}
                <span className="font-mono tabular-nums text-fin-text">
                  {props.hit.confidence}%
                </span>
              </Text>
              <Box
                className="h-[3px] w-full rounded-full overflow-hidden"
                style={{
                  width: `${Math.max(0, Math.min(100, props.hit.confidence ?? 0))}%`,
                  "background-color": PRIMARY,
                }}
              />
            </Box>
          </Show>
        </Box>
      </Box>

      <Show when={!props.docked && props.hits && props.onSelectHit}>
        <Box className="border-t border-fin-border px-3 py-2">
          <FullscreenPatternList
            hits={props.hits!}
            activeKey={activeKey()}
            onSelect={props.onSelectHit!}
          />
        </Box>
      </Show>

      <Show when={props.hit.notes}>
        <Box className="flex flex-col gap-1 border-t border-fin-border px-3 py-2">
          <SectionLabel>Notes</SectionLabel>
          <Text
            size="xs"
            c="dimmed"
            className="text-ui-micro"
            style={{ "overflow-wrap": "anywhere" }}
          >
            {props.hit.notes}
          </Text>
        </Box>
      </Show>

      <KeyPointLegend hit={props.hit} />
      <PivotList pivots={props.hit.pivots} market={props.market} />
    </Box>
  );
}

function FullscreenTV(props: {
  hit: PatternHitDTO | null;
  candles: ChartCandle[];
  overlays?: PatternOverlay[];
  historyHits?: PatternHitDTO[];
  chartError?: string | null;
  chartNote?: string | null;
  loading?: boolean;
  market?: ChartMarket;
  timeZone: string;
  timeframe?: string | null;
  indicators?: ChartIndicators | null;
  srZones?: SRZone[];
}) {
  // Built exactly once per (candles, hit, overlays, indicators) change; the
  // legend and the chart receive the same object so timezone/session parsing
  // can never drift between them.
  const data = createMemo(() =>
    buildPatternTVData({
      candles: props.candles,
      hit: props.hit,
      overlays: props.overlays,
      historyHits: props.historyHits,
      indicators: props.indicators,
      srZones: props.srZones,
      timeframe: props.timeframe ?? undefined,
      timeZone: props.timeZone,
    }),
  );
  const levelEntries = createMemo(() =>
    data().levels.map((level) => ({ name: level.title, color: level.color })),
  );
  const markerEntries = createMemo(() =>
    markerLegendEntries(data().markers, {
      crossesEnabled: chartIndicatorPrefs().crosses,
    }),
  );

  // Per-series show/hide via the legend. Reset whenever the inspected pattern
  // (or symbol) changes so toggles don't leak between charts.
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(
    new Set<string>([PIVOT_LEGEND_NAME]),
  );
  createEffect(() => {
    // Track the inspected pattern identity so toggles reset per chart.
    void props.hit?.symbol;
    void props.hit?.pattern_id;
    void props.hit?.start_date;
    setHidden(new Set<string>([PIVOT_LEGEND_NAME]));
  });
  const toggle = (name: string) => {
    // Crosses are an indicator signal: route the marker-group legend toggle
    // through the session pref so the menu count and chart visibility agree.
    if (name === CROSSES_LEGEND_NAME) {
      setChartIndicator("crosses", !chartIndicatorPrefs().crosses);
      return;
    }
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const legendHidden = createMemo(() => {
    const next = new Set(hidden());
    if (!chartIndicatorPrefs().crosses) next.add(CROSSES_LEGEND_NAME);
    return next;
  });

  // Container-driven density: the chart column itself decides whether the
  // legend shows 3/5/7 entries and whether the indicator trigger is compact.
  // Zero means "not measured yet" (tests / first paint); render uncapped.
  let chartBoxEl: HTMLDivElement | undefined;
  const [chartWidth, setChartWidth] = createSignal(0);
  onMount(() => {
    const measure = () => {
      if (chartBoxEl) setChartWidth(chartBoxEl.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined" || !chartBoxEl) return;
    const observer = new ResizeObserver(measure);
    observer.observe(chartBoxEl);
    onCleanup(() => observer.disconnect());
  });
  const measured = () => chartWidth() > 0;
  const legendBudget = createMemo(() =>
    measured() ? legendEntryBudget(chartWidth()) : undefined,
  );
  const compactMenu = () => measured() && chartWidth() < 640;

  const indicatorCtx = createMemo(() => ({
    timeframe: props.timeframe ?? null,
    candleCount: props.candles.length,
    indicators: props.indicators ?? null,
    srZoneCount: props.srZones?.length ?? 0,
  }));
  // The chart is the authority: map its built indicator lines/markers/zones
  // back to spec ids. Menu rows, chips and counts then match what is drawn even
  // if a caller forwards a partial `indicators` bundle.
  const drawableIndicatorIds = createMemo(() => {
    const present = new Set<ChartIndicatorId>();
    const built = data();
    for (const line of built.indicatorLines) {
      const id = line.id
        ? INDICATOR_LINE_IDS[line.id]
        : line.legendName
          ? INDICATOR_LEGEND_IDS[line.legendName]
          : undefined;
      if (id) present.add(id);
    }
    if (built.markers.some((marker) => marker.group === "crosses")) present.add("crosses");
    if (built.zones.length > 0) present.add("srZones");
    return present;
  });
  // Before the chart has candles there is no drawable data yet: fall back to
  // the payload so the menu/rows stay informative during first paint.
  const drawablePresence = createMemo(() =>
    data().candles.length > 0 ? drawableIndicatorIds() : null,
  );
  const drawableCtx = createMemo(() => ({
    ...indicatorCtx(),
    presentIndicatorIds: drawablePresence(),
  }));
  // Pattern visibility (legend toggles) resets per inspected hit; indicator
  // preferences are session-scoped and persist across pattern navigation.
  // Inactive/unavailable indicators join the same hidden-name set the chart
  // already consumes, so disabling a row removes its lines/markers/zone tags.
  const canvasHidden = createMemo(() => {
    const next = new Set(hidden());
    const prefs = chartIndicatorPrefs();
    const ctx = drawableCtx();
    for (const spec of CHART_INDICATOR_SPECS) {
      if (prefs[spec.id] && chartIndicatorAvailability(spec.id, ctx).enabled) continue;
      for (const name of spec.visibilityNames) next.add(name);
    }
    return next;
  });
  // Same filter the chart applies to `data().zones`, so the text summary never
  // announces a band that is hidden by a legend toggle or indicator pref.
  const visibleZones = createMemo(() =>
    data().zones.filter((zone) => !canvasHidden().has(zone.legendName)),
  );

  // DOM chip rail: the lightweight-charts end tags are drawn on canvas and can
  // collide/clip, so active lines also get a stable text label inside the strip.
  const activeSpecs = createMemo(() =>
    activeChartIndicatorSpecs(chartIndicatorPrefs(), drawableCtx()),
  );
  // Crosses already have an interactive legend entry when enabled; the chip
  // rail stays non-interactive and labels only the remaining drawable rows.
  const chipSpecs = createMemo(() => activeSpecs().filter((spec) => spec.id !== "crosses"));
  const chipWindow = createMemo(() => {
    const compact = measured() && chartWidth() < 640;
    return activeIndicatorChipWindow(
      compact ? prioritizeCompactChips(chipSpecs()) : chipSpecs(),
      compact,
    );
  });

  return (
    <div
      ref={(el) => {
        chartBoxEl = el;
      }}
      class="relative flex h-[60vh] min-h-[360px] w-full flex-1 flex-col overflow-hidden rounded-fin border border-fin-border bg-fin-bg lg:h-full"
    >
      <Box
        data-testid="patterns-chart-indicator-strip"
        className="flex h-7 shrink-0 items-center gap-2 border-b border-fin-border px-2"
        style={{ height: "28px" }}
      >
        <Box className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <Box
            data-testid="patterns-chart-legend-block"
            className={`max-w-[45%] shrink-0 ${
              markerEntries().length > 0 ? "min-w-[72px]" : "min-w-0"
            }`}
          >
            <PatternChartLegend
              lines={data().lines}
              levels={levelEntries()}
              markers={markerEntries()}
              hidden={legendHidden()}
              onToggle={toggle}
              maxEntries={legendBudget()}
            />
          </Box>
          <Show when={chipSpecs().length > 0}>
            <Box
              data-testid="chart-active-indicators"
              data-active-count={activeSpecs().length}
              aria-hidden="true"
              className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
            >
              <For each={chipWindow().visible}>
                {(spec) => (
                  <span
                    data-indicator={spec.id}
                    title={spec.label}
                    class="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-fin border border-fin-border bg-fin-surface px-1 font-mono text-ui-micro leading-none text-fin-text-muted"
                  >
                    <span
                      class="size-1.5 rounded-full"
                      style={{ "background-color": spec.color }}
                    />
                    {spec.chipLabel}
                  </span>
                )}
              </For>
              <Show when={chipWindow().overflow > 0}>
                <span
                  data-indicator="overflow"
                  class="inline-flex h-[18px] shrink-0 items-center rounded-fin px-1 font-mono text-ui-micro leading-none text-fin-text-muted"
                >
                  +{chipWindow().overflow}
                </span>
              </Show>
            </Box>
          </Show>
        </Box>
        <ChartIndicatorsMenu
          timeframe={props.timeframe}
          candleCount={props.candles.length}
          indicators={props.indicators}
          srZones={props.srZones}
          presentIndicatorIds={drawablePresence()}
          drawableZoneCount={data().candles.length > 0 ? data().zones.length : null}
          compact={compactMenu()}
        />
      </Box>
      <SRZoneSummary zones={visibleZones()} market={props.market} />
      <Box className="flex min-h-0 flex-1">
        <PatternTradingViewChart
          hit={props.hit}
          candles={props.candles}
          overlays={props.overlays}
          historyHits={props.historyHits}
          data={data()}
          timeframe={props.timeframe ?? undefined}
          hiddenNames={canvasHidden()}
          market={props.market}
          timeZone={props.timeZone}
        />
      </Box>
      <Show when={props.candles.length === 0 && !props.loading}>
        <Box className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center">
          <Text size="sm" c="dimmed">
            No chart data
          </Text>
          <Show when={props.chartNote}>
            <Text size="xs" c="dimmed" data-testid="chart-empty-note">
              {props.chartNote}
            </Text>
          </Show>
          <Show when={props.chartError}>
            <Text
              size="xs"
              c="dimmed"
              data-testid="chart-empty-reason"
              className="font-mono opacity-70"
            >
              {props.chartError}
            </Text>
          </Show>
        </Box>
      </Show>
    </div>
  );
}

/**
 * Body shared by the fullscreen modal and the `/chart/:symbol` page: the as-of
 * banner plus the 80/20 split of candles (with pattern overlays) and the
 * meta/pattern panel. The TV chart is mounted by the caller (it needs a live
 * ref and is cheap to keep mounted inside this body).
 */
export function PatternChartBody(props: PatternChartBodyProps) {
  const timeZone = () => props.timeZone ?? MARKET_TIME_ZONE[props.market ?? "india"];
  const asOfLabel = () => {
    const asOf = props.asOf;
    return typeof asOf === "string" && asOf !== "" ? asOf.replace("T", " ") : null;
  };
  const [historyCount, setHistoryCount] = createSignal(1);
  const historyHits = createMemo(() => selectLastN(props.hits ?? [], historyCount(), true));
  const docked = () => props.docked ?? false;
  const fill = () => props.fill ?? false;
  // The side panel only exists when there is a hit or an explicit empty state.
  // Without it the chart must own the full width instead of keeping an 80%
  // basis next to a 20% dead column (docked mode is unaffected).
  const showPanel = () => props.hit || props.emptyState;

  return (
    <Box
      data-testid="patterns-chart-body"
      className={`flex min-h-0 min-w-0 flex-col ${fill() ? "flex-1" : ""}`}
    >
      <Show when={asOfLabel()}>
        <Box className="px-4 pt-4">
          <Alert color="info" data-testid="patterns-fullscreen-asof-banner">
            {`Viewing as of ${asOfLabel()}`}
          </Alert>
        </Box>
      </Show>
      <Box
        className={
          docked()
            ? "flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2"
            : fill()
              ? "flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row"
              : "flex min-h-0 flex-col gap-4 p-4 h-auto lg:h-[calc(100vh-72px)] lg:flex-row"
        }
      >
        <Box
          data-testid="patterns-chart-column"
          className={`flex min-h-0 min-w-0 flex-col ${
            docked()
              ? "flex-[1_1_auto]"
              : showPanel()
                ? "flex-[1_1_auto] lg:flex-[0_0_80%]"
                : "flex-1"
          }`}
        >
          <ToolbarRow justify="flex-start" gap={6} style={{ "padding-bottom": "4px" }}>
            <Text size="xs" c="dimmed">
              History
            </Text>
            <Show when={props.feedLabel || props.delayLabel}>
              <Text
                size="xs"
                c="dimmed"
                data-testid="patterns-feed-badge"
                className="text-ui-micro uppercase tracking-[0.4px]"
              >
                {[props.feedLabel, props.delayLabel].filter(Boolean).join(" · ")}
              </Text>
            </Show>
            <SegmentedControl
              size="xs"
              data={[
                { value: "1", label: "1" },
                { value: "3", label: "3" },
                { value: "5", label: "5" },
              ]}
              value={String(historyCount())}
              onChange={(value) => setHistoryCount(Number(value))}
              data-testid="patterns-history-count"
            />
          </ToolbarRow>
          <FullscreenTV
            hit={props.hit}
            candles={props.candles}
            overlays={props.overlays}
            historyHits={historyHits()}
            chartError={props.chartError}
            chartNote={props.chartNote}
            loading={props.loading}
            market={props.market}
            timeZone={timeZone()}
            timeframe={props.timeframe}
            indicators={props.indicators}
            srZones={props.srZones}
          />
        </Box>

        <Show when={showPanel()}>
          <Box
            data-testid="patterns-chart-panel-column"
            className={`min-h-0 min-w-0 ${
              docked() ? "flex-[0_1_34%]" : "flex-[1_1_auto] lg:flex-[1_1_0]"
            }`}
          >
            <Show when={props.hit} fallback={props.emptyState}>
              {(h) => (
                <FullscreenPanel
                  hit={h()}
                  hits={props.hits}
                  onSelectHit={props.onSelectHit}
                  candles={props.candles}
                  docked={docked()}
                  livePrice={props.livePrice}
                  liveChange={props.liveChange}
                  market={props.market}
                  timeZone={timeZone()}
                  timeframe={props.timeframe}
                />
              )}
            </Show>
          </Box>
        </Show>
      </Box>
    </Box>
  );
}
