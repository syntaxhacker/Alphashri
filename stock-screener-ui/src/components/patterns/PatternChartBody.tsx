import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Alert, Box, SegmentedControl, Text, ToolbarRow } from "@/ui";
import { formatPercentage, getPnLTextColor } from "@/utils/ui-helpers";
import type {
  ChartCandle,
  PatternHitDTO,
  PatternOverlay,
  TrendLine,
  TrendlinesView,
} from "@/types/chartPatterns";
import { buildPatternTVData } from "./patternTVData";
import { selectLastN } from "./selectLastN";
import { PatternChartLegend } from "./PatternChartLegend";
import { PatternTradingViewChart } from "./PatternTradingViewChart";
import { FullscreenPatternList, fullscreenHitKey } from "./FullscreenPatternList";
import { KeyPointLegend } from "./KeyPointLegend";
import { PivotList } from "./PatternPivotList";
import { QualityBadge } from "./QualityBadge";
import { StatusBadge } from "./StatusBadge";
import { displayStatusForHit } from "./patternDisplayStatus";
import { formatPrice } from "./shared";
import { KEY_POINTS_LEGEND_NAME, PIVOT_LEGEND_NAME } from "@/config/patterns";
import { TZ_IST } from "@/config/constants";
import { formatChartTick } from "./datetime";
import { PRIMARY, TEXT_MUTED, WARNING } from "@/ui/palette";

