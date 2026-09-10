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
      sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, bgcolor: "background.paper", typography: "body2", color: "text.secondary", flexWrap: "wrap", width: "100%" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, flexWrap: "wrap" }}>
        <Typography variant="body2" color="text.secondary" component="span" sx={{ textAlign: "center" }}>{data.candles.length} candles</Typography>
        <Typography variant="body2" color="text.secondary" component="span">•</Typography>
        <Typography variant="body2" color="text.secondary" component="span" sx={{ textAlign: "center" }}>TF: {timeframe}m</Typography>
        <Typography variant="body2" color="text.secondary" component="span">•</Typography>
        <Typography variant="body2" color="text.secondary" component="span" sx={{ textAlign: "center" }}>OR: {orMinutes}m</Typography>
        {data.high_52w && (
          <>
            <Typography variant="body2" color="text.secondary" component="span">•</Typography>
            <Typography variant="body2" color="text.secondary" component="span" sx={{ textAlign: "center" }}>52W High: ₹{data.high_52w.toFixed(2)}</Typography>
          </>
        )}
      </Box>
    </Box>
  );
}
