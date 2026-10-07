import { Box, Text } from "@/ui";
import type { ChartPreviewData } from "../../api/chartPreview";

interface ChartFooterProps {
  data: ChartPreviewData;
  timeframe: number;
  orMinutes: number;
}

export function ChartFooter({ data, timeframe, orMinutes }: ChartFooterProps) {
  return (
    <Box
      id="chart-footer"
      data-testid="chart-footer"
      sx={{
        display: "flex",
        alignItems: "center",
        height: 30,
        minHeight: 30,
        maxHeight: 30,
        px: 1.5,
        borderTop: "1px solid var(--mui-palette-divider)",
        width: "100%",
        flexShrink: 0,
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      <Text size="xs" c="dimmed" truncate>
        {data.candles.length} candles · TF: {timeframe}m · OR: {orMinutes}m
        {data.high_52w ? ` · 52W High: ₹${data.high_52w.toFixed(2)}` : ""}
      </Text>
    </Box>
  );
}
