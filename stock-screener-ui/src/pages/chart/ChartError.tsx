interface ChartErrorProps {
  onBackToScreener: () => void;
}

import { Box, Button, Typography } from "@mui/material";

export function ChartError({ onBackToScreener }: ChartErrorProps) {
  return (
    <Box data-testid="chart-view-error" sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
      <Typography>No symbol specified</Typography>
      <Button onClick={onBackToScreener} size="small" variant="outlined">
        Back to Screener
      </Button>
    </Box>
  );
}
