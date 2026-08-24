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
      sx={{ display: "flex", alignItems: "center", gap: 2, px: 2.5, py: 1.5, bgcolor: "background.paper", borderBottom: (t) => `1px solid ${t.palette.divider}`, flexShrink: 0 }}
    >
      <Button size="small" onClick={onBack} data-testid="chart-back-btn">
        ← Back
      </Button>
      <Typography variant="h2" data-testid="chart-title" sx={{ flexShrink: 0 }}>
        {symbol}
      </Typography>

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
  );
}