const IST_KEY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ_IST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function istKeyFromDate(date: Date): string {
  const parts = IST_KEY_FORMAT.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * IST session date (`YYYY-MM-DD`) behind a candle/hit timestamp, or null when it
 * cannot be parsed. An ISO instant with an offset is converted; a bare calendar
 * date (or an IST-local `YYYY-MM-DD HH:mm`) is already a session date.
 */
function istDateKey(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : istKeyFromDate(new Date(ms));
}

/** `13 Nov` within the current year, `13 Nov 2025` for an older bar. */
function barDateLabel(value: string): string {
  const key = istDateKey(value);
  if (!key) return formatChartTick(value).toUpperCase();
  const base = formatChartTick(key);
  const year = key.slice(0, 4);
  const currentYear = istKeyFromDate(new Date()).slice(0, 4);
  return (year === currentYear ? base : `${base} ${year}`).toUpperCase();
}

export interface CloseSeries {
  close: number | null;
  changePct: number | null;
  barDate: string | null;
  source: "hit" | "chart";
}

/**
 * Choose one source for the displayed close *and* its change: a hit enrichment
 * only wins when it carries a complete pair whose `close_bar_date` proves the
 * bar is not older than the chart's last candle. `end_date` is the pattern
 * formation date, not the close's bar date, so it is never used as a proxy.
 * Without that date (or without a chart bar to compare) the drawn series wins;
 * a partial enrichment never mixes with a chart bar.
 */
export function resolveCloseSeries(params: {
  hit: Pick<PatternHitDTO, "last_close" | "day_change_pct" | "close_bar_date">;
  candles: ChartCandle[];
}): CloseSeries {
  const { hit, candles } = params;
  const last = candles.length ? candles[candles.length - 1] : null;
  const prev = candles.length > 1 ? candles[candles.length - 2] : null;
  const chart: CloseSeries = {
    close: last?.c ?? null,
    changePct:
      last && prev && prev.c ? ((last.c - prev.c) / prev.c) * 100 : null,
    barDate: last?.t ?? null,
    source: "chart",
  };

  const hasPair = hit.last_close != null && hit.day_change_pct != null;
  const hitKey = istDateKey(hit.close_bar_date);
  const chartKey = istDateKey(last?.t ?? null);
  if (!hasPair || !hitKey) return chart;
  if (chartKey && hitKey < chartKey) return chart;

  return {
    close: hit.last_close ?? null,
    changePct: hit.day_change_pct ?? null,
    barDate: hit.close_bar_date ?? null,
    source: "hit",
  };
}

export interface PatternChartBodyProps {
  hit: PatternHitDTO | null;
  candles: ChartCandle[];
  /** Detected patterns for the symbol (newest-first single-select list). */
  hits?: PatternHitDTO[];
  /** Switch the chart to the selected single pattern (replaces the active hit). */
  onSelectHit?: (hit: PatternHitDTO) => void;
  /**
   * Kept for API compatibility; the parent passes an empty list so only the
   * active pattern is drawn (no dashed siblings).
   */
  overlays?: PatternOverlay[];
  /**
   * Standalone support/resistance lines from the symbol-chart payload. Falls
   * back to the hit's own `trend_lines` when absent/empty.
   */
  trendLines?: TrendLine[];
  /** View-only filter for standalone support/resistance lines. */
  trendlinesView?: TrendlinesView;
  /** As-of replay cutoff (ISO local datetime, null = live). */
  asOf?: string | null;
  /** A fetch is in flight with no candles yet — loading is not "no data". */
  loading?: boolean;
  /** Chart endpoint failure code, shown under the empty state. */
  chartError?: string | null;
  /** Human-readable reason for an empty chart. */
  chartNote?: string | null;
  /** Live quote from the market snapshot. The LTP line is omitted when null. */
  livePrice?: number | null;
  /** Day change % paired with `livePrice`. */
  liveChange?: number | null;
  /** Right-hand panel content when no pattern is selected (page empty state). */
  emptyState?: JSX.Element;
  /**
   * Fill the flex parent (page layout) instead of sizing to the modal viewport.
   * The fullscreen modal keeps its `calc(100vh - 72px)` body height.
   */
  fill?: boolean;
  /**
   * Docked (right-rail) layout: stack the chart above the meta column instead
   * of the modal's 80/20 side-by-side split, and tighten the padding.
   */
  docked?: boolean;
}

/**
 * Narrow right-hand data column: symbol/pattern meta plus the collapsible pivot
 * audit list. Intentionally leaves vertical room free so future panels (levels,
 * trade plan, checklist) can be added without touching the chart layout.
 */
function SectionLabel(props: { children?: JSX.Element; action?: JSX.Element }) {
  return (
    <Box className="flex items-center justify-between gap-2">
      <Text
        size="xs"
        fw={700}
        c="dimmed"
        style={{ "font-size": "10px", "text-transform": "uppercase", "letter-spacing": "0.4px" }}
      >
        {props.children}
      </Text>
      {props.action}
    </Box>
  );
}

function FullscreenPanel(props: {
  hit: PatternHitDTO;
  hits?: PatternHitDTO[];
  onSelectHit?: (hit: PatternHitDTO) => void;
  candles?: ChartCandle[];
  docked?: boolean;
  livePrice?: number | null;
  liveChange?: number | null;
}) {
  // Enrichment is only as fresh as the frame it was captured on; the drawn
  // candles are the authority whenever the hit cannot be dated or is older.
  const series = createMemo(() =>
    resolveCloseSeries({ hit: props.hit, candles: props.candles ?? [] }),
  );
  const closeLabel = () => {
    const barDate = series().barDate;
    if (!barDate) return "CLOSE";
    const key = istDateKey(barDate);
    const isPrev = key != null && key !== istKeyFromDate(new Date());
    return `${isPrev ? "PREV CLOSE" : "CLOSE"} · ${barDateLabel(barDate)}`;
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
              <Text fw={700} className="truncate text-[13px] leading-none">
                {props.hit.symbol}
              </Text>
              <Text size="xs" c="dimmed" className="whitespace-nowrap text-[10px]">
                {props.hit.timeframe} · {props.hit.bars_ago} bar{props.hit.bars_ago === 1 ? "" : "s"} ago
              </Text>
            </Box>
            <Text size="xs" c="dimmed" className="truncate text-[11px]">
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
              className="text-[10px] uppercase tracking-[0.4px]"
              data-testid="patterns-close-label"
            >
              {closeLabel()}
            </Text>
            <Box className="flex min-w-0 items-baseline gap-2">
              <Text fw={600} className="font-mono tabular-nums text-[18px] leading-none">
                {formatPrice(series().close)}
              </Text>
              <Text
                size="xs"
                fw={600}
                className="font-mono tabular-nums text-[11px]"
                c={getPnLTextColor(series().changePct ?? 0)}
              >
                {series().changePct != null ? formatPercentage(series().changePct!, 2) : "—"}
              </Text>
            </Box>
            <Show when={props.livePrice != null}>
              <Box className="flex min-w-0 items-baseline gap-2" data-testid="patterns-ltp-line">
                <Text size="xs" c="dimmed" className="text-[10px] uppercase tracking-[0.4px]">
                  LTP
                </Text>
                <Text fw={600} className="font-mono tabular-nums text-[14px] leading-none">
                  {formatPrice(props.livePrice!)}
                </Text>
                <Text
                  size="xs"
                  fw={600}
                  className="font-mono tabular-nums text-[11px]"
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
              <Text size="xs" c="dimmed" className="text-[10px] uppercase tracking-[0.4px]">
                Confidence <span className="font-mono tabular-nums text-fin-text">{props.hit.confidence}%</span>
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
          <FullscreenPatternList hits={props.hits!} activeKey={activeKey()} onSelect={props.onSelectHit!} />
        </Box>
      </Show>

      <Show when={props.hit.notes}>
        <Box className="flex flex-col gap-1 border-t border-fin-border px-3 py-2">
          <SectionLabel>Notes</SectionLabel>
          <Text size="xs" c="dimmed" className="text-[11px]" style={{ "overflow-wrap": "anywhere" }}>
            {props.hit.notes}
          </Text>
        </Box>
      </Show>

      <KeyPointLegend hit={props.hit} />
      <PivotList pivots={props.hit.pivots} />
    </Box>
  );
}

/**
 * TradingView fullscreen chart: the lightweight-charts adapter with the compact
 * HTML legend above it. The legend entries come from the same
 * `buildPatternTVData(...).lines` the chart draws, so swatch colours always
 * match the rendered lines.
 */
function FullscreenTV(props: {
  hit: PatternHitDTO | null;
  candles: ChartCandle[];
  overlays?: PatternOverlay[];
  trendLines?: TrendLine[];
  trendlinesView?: TrendlinesView;
  historyHits?: PatternHitDTO[];
  chartError?: string | null;
  chartNote?: string | null;
  loading?: boolean;
}) {
  const trendlinesView = () => props.trendlinesView ?? "both";
  const data = createMemo(() =>
    buildPatternTVData({
      candles: props.candles,
      hit: props.hit,
      overlays: props.overlays,
      trendLines: props.trendLines,
      trendlinesView: trendlinesView(),
      historyHits: props.historyHits,
    }),
  );
  const levelEntries = createMemo(() =>
    data().levels.map((level) => ({ name: level.title, color: level.color })),
  );
  const markerEntries = createMemo(() => {
    const hasPivots = data().markers.some((marker) => marker.group !== "keypoints");
    const hasKeys = data().markers.some((marker) => marker.group === "keypoints");
    return [
      ...(hasPivots ? [{ name: PIVOT_LEGEND_NAME, color: TEXT_MUTED }] : []),
      ...(hasKeys ? [{ name: KEY_POINTS_LEGEND_NAME, color: WARNING }] : []),
    ];
  });

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
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <Box
      className="relative flex h-[60vh] min-h-[360px] w-full flex-1 flex-col overflow-hidden rounded-fin border border-fin-border bg-fin-bg lg:h-full"
    >
      <PatternChartLegend
        lines={data().lines}
        levels={levelEntries()}
        markers={markerEntries()}
        hidden={hidden()}
        onToggle={toggle}
      />
      <Box className="flex min-h-0 flex-1">
        <PatternTradingViewChart
          hit={props.hit}
          candles={props.candles}
          overlays={props.overlays}
          trendLines={props.trendLines}
          trendlinesView={trendlinesView()}
          historyHits={props.historyHits}
          hiddenNames={hidden()}
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
            <Text size="xs" c="dimmed" data-testid="chart-empty-reason" className="font-mono opacity-70">
              {props.chartError}
            </Text>
          </Show>
        </Box>
      </Show>
    </Box>
  );
}

/**
 * Body shared by the fullscreen modal and the `/chart/:symbol` page: the as-of
 * banner plus the 80/20 split of candles (with pattern overlays) and the
 * meta/pattern panel. The TV chart is mounted by the caller (it needs a live
 * ref and is cheap to keep mounted inside this body).
 */
export function PatternChartBody(props: PatternChartBodyProps) {
  const asOfLabel = () => {
    const asOf = props.asOf;
    return typeof asOf === "string" && asOf !== "" ? asOf.replace("T", " ") : null;
  };
  const [historyCount, setHistoryCount] = createSignal(3);
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
            ? "flex min-h-0 flex-col gap-2 p-2"
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
            <Text size="xs" c="dimmed">History</Text>
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
            trendLines={props.trendLines}
            trendlinesView={props.trendlinesView}
            historyHits={historyHits()}
            chartError={props.chartError}
            chartNote={props.chartNote}
            loading={props.loading}
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
                />
              )}
            </Show>
          </Box>
        </Show>
      </Box>
    </Box>
  );
}
