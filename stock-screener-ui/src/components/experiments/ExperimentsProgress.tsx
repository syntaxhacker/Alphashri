import { Show } from "solid-js";
import { Paper, Stack, Box, Badge, Button, Text, Progress, Divider } from "@/ui";
import { IconPlayerPause, IconPlayerPlay, IconX } from "../common/Icons";
import {
  pauseExperiment,
  resumeExperiment,
  cancelExperiment,
} from "../../state/experiments";
import { useExperimentState } from "./useExperimentState";

const STATUS_COLOR: Record<string, string> = {
  running: "primary",
  paused: "warning",
  completed: "success",
  cancelled: "secondary",
  error: "error",
};

function lastResultDescription(lastResult: unknown, bestDesc: string): string | null {
  if (lastResult && typeof lastResult === "object" && "description" in lastResult) {
    const d = (lastResult as { description?: unknown }).description;
    return typeof d === "string" ? d : null;
  }
  return bestDesc || null;
}

export function ExperimentsProgress() {
  const state = useExperimentState();
  const exp = () => state().state;

  return (
    <Show
      when={exp()}
      fallback={
        <Paper elevation={0} p="sm" className="flex items-stretch justify-start" data-testid="experiments-progress">
          <Text size="sm" c="dimmed" data-testid="experiments-progress-empty">
            No active experiment
          </Text>
        </Paper>
      }
    >
      {(e) => {
        const percent = () => {
          const total = e().total;
          return total > 0 ? Math.min(100, Math.max(0, (e().current / total) * 100)) : 0;
        };
        const status = () => e().status;
        const canControl = () => status() === "running" || status() === "paused";
        const lastResult = () => lastResultDescription(e().last_result, e().best_desc);
        return (
          <Paper elevation={0} p="sm" className="flex flex-col items-stretch gap-2" data-testid="experiments-progress">
            <Stack gap={1} className="w-full items-stretch">
              <Box className="flex items-center justify-between gap-2">
                <Box className="flex items-center gap-2">
                  <Badge color={STATUS_COLOR[status()] ?? "secondary"} size="sm" data-testid="experiments-progress-status">
                    {status()}
                  </Badge>
                  <Show when={state().activeSession}>
                    <Text size="xs" c="dimmed" data-testid="experiments-progress-session">
                      {state().activeSession}
                    </Text>
                  </Show>
                </Box>
                <Text size="sm" fw={500} data-testid="experiments-progress-counter">
                  {e().current}/{e().total}
                </Text>
              </Box>

              <Progress
                value={percent()}
                animated={status() === "running"}
                size="md"
                data-testid="experiments-progress-bar"
              />

              <Box className="flex items-center justify-between gap-2 flex-wrap">
                <Text size="sm" data-testid="experiments-progress-best-pf">
                  best PF {e().best_pf != null ? e().best_pf.toFixed(2) : "—"}
                </Text>
                <Show when={lastResult()}>
                  <Text size="xs" c="dimmed" data-testid="experiments-progress-last-result">
                    {lastResult()}
                  </Text>
                </Show>
              </Box>

              <Show when={canControl()}>
                <Divider />
                <Box className="flex items-center justify-center gap-2">
                  <Show when={status() === "running"}>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="experiments-pause-btn"
                      leftSection={<IconPlayerPause size={12} />}
                      onClick={() => void pauseExperiment()}
                    >
                      Pause
                    </Button>
                  </Show>
                  <Show when={status() === "paused"}>
                    <Button
                      size="sm"
                      variant="filled"
                      data-testid="experiments-resume-btn"
                      leftSection={<IconPlayerPlay size={12} />}
                      onClick={() => void resumeExperiment()}
                    >
                      Resume
                    </Button>
                  </Show>
                  <Button
                    size="sm"
                    variant="subtle"
                    color="error"
                    data-testid="experiments-cancel-btn"
                    leftSection={<IconX size={12} />}
                    onClick={() => void cancelExperiment()}
                  >
                    Cancel
                  </Button>
                </Box>
              </Show>
            </Stack>
          </Paper>
        );
      }}
    </Show>
  );
}
