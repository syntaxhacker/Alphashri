import type { ReactNode } from "react";
import { Box, Button, Text } from "@/ui";

interface ChartBodyProps {
  loading: boolean;
  error: string | null;
  hasData: boolean;
  chart: ReactNode;
}

export function ChartBody(
  { loading, error, hasData, chart }: ChartBodyProps,
) {
  const displayError = error;

  return (
    <Box
      id="chart-body"
      data-testid="chart-body"
      sx={{ flex: 1, minHeight: 0, width: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      {loading && (
        <Box
          data-testid="chart-loading"
          sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}
        >
          <Text size="sm" c="dimmed">
            Loading chart...
          </Text>
        </Box>
      )}

      {displayError && !loading && (
        <Box
          data-testid="chart-error"
          sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, width: "100%" }}
        >
          <Text size="sm" c="error">
            {displayError}
          </Text>
          <Button onClick={() => window.location.reload()} data-testid="chart-retry-btn" size="xs" variant="subtle">
            Retry
          </Button>
        </Box>
      )}

      {!loading && !displayError && hasData && (
        <Box
          data-testid="candlestick-chart"
          id="candlestick-chart"
          sx={{ flex: 1, minHeight: 0, width: "100%", display: "flex" }}
        >
          {chart}
        </Box>
      )}
    </Box>
  );
}
