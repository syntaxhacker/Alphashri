import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Alert, Badge, Box, Flex, Group, Paper, Stack, Text } from "@/ui";
import { IconAlertCircle } from "@tabler/icons-react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  fetchSessions,
  getExperimentState,
  selectSession,
  startPolling,
  stopPolling,
  subscribe,
} from "../../state/experiments";
import { ExperimentsResultsTable } from "./ExperimentsResultsTable";
import { ExperimentsChart } from "./ExperimentsChart";

const ExperimentsConfigLoaders = import.meta.glob<{
  default: ComponentType<Record<string, unknown>>;
}>("./ExperimentsConfig.tsx");

const ExperimentsProgressLoaders = import.meta.glob<{
  default: ComponentType<Record<string, unknown>>;
}>("./ExperimentsProgress.tsx");

function GuardedLazy({
  loaders,
  fallback = null,
}: {
  loaders: Record<
    string,
    () => Promise<{ default: ComponentType<Record<string, unknown>> }>
  >;
  fallback?: ReactNode;
}) {
  const [Comp, setComp] = useState<ComponentType<
    Record<string, unknown>
  > | null>(null);

  useEffect(() => {
    const key = Object.keys(loaders)[0];
    if (!key) {
      setComp(null);
      return;
    }
    let cancelled = false;
    loaders[key]()
      .then((mod) => {
        if (!cancelled) setComp(() => mod.default);
      })
      .catch(() => {
        if (!cancelled) setComp(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loaders]);

  if (!Comp) return fallback;
  return <Comp />;
}

function sessionStatusColor(status: string): string {
  switch (status) {
    case "running":
      return "blue";
    case "completed":
      return "green";
    case "error":
      return "red";
    default:
      return "gray";
  }
}

export function ExperimentsPage() {
  useStoreSubscription(subscribe);
  const state = getExperimentState();

  useEffect(() => {
    void fetchSessions();
  }, []);

  useEffect(() => {
    if (state.activeSession) {
      startPolling(state.activeSession);
    }
    return () => stopPolling();
  }, [state.activeSession]);

  return (
    <Box
      data-testid="experiments-page"
      h="100%"
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "var(--mantine-spacing-md)",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {state.error && (
        <Alert
          data-testid="experiments-error"
          icon={<IconAlertCircle size={16} />}
          title="Error"
          color="red"
          variant="filled"
          withCloseButton
          style={{ marginBottom: "var(--mantine-spacing-md)" }}
        >
          {state.error}
        </Alert>
      )}

      <Box flex="0 0 auto" mb="md">
        <GuardedLazy loaders={ExperimentsConfigLoaders} />
      </Box>

      <Flex flex={1} gap="md" style={{ minHeight: 0 }}>
        <Box
          data-testid="experiments-session-list"
          style={{ flex: "0 0 260px", minHeight: 0, overflow: "auto" }}
        >
          <Paper withBorder p="sm" radius="sm">
            <Text
              fw={600}
              size="sm"
              style={{ marginBottom: "var(--mantine-spacing-xs)" }}
            >
              Sessions
            </Text>
            {state.sessions.length === 0 ? (
              <Text size="sm" c="dimmed">
                No sessions yet
              </Text>
            ) : (
              <Stack gap="xs">
                {state.sessions.map((session) => {
                  const active = session.session === state.activeSession;
                  return (
                    <Box
                      key={session.session}
                      data-testid={`experiments-session-${session.session}`}
                      onClick={() => void selectSession(session.session)}
                      p="xs"
                      style={{
                        cursor: "pointer",
                        borderRadius: "var(--mantine-radius-sm)",
                        backgroundColor: active
                          ? "var(--mantine-color-blue-light)"
                          : undefined,
                      }}
                    >
                      <Text size="sm" fw={500} truncate>
                        {session.session}
                      </Text>
                      <Group gap="xs" mt={2}>
                        <Badge size="xs" variant="light" color="blue">
                          {session.strategy}
                        </Badge>
                        <Text size="xs" c="dimmed">
                          {session.tf}m
                        </Text>
                        <Text size="xs" c="dimmed">
                          {session.runs} runs
                        </Text>
                      </Group>
                      <Badge
                        size="xs"
                        variant="light"
                        color={sessionStatusColor(session.status)}
                      >
                        {session.status}
                      </Badge>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Paper>
        </Box>

        <Box style={{ flex: "1 1 55%", minHeight: 0, overflow: "auto" }}>
          <GuardedLazy loaders={ExperimentsProgressLoaders} />
          <ExperimentsResultsTable />
        </Box>

        <Box
          style={{ flex: "1 1 40%", minHeight: 0 }}
          data-testid="experiments-chart-panel"
        >
          <ExperimentsChart />
        </Box>
      </Flex>
    </Box>
  );
}
