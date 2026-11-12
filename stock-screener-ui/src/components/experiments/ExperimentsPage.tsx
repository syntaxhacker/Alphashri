import { For, Show, createEffect, createMemo, onCleanup, onMount } from "solid-js";
import { Alert, Badge, Box, Stack, Text, ToolbarRow } from "@/ui";
import { IconAlertCircle } from "../common/Icons";
import {
  fetchSessions,
  fetchStrategies,
  selectSession,
  startPolling,
  stopPolling,
} from "../../state/experiments";
import { useExperimentState } from "./useExperimentState";
import { ExperimentsConfig } from "./ExperimentsConfig";
import { ExperimentsProgress } from "./ExperimentsProgress";
import { ExperimentsResultsTable } from "./ExperimentsResultsTable";
import { ExperimentsChart } from "./ExperimentsChart";

function sessionStatusColor(status: string): string {
  switch (status) {
    case "running":
      return "primary";
    case "completed":
      return "success";
    case "error":
      return "error";
    default:
      return "secondary";
  }
}

const paneSx = {
  "min-height": 0,
  "min-width": 0,
  overflow: "hidden",
  display: "flex",
  "flex-direction": "column",
  border: "1px solid #30363D",
  "border-radius": 8,
  "background-color": "#000000",
} as const;

const paneHeaderSx = {
  display: "flex",
  "align-items": "center",
  gap: 0.5,
  "padding-left": 8,
  "min-height": 28,
  borderBottom: "1px solid #30363D",
  flex: "0 0 auto",
} as const;

export function ExperimentsPage() {
  const state = useExperimentState();
  const activeSession = createMemo(() => state().activeSession);

  onMount(() => {
    void fetchStrategies();
    void fetchSessions();
  });

  createEffect(() => {
    const active = activeSession();
    if (active) {
      startPolling(active);
    }
    onCleanup(() => stopPolling());
  });

  return (
    <Box
      data-testid="experiments-page"
      className="h-full min-h-0 flex flex-col gap-1 p-1 overflow-hidden"
      style={{ height: "100%", "min-height": 0, display: "flex", "flex-direction": "column", gap: 4, padding: 4, overflow: "hidden" }}
    >
      <ToolbarRow
        justify="space-between"
        gap={8}
        style={{ "min-height": 28, flex: "0 0 auto" }}
      >
        <Box className="flex items-baseline gap-2 min-w-0" style={{ display: "flex", "align-items": "baseline", gap: 8, "min-width": 0 }}>
          <Text size="sm" fw={700} style={{ "line-height": 1.2 }}>
            Experiments
          </Text>
          <Text size="xs" c="dimmed">
            {state().sessions.length} {state().sessions.length === 1 ? "session" : "sessions"}
          </Text>
        </Box>
        <Show when={state().activeSession}>
          <Badge size="xs" variant="light" color="primary">
            {state().activeSession}
          </Badge>
        </Show>
      </ToolbarRow>

      <Show when={state().error}>
        <Alert
          data-testid="experiments-error"
          icon={<IconAlertCircle size={16} />}
          title="Error"
          color="error"
          variant="filled"
          withCloseButton
          style={{ flex: "0 0 auto" }}
        >
          {state().error}
        </Alert>
      </Show>

      <Box
        className="shrink-0 overflow-auto border border-fin-border rounded-fin"
        style={{
          flex: "0 0 auto",
          "max-height": "36vh",
          overflow: "auto",
          border: "1px solid #30363D",
          "border-radius": 8,
          "background-color": "#000000",
        }}
        data-testid="experiments-config-scroll"
      >
        <ExperimentsConfig />
      </Box>

      <Box
        className="flex-1 min-h-0 grid gap-1 overflow-auto"
        style={{
          flex: 1,
          "min-height": 0,
          display: "grid",
          gap: 4,
          overflow: "auto",
          "grid-template-columns": "1fr",
        }}
      >
        <Box style={paneSx} data-testid="experiments-session-list">
          <Box style={paneHeaderSx}>
            <Text fw={600} size="sm">
              Sessions
            </Text>
            <div className="flex-1" />
            <Text size="xs" c="dimmed">
              {state().sessions.length}
            </Text>
          </Box>
          <Box flex={1} className="min-h-0 overflow-auto p-1" style={{ flex: 1, "min-height": 0, overflow: "auto", padding: 4 }}>
            <Show
              when={state().sessions.length > 0}
              fallback={
                <Box className="flex items-center justify-center p-2" style={{ display: "flex", "align-items": "center", "justify-content": "center", padding: 8 }}>
                  <Text size="sm" c="dimmed">
                    No sessions yet
                  </Text>
                </Box>
              }
            >
              <Stack gap={0.5} align="stretch">
                <For each={state().sessions}>{(session) => {
                  const active = () => session.session === state().activeSession;
                  return (
                    <Box
                      data-testid={`experiments-session-${session.session}`}
                      onClick={() => void selectSession(session.session)}
                      className={active() ? "bg-fin-primary/15" : "hover:bg-fin-surface-alt"}
                      style={{
                        cursor: "pointer",
                        "border-radius": 8,
                        ...(active() ? { "background-color": "rgba(88, 166, 255, 0.15)" } : {}),
                        "padding-left": 8,
                        "padding-right": 8,
                        "padding-top": 6,
                        "padding-bottom": 6,
                        display: "flex",
                        "flex-direction": "column",
                        gap: 4,
                        "align-items": "stretch",
                        "text-align": "left",
                      }}
                    >
                      <Text size="sm" fw={500} truncate>
                        {session.session}
                      </Text>
                      <Box className="flex items-center gap-2 flex-wrap" style={{ display: "flex", "align-items": "center", gap: 8, "flex-wrap": "wrap" }}>
                        <Badge size="xs" variant="light" color="primary">
                          {session.strategy}
                        </Badge>
                        <Text size="xs" c="dimmed">
                          {session.tf}m
                        </Text>
                        <Text size="xs" c="dimmed">
                          {session.runs} runs
                        </Text>
                        <Badge
                          size="xs"
                          variant="light"
                          color={sessionStatusColor(session.status)}
                        >
                          {session.status}
                        </Badge>
                      </Box>
                    </Box>
                  );
                }}</For>
              </Stack>
            </Show>
          </Box>
        </Box>

        <Box style={paneSx}>
          <Box style={paneHeaderSx}>
            <Text fw={600} size="sm">
              Results
            </Text>
          </Box>
          <Box flex={1} className="min-h-0 overflow-auto p-1 flex flex-col gap-1" style={{ flex: 1, "min-height": 0, overflow: "auto", padding: 4, display: "flex", "flex-direction": "column", gap: 4 }}>
            <ExperimentsProgress />
            <ExperimentsResultsTable />
          </Box>
        </Box>

        <Box style={paneSx} data-testid="experiments-chart-panel">
          <ExperimentsChart />
        </Box>
      </Box>
    </Box>
  );
}
