import { useEffect } from "react";
import { Box, Modal, Text, ToolbarRow } from "@/ui";
import { useECharts } from "@/hooks/useECharts";
import { formatCurrency, formatPercentage, getPnLTextColor } from "@/utils/ui-helpers";
import type { ChartCandle, PatternHitDTO } from "@/types/chartPatterns";
import { buildPatternChartOption } from "./patternChartOption";
import { PivotList } from "./PatternDetailPane";
import { QualityBadge } from "./QualityBadge";
import { StatusBadge } from "./StatusBadge";

export interface PatternFullscreenViewProps {
  opened: boolean;
  onClose: () => void;
  hit: PatternHitDTO | null;
  candles: ChartCandle[];
}

const LEVEL_TONE: Record<string, string> = {
  Breakout: "primary.main",
  Target: "success.main",
  Stop: "error.main",
};

function Level({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}>
      <Text size="xs" c="dimmed" fw={700} style={{ textTransform: "uppercase" }}>
        {label}
      </Text>
      <Text size="md" fw={700} c={LEVEL_TONE[label] ?? "text.primary"}>
        {value}
      </Text>
    </Box>
  );
}

function FullscreenCanvas({ hit, candles }: { hit: PatternHitDTO | null; candles: ChartCandle[] }) {
  const { chartRef, setChartOption } = useECharts({ isDark: true });

  useEffect(() => {
    if (candles.length === 0) return;
    setChartOption(
      buildPatternChartOption({
        candles,
        trendlines: hit?.trendlines,
        hit,
        compact: false,
        showZoom: true,
        large: true,
      }) as never,
    );
  }, [candles, hit, setChartOption]);

  return (
    <Box
      data-testid="patterns-fullscreen-chart"
      sx={{
        position: "relative",
        width: "100%",
        height: "calc(100vh - 220px)",
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
 * Full-page chart for inspecting a pattern at a readable size: real candles,
 * boundary trendlines, breakout/target/stop guides, plus zoom/pan. The chart
 * canvas is mounted only while open so ECharts initialises against a live ref.
 */
export function PatternFullscreenView({ opened, onClose, hit, candles }: PatternFullscreenViewProps) {
  const title = hit ? `${hit.symbol} · ${hit.pattern_name}` : "Pattern chart";
  const dayChange = hit?.day_change_pct ?? null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      fullScreen
      padding={0}
      data-testid="patterns-fullscreen-modal"
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, p: 2 }}>
        {hit ? (
          <ToolbarRow justify="space-between" gap={2} wrap>
            <ToolbarRow gap={1}>
              <StatusBadge status={hit.status} />
              <QualityBadge quality={hit.quality} />
              <Text size="xs" c="dimmed">
                {hit.symbol} · {hit.timeframe} · {hit.bars_ago} bar{hit.bars_ago === 1 ? "" : "s"} ago
              </Text>
            </ToolbarRow>
            <Text size="xs" c={getPnLTextColor(dayChange ?? 0)}>
              {hit.last_close != null ? `${formatCurrency(hit.last_close, 2)} ` : ""}
              {dayChange != null ? formatPercentage(dayChange, 2) : ""}
            </Text>
          </ToolbarRow>
        ) : null}

        <FullscreenCanvas hit={hit} candles={candles} />

        {hit ? (
          <ToolbarRow gap={3} wrap>
            <Level label="Breakout" value={hit.breakout_level ? formatCurrency(hit.breakout_level, 2) : "—"} />
            <Level label="Target" value={hit.target ? formatCurrency(hit.target, 2) : "—"} />
            <Level label="Stop" value={hit.stop ? formatCurrency(hit.stop, 2) : "—"} />
            <Level label="R:R" value={hit.rr > 0 ? hit.rr.toFixed(2) : "—"} />
            <Level label="Confidence" value={`${Math.round(hit.confidence)}`} />
            {hit.notes ? (
              <Text size="xs" c="dimmed" sx={{ flex: 1, minWidth: 220 }}>
                {hit.notes}
              </Text>
            ) : null}
          </ToolbarRow>
        ) : null}

        {hit ? <PivotList pivots={hit.pivots} /> : null}
      </Box>
    </Modal>
  );
}
