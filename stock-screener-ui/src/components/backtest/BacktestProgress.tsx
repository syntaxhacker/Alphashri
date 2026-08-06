import { memo } from "react";
import { Progress, Text, Group, Stack } from "@/ui";

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
      gap="xs"
      data-testid="progress-container"
    >
      <Group justify="space-between" className="progress-header">
        <Text size="sm" fw={500} className="progress-title">
          Running...
        </Text>
        <Text size="sm" className="progress-counter" data-testid="progress-counter">
          {progress.current}/{progress.total}
        </Text>
      </Group>
      <Progress
        value={percent}
        animated
        size="md"
        className="progress-bar"
        data-testid="progress-fill"
      />
      <Text
        size="sm"
        c="dimmed"
        ta="center"
        className="progress-message"
        data-testid="progress-message"
      >
        {progress.message}
      </Text>
    </Stack>
  );
});
