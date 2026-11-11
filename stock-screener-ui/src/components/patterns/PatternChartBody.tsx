import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
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
import { KeyPointLegend } from "./KeyPointLegend";
import { PivotList } from "./PatternPivotList";
import { QualityBadge } from "./QualityBadge";
import { StatusBadge } from "./StatusBadge";
import { displayStatusForHit } from "./patternDisplayStatus";
import { formatPrice } from "./shared";
import { FullscreenPatternList, fullscreenHitKey } from "./FullscreenPatternList";
import { KEY_POINTS_LEGEND_NAME, PIVOT_LEGEND_NAME } from "@/config/patterns";
import { TEXT_MUTED, WARNING } from "@/ui/palette";

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
  /** Right-hand panel content when no pattern is selected (page empty state). */
  emptyState?: ReactNode;
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
function FullscreenPanel({
  hit,
  hits,
  onSelectHit,
  candles = [],
}: {
  hit: PatternHitDTO;
  hits?: PatternHitDTO[];
  onSelectHit?: (hit: PatternHitDTO) => void;
  candles?: ChartCandle[];
}) {
  // Live-detected hits carry no enrichment, so fall back to the chart's own
  // last two candles for Last close / Day.
  const lastCandle = candles.length ? candles[candles.length - 1] : null;
  const prevCandle = candles.length > 1 ? candles[candles.length - 2] : null;
  const dayChange =
    hit.day_change_pct ??
    (lastCandle && prevCandle && prevCandle.c
      ? ((lastCandle.c - prevCandle.c) / prevCandle.c) * 100
      : null);
  const lastClose = hit.last_close ?? lastCandle?.c ?? null;
  const activeKey = fullscreenHitKey(hit);

  return (
    <Box
      data-testid="patterns-fullscreen-panel"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        minWidth: 0,
        height: "100%",
        overflowY: "auto",
      }}
    >
      {hits && onSelectHit ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <FullscreenPatternList hits={hits} activeKey={activeKey} onSelect={onSelectHit} />
          <Box sx={{ borderTop: "1px solid", borderColor: "divider" }} />
        </Box>
      ) : null}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <ToolbarRow gap={4} wrap>
          <StatusBadge status={hit.status} display={displayStatusForHit(hit)} />
          <QualityBadge quality={hit.quality} />
        </ToolbarRow>
        <Text size="xs" c="dimmed" truncate>
          {hit.symbol} · {hit.timeframe} · {hit.bars_ago} bar{hit.bars_ago === 1 ? "" : "s"} ago
        </Text>
        <ToolbarRow justify="space-between" gap={4}>
          <Text size="xs" c="dimmed">
            Last close
          </Text>
          <Text size="sm" fw={600}>
            {formatPrice(lastClose)}
          </Text>
        </ToolbarRow>
        <ToolbarRow justify="space-between" gap={4}>
          <Text size="xs" c="dimmed">
            Day
          </Text>
          <Text size="xs" c={getPnLTextColor(dayChange ?? 0)}>
            {dayChange != null ? formatPercentage(dayChange, 2) : "—"}
          </Text>
        </ToolbarRow>
      </Box>

      {hit.notes ? (
        <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}>
          <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
            {hit.notes}
          </Text>
        </Box>
      ) : null}

      <KeyPointLegend hit={hit} />
      <PivotList pivots={hit.pivots} />
    </Box>
  );
}

/**
 * TradingView fullscreen chart: the lightweight-charts adapter with the compact
 * HTML legend above it. The legend entries come from the same
 * `buildPatternTVData(...).lines` the chart draws, so swatch colours always
 * match the rendered lines.
 */
