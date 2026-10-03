import { useEffect } from "react";
import { ActionIcon, Box, Loader, Text, Tooltip } from "@/ui";
import { IconArrowsMaximize } from "@tabler/icons-react";
import { useECharts } from "@/hooks/useECharts";
import type { ChartPayload, PatternHitDTO } from "@/types/chartPatterns";
import { buildPatternChartOption } from "./patternChartOption";

export interface PatternDetailChartProps {
  payload: ChartPayload | null;
  hit: PatternHitDTO | null;
  loading?: boolean;
  onExpand?: () => void;
}

/** Annotated candlestick for the drill-down pane with a fullscreen affordance. */
export function PatternDetailChart({ payload, hit, loading = false, onExpand }: PatternDetailChartProps) {
  const { chartRef, setChartOption } = useECharts({ isDark: true });
  const candles = payload?.candles ?? [];

  useEffect(() => {
    if (candles.length === 0) return;
    setChartOption(
      buildPatternChartOption({
        candles,
        trendlines: hit?.trendlines,
        hit,
        compact: false,
        showZoom: true,
      }) as never,
    );
  }, [candles, hit, setChartOption]);

  const hasData = candles.length > 0;

  return (
    <Box
      data-testid="patterns-detail-chart"
      sx={{
        position: "relative",
        width: "100%",
        height: 320,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.default",
        overflow: "hidden",
      }}
    >
      <Box ref={chartRef} sx={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: hasData ? 1 : 0 }} />

      {hasData && onExpand ? (
        <Tooltip label="Open fullscreen chart" withArrow position="left">
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={onExpand}
            aria-label="Open fullscreen chart"
            data-testid="patterns-detail-expand"
            sx={{ position: "absolute", top: 6, right: 6, zIndex: 2, bgcolor: "background.paper" }}
          >
            <IconArrowsMaximize size={16} />
          </ActionIcon>
        </Tooltip>
      ) : null}

      {loading && !hasData ? (
        <Box sx={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Loader size="sm" />
        </Box>
      ) : null}
      {!loading && !hasData ? (
        <Box sx={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Text size="xs" c="dimmed">
            No chart data
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
