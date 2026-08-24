import { Box, Typography } from "@mui/material";
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
      sx={{ display: "flex", gap: 1, py: 1, px: 2.5, bgcolor: "background.paper", typography: "body2", color: "text.secondary", flexWrap: "wrap" }}
    >
      <Typography variant="body2" color="text.secondary" component="span">{data.candles.length} candles</Typography>
      <Typography variant="body2" color="text.secondary" component="span">•</Typography>
      <Typography variant="body2" color="text.secondary" component="span">TF: {timeframe}m</Typography>
      <Typography variant="body2" color="text.secondary" component="span">•</Typography>
      <Typography variant="body2" color="text.secondary" component="span">OR: {orMinutes}m</Typography>
      {data.high_52w && (
        <>
          <Typography variant="body2" color="text.secondary" component="span">•</Typography>
          <Typography variant="body2" color="text.secondary" component="span">52W High: ₹{data.high_52w.toFixed(2)}</Typography>
        </>
      )}
    </Box>
  );
}
