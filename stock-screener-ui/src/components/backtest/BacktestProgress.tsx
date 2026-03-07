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
    <Stack gap="xs" data-testid="progress-container">
      <Group justify="space-between">
        <Text size="sm" fw={500}>Running...</Text>
        <Text size="sm" data-testid="progress-counter">
          {progress.current}/{progress.total}
        </Text>
      </Group>
      <Progress
        value={percent}
        animated
        size="md"
        data-testid="progress-fill"
      />
      <Text size="xs" c="dimmed" ta="center" data-testid="progress-message">
        {progress.message}
      </Text>
    </Stack>
  );
}
