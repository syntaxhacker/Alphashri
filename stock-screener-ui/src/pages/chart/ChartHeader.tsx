import { Box, Typography, Button } from "@mui/material";
import { ChartControls } from "./ChartControls";

interface ChartHeaderProps {
  symbol: string;
  timeframe: number;
  orMinutes: number;
  showPivots: boolean;
  show52wHigh: boolean;
  onBack: () => void;
  onTimeframeChange: (value: number) => void;
  onOrMinutesChange: (value: number) => void;
  onPivotsChange: (checked: boolean) => void;
  on52wHighChange: (checked: boolean) => void;
}

export function ChartHeader({
  symbol,
  timeframe,
  orMinutes,
  showPivots,
  show52wHigh,
  onBack,
  onTimeframeChange,
  onOrMinutesChange,
  onPivotsChange,
  on52wHighChange,
}: ChartHeaderProps) {
  return (
    <Box
      id="chart-header"
      data-testid="chart-header"
      sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, bgcolor: "background.paper", flexShrink: 0, minHeight: 48, width: "100%" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, justifyContent: "center", flexWrap: "wrap", width: "100%", maxWidth: 1200, p: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
          <Button size="small" onClick={onBack} data-testid="chart-back-btn">
            ← Back
          </Button>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
          <Typography variant="h6" data-testid="chart-title" sx={{ flexShrink: 0, textAlign: "center" }}>
            {symbol}
          </Typography>
        </Box>
        <ChartControls
          timeframe={timeframe}
          orMinutes={orMinutes}
          showPivots={showPivots}
          show52wHigh={show52wHigh}
          onTimeframeChange={onTimeframeChange}
          onOrMinutesChange={onOrMinutesChange}
          onPivotsChange={onPivotsChange}
          on52wHighChange={on52wHighChange}
        />
      </Box>
    </Box>
  );
}
