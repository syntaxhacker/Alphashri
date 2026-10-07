import { useEffect } from "react";
import Typography from "@mui/material/Typography";
import { Alert, Badge, Box, Stack, Text, ToolbarRow } from "@/ui";
import { IconAlertCircle } from "@tabler/icons-react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  fetchSessions,
  fetchStrategies,
  getExperimentState,
  selectSession,
  startPolling,
  stopPolling,
  subscribe,
} from "../../state/experiments";
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
  minHeight: 0,
  minWidth: 0,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
  bgcolor: "background.paper",
} as const;

const paneHeaderSx = {
  display: "flex",
  alignItems: "center",
  gap: 1,
  px: 1.5,
  minHeight: 40,
  borderBottom: 1,
  borderColor: "divider",
  flex: "0 0 auto",
} as const;

export function ExperimentsPage() {
  useStoreSubscription(subscribe);
  const state = getExperimentState();

  useEffect(() => {
    void fetchStrategies();
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
      sx={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        p: 1,
        overflow: "hidden",
      }}
    >
      <ToolbarRow
        justify="space-between"
        gap={8}
        style={{ minHeight: 40, flex: "0 0 auto" }}
      >
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, minWidth: 0 }}>
          <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2 }}>
            Experiments
          </Typography>
          <Text size="xs" c="dimmed">
            {state.sessions.length} {state.sessions.length === 1 ? "session" : "sessions"}
          </Text>
        </Box>
        {state.activeSession && (
          <Badge size="xs" variant="light" color="primary">
            {state.activeSession}
          </Badge>
        )}
      </ToolbarRow>

      {state.error && (
        <Alert
          data-testid="experiments-error"
          icon={<IconAlertCircle size={16} />}
          title="Error"
          color="error"
          variant="filled"
          withCloseButton
          sx={{ flex: "0 0 auto" }}
        >
          {state.error}
        </Alert>
      )}

      <Box
        sx={{
          flex: "0 0 auto",
          maxHeight: "36vh",
          overflow: "auto",
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "background.paper",
        }}
        data-testid="experiments-config-scroll"
      >
        <ExperimentsConfig />
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gap: 1,
          overflow: "auto",
          gridTemplateColumns: { xs: "1fr", lg: "280px minmax(0,1fr) minmax(0,1.25fr)" },
        }}
      >
        <Box sx={paneSx} data-testid="experiments-session-list">
          <Box sx={paneHeaderSx}>
            <Text fw={600} size="sm">
              Sessions
            </Text>
            <Box sx={{ flex: 1 }} />
            <Text size="xs" c="dimmed">
              {state.sessions.length}
            </Text>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1 }}>
            {state.sessions.length === 0 ? (
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}>
                <Text size="sm" c="dimmed">
                  No sessions yet
                </Text>
              </Box>
            ) : (
              <Stack gap={1} sx={{ alignItems: "stretch" }}>
                {state.sessions.map((session) => {
                  const active = session.session === state.activeSession;
                  return (
                    <Box
                      key={session.session}
                      data-testid={`experiments-session-${session.session}`}
                      onClick={() => void selectSession(session.session)}
                      sx={{
                        cursor: "pointer",
                        borderRadius: 1,
                        bgcolor: active ? "primary.light" : undefined,
                        "&:hover": { bgcolor: active ? "primary.light" : "action.hover" },
                        px: 1,
                        py: 0.75,
                        display: "flex",
                        flexDirection: "column",
                        gap: 0.5,
                        alignItems: "stretch",
                        textAlign: "left",
                      }}
                    >
                      <Text size="sm" fw={500} truncate>
                        {session.session}
                      </Text>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
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
                })}
              </Stack>
            )}
          </Box>
        </Box>

        <Box sx={paneSx}>
          <Box sx={paneHeaderSx}>
            <Text fw={600} size="sm">
              Results
            </Text>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1, display: "flex", flexDirection: "column", gap: 1 }}>
            <ExperimentsProgress />
            <ExperimentsResultsTable />
          </Box>
        </Box>

        <Box sx={paneSx} data-testid="experiments-chart-panel">
          <ExperimentsChart />
        </Box>
      </Box>
    </Box>
  );
}