function FullscreenTV({
  hit,
  candles,
  overlays,
  trendLines,
  trendlinesView = "both",
  historyHits,
}: {
  hit: PatternHitDTO | null;
  candles: ChartCandle[];
  overlays?: PatternOverlay[];
  trendLines?: TrendLine[];
  trendlinesView?: TrendlinesView;
  historyHits?: PatternHitDTO[];
}) {
  const data = useMemo(
    () => buildPatternTVData({ candles, hit, overlays, trendLines, trendlinesView, historyHits }),
    [candles, hit, overlays, trendLines, trendlinesView, historyHits],
  );
  const levelEntries = useMemo(
    () => data.levels.map((level) => ({ name: level.title, color: level.color })),
    [data.levels],
  );
  const markerEntries = useMemo(() => {
    const hasPivots = data.markers.some((marker) => marker.group !== "keypoints");
    const hasKeys = data.markers.some((marker) => marker.group === "keypoints");
    return [
      ...(hasPivots ? [{ name: PIVOT_LEGEND_NAME, color: TEXT_MUTED }] : []),
      ...(hasKeys ? [{ name: KEY_POINTS_LEGEND_NAME, color: WARNING }] : []),
    ];
  }, [data.markers]);

  // Per-series show/hide via the legend. Reset whenever the inspected pattern
  // (or symbol) changes so toggles don't leak between charts.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => new Set<string>([PIVOT_LEGEND_NAME]),
  );
  useEffect(() => {
    setHidden(new Set<string>([PIVOT_LEGEND_NAME]));
  }, [hit?.symbol, hit?.pattern_id, hit?.start_date]);
  const toggle = useCallback((name: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        flex: 1,
        height: { xs: "60vh", lg: "100%" },
        minHeight: 360,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.default",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <PatternChartLegend
        lines={data.lines}
        levels={levelEntries}
        markers={markerEntries}
        hidden={hidden}
        onToggle={toggle}
      />
      <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
        <PatternTradingViewChart
          hit={hit}
          candles={candles}
          overlays={overlays}
          trendLines={trendLines}
          trendlinesView={trendlinesView}
          historyHits={historyHits}
          hiddenNames={hidden}
        />
      </Box>
      {candles.length === 0 ? (
        <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Text size="sm" c="dimmed">
            No chart data
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * Body shared by the fullscreen modal and the `/chart/:symbol` page: the as-of
 * banner plus the 80/20 split of candles (with pattern overlays) and the
 * meta/pattern panel. The TV chart is mounted by the caller (it needs a live
 * ref and is cheap to keep mounted inside this body).
 */
export function PatternChartBody({
  hit,
  candles,
  hits,
  onSelectHit,
  overlays,
  trendLines,
  trendlinesView = "both",
  asOf = null,
  emptyState,
  fill = false,
  docked = false,
}: PatternChartBodyProps) {
  const asOfLabel = typeof asOf === "string" && asOf !== "" ? asOf.replace("T", " ") : null;
  const [historyCount, setHistoryCount] = useState(3);
  const historyHits = useMemo(
    () => selectLastN(hits ?? [], historyCount, true),
    [hits, historyCount],
  );

  return (
    <Box
      data-testid="patterns-chart-body"
      sx={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        ...(fill ? { flex: 1 } : {}),
      }}
    >
      {asOfLabel ? (
        <Box sx={{ px: 2, pt: 2 }}>
          <Alert color="info" data-testid="patterns-fullscreen-asof-banner">
            {`Viewing as of ${asOfLabel}`}
          </Alert>
        </Box>
      ) : null}
      <Box
        sx={{
          display: "flex",
          flexDirection: docked ? "column" : { xs: "column", lg: "row" },
          gap: docked ? 1 : 2,
          p: docked ? 1 : 2,
          minHeight: 0,
          ...(fill
            ? { flex: 1 }
            : docked
              ? {}
              : { height: { xs: "auto", lg: "calc(100vh - 72px)" } }),
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            flex: docked ? "1 1 auto" : { xs: "1 1 auto", lg: "0 0 80%" },
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <ToolbarRow justify="flex-start" gap={6} style={{ paddingBottom: 4 }}>
            <Text size="xs" c="dimmed">History</Text>
            <SegmentedControl
              size="xs"
              data={[
                { value: "1", label: "1" },
                { value: "3", label: "3" },
                { value: "5", label: "5" },
              ]}
              value={String(historyCount)}
              onChange={(value) => setHistoryCount(Number(value))}
              data-testid="patterns-history-count"
            />
          </ToolbarRow>
          <FullscreenTV
            hit={hit}
            candles={candles}
            overlays={overlays}
            trendLines={trendLines}
            trendlinesView={trendlinesView}
            historyHits={historyHits}
          />
        </Box>

        {hit || emptyState ? (
          <Box
            sx={{
              flex: docked ? "0 1 34%" : { xs: "1 1 auto", lg: "1 1 0" },
              minWidth: 0,
              minHeight: 0,
            }}
          >
            {hit ? (
              <FullscreenPanel hit={hit} hits={hits} onSelectHit={onSelectHit} candles={candles} />
            ) : (
              emptyState
            )}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
