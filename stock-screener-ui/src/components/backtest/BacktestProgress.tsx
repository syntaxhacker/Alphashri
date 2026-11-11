// BacktestProgress — stock loading UI shown while a backtest run is in flight.
import { memo } from "react";
import { Loader, Progress, Stack, Text } from "@/ui";

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
      className="backtest-progress gap-2 p-1.5"
      spacing={1}
      data-testid="progress-container"
    >
      <Stack direction="row" align="center" spacing={1}>
        <Loader size="lg" data-testid="progress-spinner" />
        <Text size="xs" fw={600}>Running...</Text>
        <div className="flex-1" />
        <Text size="xs" c="muted" data-testid="progress-counter" style={{ fontVariantNumeric: "tabular-nums" }}>
          {progress.current}/{progress.total}
        </Text>
      </Stack>
      <Progress
        variant="determinate"
        value={Math.max(0, Math.min(100, percent))}
        data-testid="progress-fill"
        size="md"
        style={{ height: 6, borderRadius: 3 }}
      />
      <Text size="xs" c="muted" ta="center" data-testid="progress-message">
        {progress.message}
      </Text>
    </Stack>
  );
});
