import { forwardRef } from "react";
import { Box, Button, Typography } from "@mui/material";

interface ChartBodyProps {
  loading: boolean;
  error: string | null;
  chartError: string | null;
  hasData: boolean;
}

export const ChartBody = forwardRef<HTMLDivElement, ChartBodyProps>(
  ({ loading, error, chartError, hasData }, ref) => {
    const displayError = error || chartError;

    return (
      <Box id="chart-body" data-testid="chart-body" sx={{ flex: 1, minHeight: 0, p: 1.5, display: "flex", flexDirection: "column" }}>
        {loading && (
          <Box data-testid="chart-loading" sx={{ p: 2 }}>
            <Typography>Loading chart...</Typography>
          </Box>
        )}

        {displayError && !loading && (
          <Box data-testid="chart-error" sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography color="error">{displayError}</Typography>
            <Button onClick={() => window.location.reload()} data-testid="chart-retry-btn" size="small" variant="outlined">
              Retry
            </Button>
          </Box>
        )}

        {!loading && !displayError && hasData && (
          <Box
            ref={ref}
            data-testid="candlestick-chart"
            id="candlestick-chart"
            style={{ width: "100%", height: "100%" }}
            sx={{ bgcolor: "background.paper", borderRadius: 1 }}
          />
        )}
      </Box>
    );
  },
);

ChartBody.displayName = "ChartBody";
