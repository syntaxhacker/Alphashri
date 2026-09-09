interface ChartErrorProps {
  onBackToScreener: () => void;
}

import { Box, Button, Typography } from "@mui/material";

export function ChartError({ onBackToScreener }: ChartErrorProps) {
  return (
    <Box data-testid="chart-view-error" sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1, alignItems: "center", justifyContent: "center", width: "100%" }}>
      <Typography sx={{ textAlign: "center" }}>No symbol specified</Typography>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
        <Button onClick={onBackToScreener} size="small" variant="outlined">
          Back to Screener
        </Button>
      </Box>
    </Box>
  );
}
