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
      <Box
        id="chart-body"
        data-testid="chart-body"
        sx={{ flex: 1, minHeight: 0, p: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100%" }}
      >
        {loading && (
          <Box data-testid="chart-loading" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
            <Typography sx={{ textAlign: "center" }}>Loading chart...</Typography>
          </Box>
        )}

        {displayError && !loading && (
          <Box data-testid="chart-error" sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1, alignItems: "center", justifyContent: "center", width: "100%" }}>
            <Typography color="error" sx={{ textAlign: "center" }}>{displayError}</Typography>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
              <Button onClick={() => window.location.reload()} data-testid="chart-retry-btn" size="small" variant="outlined">
                Retry
              </Button>
            </Box>
          </Box>
        )}

        {!loading && !displayError && hasData && (
          <Box
            ref={ref}
            data-testid="candlestick-chart"
            id="candlestick-chart"
            sx={{ bgcolor: "background.paper", borderRadius: 1, width: "100%", maxWidth: 1200, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}
          />
        )}
      </Box>
    );
  },
);

ChartBody.displayName = "ChartBody";
