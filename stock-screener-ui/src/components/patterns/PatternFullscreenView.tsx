import { useEffect } from "react";
import { Box, Modal, Text, ToolbarRow } from "@/ui";
import { useECharts } from "@/hooks/useECharts";
import { formatCurrency, formatPercentage, getPnLTextColor } from "@/utils/ui-helpers";
import type { ChartCandle, PatternHitDTO, PatternOverlay } from "@/types/chartPatterns";
import { buildPatternChartOption } from "./patternChartOption";
import { PivotList } from "./PatternPivotList";
import { QualityBadge } from "./QualityBadge";
import { StatusBadge } from "./StatusBadge";

export interface PatternFullscreenViewProps {
  opened: boolean;
  onClose: () => void;
  hit: PatternHitDTO | null;
  candles: ChartCandle[];
  /** All detected patterns for the symbol, drawn as dashed siblings. */
  overlays?: PatternOverlay[];
}

function FullscreenCanvas({
  hit,
  candles,
  overlays,
}: {
  hit: PatternHitDTO | null;
  candles: ChartCandle[];
  overlays?: PatternOverlay[];
}) {
  const { chartRef, setChartOption } = useECharts({ isDark: true });

  useEffect(() => {
    if (candles.length === 0) return;
    // The breakout/target/stop level guides are intentionally suppressed while
    // the levels panel is re-planned; only the box/pattern boundaries and the
    // swing pivots are drawn. Passing zeroed levels keeps every other field
    // (symbol, trendlines, pivots) intact for the shared option builder.
    const chartHit = hit ? { ...hit, breakout_level: 0, target: 0, stop: 0 } : hit;
    setChartOption(
      buildPatternChartOption({
        candles,
        trendlines: hit?.trendlines,
        hit: chartHit,
        overlays,
        selectedPatternId: hit?.pattern_id,
        selectedStartDate: hit?.start_date,
        compact: false,
        showZoom: true,
        large: true,
      }) as never,
    );
  }, [candles, hit, overlays, setChartOption]);

  return (
    <Box
      data-testid="patterns-fullscreen-chart"
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
      }}
    >
      <Box ref={chartRef} sx={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
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
 * Full-page chart for inspecting a pattern at a readable size: real candles,
 * boundary trendlines, pivot markers, plus zoom/pan on an 80/20 split with a
 * narrow meta panel on the right. Stacks vertically below `lg`. The chart
 * canvas is mounted only while open so ECharts initialises against a live ref.
 */
export function PatternFullscreenView({
  opened,
  onClose,
  hit,
  candles,
  overlays,
}: PatternFullscreenViewProps) {
  const title = hit ? `${hit.symbol} · ${hit.pattern_name}` : "Pattern chart";

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
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
          <FullscreenCanvas hit={hit} candles={candles} overlays={overlays} />
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
