import { Paper, Stack, Group, Badge, Button, Text, Progress, Divider } from "@/ui";
import { IconPlayerPause, IconPlayerPlay, IconX } from "@tabler/icons-react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  getExperimentState,
  subscribe,
  pauseExperiment,
  resumeExperiment,
  cancelExperiment,
} from "../../state/experiments";

const STATUS_COLOR: Record<string, string> = {
  running: "blue",
  paused: "yellow",
  completed: "green",
  cancelled: "gray",
  error: "red",
};

function lastResultDescription(lastResult: any, bestDesc: string): string | null {
  if (lastResult && typeof lastResult === "object" && lastResult.description) {
    return lastResult.description;
  }
  return bestDesc || null;
}

export function ExperimentsProgress() {
  useStoreSubscription(subscribe);
  const s = getExperimentState();
  const exp = s.state;

  if (!exp) {
    return (
      <Paper p="sm" radius="sm" elevation={1} data-testid="experiments-progress">
        <Text size="sm" c="dimmed" data-testid="experiments-progress-empty">
          No active experiment
        </Text>
      </Paper>
    );
  }

  const status = exp.status;
  const percent = exp.total > 0 ? Math.min(100, Math.max(0, (exp.current / exp.total) * 100)) : 0;
  const canControl = status === "running" || status === "paused";
  const lastResult = lastResultDescription(exp.last_result, exp.best_desc);

  return (
    <Paper p="sm" radius="sm" elevation={1} data-testid="experiments-progress">
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Group gap={6} align="center">
            <Badge color={STATUS_COLOR[status] ?? "gray"} size="sm" data-testid="experiments-progress-status">
              {status}
            </Badge>
            {s.activeSession && (
              <Text size="xs" c="dimmed" data-testid="experiments-progress-session">
                {s.activeSession}
              </Text>
            )}
          </Group>
          <Text size="sm" fw={500} data-testid="experiments-progress-counter">
            {exp.current}/{exp.total}
          </Text>
        </Group>

        <Progress
          value={percent}
          animated={status === "running"}
          size="md"
          data-testid="experiments-progress-bar"
        />

        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <Text size="sm" data-testid="experiments-progress-best-pf">
            best PF {exp.best_pf != null ? exp.best_pf.toFixed(2) : "—"}
          </Text>
          {lastResult && (
            <Text size="xs" c="dimmed" data-testid="experiments-progress-last-result">
              {lastResult}
            </Text>
          )}
        </Group>

        {canControl && (
          <>
            <Divider />
            <Group gap="xs" align="center">
              {status === "running" && (
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="experiments-pause-btn"
                  leftSection={<IconPlayerPause size={12} />}
                  onClick={() => void pauseExperiment()}
                >
                  Pause
                </Button>
              )}
              {status === "paused" && (
                <Button
                  size="sm"
                  variant="filled"
                  data-testid="experiments-resume-btn"
                  leftSection={<IconPlayerPlay size={12} />}
                  onClick={() => void resumeExperiment()}
                >
                  Resume
                </Button>
              )}
              <Button
                size="sm"
                variant="subtle"
                color="red"
                data-testid="experiments-cancel-btn"
                leftSection={<IconX size={12} />}
                onClick={() => void cancelExperiment()}
              >
                Cancel
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}
