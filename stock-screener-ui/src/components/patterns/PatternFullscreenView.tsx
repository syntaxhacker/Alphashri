import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Loader, Modal, Text, ToolbarRow } from "@/ui";
import { formatCurrency, formatPercentage, getPnLTextColor } from "@/utils/ui-helpers";
import type { ChartCandle, PatternHitDTO, PatternOverlay, TFSpec, TrendLine, TrendlinesView } from "@/types/chartPatterns";
import { buildPatternTVData } from "./patternTVData";
import { PatternChartLegend } from "./PatternChartLegend";
import { PatternTradingViewChart } from "./PatternTradingViewChart";
import { TimeframeSelect } from "./TimeframeSelect";
import { PivotList } from "./PatternPivotList";
import { QualityBadge } from "./QualityBadge";
import { StatusBadge } from "./StatusBadge";
import { PIVOT_LEGEND_NAME } from "@/config/patterns";
import { TEXT_MUTED } from "@/ui/palette";

export interface PatternFullscreenViewProps {
  opened: boolean;
  onClose: () => void;
  hit: PatternHitDTO | null;
  candles: ChartCandle[];
  /** All detected patterns for the symbol, drawn as dashed siblings. */
  overlays?: PatternOverlay[];
  /**
   * Standalone support/resistance lines from the symbol-chart payload. Falls
   * back to the hit's own `trend_lines` when absent/empty.
   */
  trendLines?: TrendLine[];
  /** View-only filter for standalone support/resistance lines. */
  trendlinesView?: TrendlinesView;
  /**
   * Active fullscreen timeframe. When set together with `onTimeframeChange`
   * the toolbar renders a Timeframe selector that re-runs detection on that
   * timeframe.
   */
  timeframe?: string | null;
  /** Timeframe ladder for the selector (falls back to the contract ladder). */
  timeframes?: TFSpec[];
  /** Re-fetch the symbol chart + live hits on the newly selected timeframe. */
  onTimeframeChange?: (timeframe: string) => void;
  /** Small loading state shown next to the selector while the TF reloads. */
  loading?: boolean;
}

/**
 * Narrow right-hand data column: symbol/pattern meta plus the collapsible pivot
 * audit list. Intentionally leaves vertical room free so future panels (levels,
 * trade plan, checklist) can be added without touching the chart layout.
 */
function FullscreenPanel({ hit }: { hit: PatternHitDTO }) {
  const dayChange = hit.day_change_pct ?? null;
  const lastClose = hit.last_close ?? null;

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
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <ToolbarRow gap={4} wrap>
          <StatusBadge status={hit.status} />
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
            {lastClose != null ? formatCurrency(lastClose, 2) : "—"}
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
}: {
  hit: PatternHitDTO | null;
  candles: ChartCandle[];
  overlays?: PatternOverlay[];
  trendLines?: TrendLine[];
  trendlinesView?: TrendlinesView;
}) {
  const data = useMemo(
    () => buildPatternTVData({ candles, hit, overlays, trendLines, trendlinesView }),
    [candles, hit, overlays, trendLines, trendlinesView],
  );
  const levelEntries = useMemo(
    () => data.levels.map((level) => ({ name: level.title, color: level.color })),
    [data.levels],
  );
  const pivotEntries = useMemo(
    () => (data.markers.length ? [{ name: PIVOT_LEGEND_NAME, color: TEXT_MUTED }] : []),
    [data.markers],
  );

  // Per-series show/hide via the legend. Reset whenever the inspected pattern
  // (or symbol) changes so toggles don't leak between charts.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set<string>());
  useEffect(() => {
    setHidden(new Set<string>());
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
        markers={pivotEntries}
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
 * Full-page chart for inspecting a pattern at a readable size: real candles,
 * boundary trendlines, pivot markers, plus zoom/pan on an 80/20 split with a
 * narrow meta panel on the right. Stacks vertically below `lg`. The TV chart
 * is mounted only while open so lightweight-charts initialises against a live ref.
 */
export function PatternFullscreenView({
  opened,
  onClose,
  hit,
  candles,
  overlays,
  trendLines,
  trendlinesView = "both",
  timeframe,
  timeframes,
  onTimeframeChange,
  loading = false,
}: PatternFullscreenViewProps) {
  const title = hit ? `${hit.symbol} · ${hit.pattern_name}` : "Pattern chart";

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <ToolbarRow gap={8} align="center" wrap>
          <Text size="sm" fw={600}>
            {title}
          </Text>
          {onTimeframeChange && timeframe != null ? (
            <Box data-testid="patterns-fullscreen-timeframe">
              <TimeframeSelect
                timeframes={timeframes ?? []}
                value={timeframe}
                onChange={onTimeframeChange}
              />
            </Box>
          ) : null}
          {loading ? <Loader size="xs" data-testid="patterns-fullscreen-loading" /> : null}
        </ToolbarRow>
      }
      fullScreen
      padding={0}
      data-testid="patterns-fullscreen-modal"
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", lg: "row" },
          gap: 2,
          p: 2,
          height: { xs: "auto", lg: "calc(100vh - 72px)" },
          minHeight: 0,
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            flex: { xs: "1 1 auto", lg: "0 0 80%" },
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <FullscreenTV hit={hit} candles={candles} overlays={overlays} trendLines={trendLines} trendlinesView={trendlinesView} />
        </Box>

        <Box
          sx={{
            flex: { xs: "1 1 auto", lg: "1 1 0" },
            minWidth: 0,
            minHeight: 0,
          }}
        >
          {hit ? <FullscreenPanel hit={hit} /> : null}
        </Box>
      </Box>
    </Modal>
  );
}
