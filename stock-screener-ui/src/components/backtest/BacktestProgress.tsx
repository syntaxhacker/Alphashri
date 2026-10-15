// BacktestProgress — stock MUI loading UI shown while a backtest run is in flight.
import { memo } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";

interface BacktestProgressProps {
  progress: {
    current: number;
    total: number;
    message: string;
  };
}

export function calcProgressPercent(current: number, total: number): number {
  return total > 0 ? (current / total) * 100 : 0;
}

export const BacktestProgress = memo(function BacktestProgress({ progress }: BacktestProgressProps) {
  const percent = calcProgressPercent(progress.current, progress.total);

  return (
    <Stack
      id="backtest-progress"
      className="backtest-progress"
      spacing={1}
      data-testid="progress-container"
      sx={{ gap: 1, p: 1.5 }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <CircularProgress size={14} data-testid="progress-spinner" />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Running...
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="body2" color="text.secondary" data-testid="progress-counter" sx={{ fontVariantNumeric: "tabular-nums" }}>
          {progress.current}/{progress.total}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.max(0, Math.min(100, percent))}
        data-testid="progress-fill"
        sx={{ height: 6, borderRadius: 3 }}
      />
      <Typography variant="body2" color="text.secondary" textAlign="center" data-testid="progress-message">
        {progress.message}
      </Typography>
    </Stack>
  );
});
