import { memo } from "react";
import { Progress, Text, Group, Stack, Box } from "@/ui";

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
      gap="xs"
      data-testid="progress-container"
      sx={{ gap: 1, p: 1 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }}>
        <Text size="sm" fw={500} c="dimmed" sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>
          Running...
        </Text>
        <Text size="sm" sx={{ flex: 1, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end" }} data-testid="progress-counter">
          {progress.current}/{progress.total}
        </Text>
      </Box>
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
