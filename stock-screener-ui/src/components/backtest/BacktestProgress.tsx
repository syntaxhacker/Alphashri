import { Progress, Text, Group, Stack } from "@mantine/core";

interface BacktestProgressProps {
  progress: {
    current: number;
    total: number;
    message: string;
  };
}

export function BacktestProgress({ progress }: BacktestProgressProps) {
  const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  return (
    <Stack id="backtest-progress" className="backtest-progress" gap="xs" data-testid="progress-container">
      <Group justify="space-between" className="progress-header">
        <Text size="sm" fw={500} className="progress-title">
          Running...
        </Text>
        <Text size="sm" className="progress-counter" data-testid="progress-counter">
          {progress.current}/{progress.total}
        </Text>
      </Group>
      <Progress value={percent} animated size="md" className="progress-bar" data-testid="progress-fill" />
      <Text size="sm" c="dimmed" ta="center" className="progress-message" data-testid="progress-message">
        {progress.message}
      </Text>
    </Stack>
  );
}
