// BacktestProgress — stock loading UI shown while a backtest run is in flight.
import { Loader, Progress, Text, Stack } from "@/ui";
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

export function BacktestProgress({ progress }: BacktestProgressProps) {
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
        <Text size="xs" c="dimmed" data-testid="progress-counter" style={{ "font-variant-numeric": "tabular-nums" }}>
          {progress.current}/{progress.total}
        </Text>
      </Stack>
      <Progress
        variant="determinate"
        value={Math.max(0, Math.min(100, percent))}
        data-testid="progress-fill"
        size="md"
        style={{ height: "6px", "border-radius": "3px" }}
      />
      <Text size="xs" c="dimmed" ta="center" data-testid="progress-message">
        {progress.message}
      </Text>
    </Stack>
  );
}
