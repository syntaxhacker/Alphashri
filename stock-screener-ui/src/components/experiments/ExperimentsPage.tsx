import { useEffect } from "react";
import { Alert, Badge, Box, Flex, Group, Paper, Stack, Text } from "@/ui";
import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import CardContent from "@mui/material/CardContent";
import TableContainer from "@mui/material/TableContainer";
import Card from "@mui/material/Card";
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
    <Container
      maxWidth="xl"
      data-testid="experiments-page"
      sx={{ py: 1, display: "flex", flexDirection: "column", gap: 1, minHeight: 0, overflow: "auto", height: "100%", alignItems: "center" }}
    >
      {state.error && (
        <Alert
          data-testid="experiments-error"
          icon={<IconAlertCircle size={16} />}
          title="Error"
          color="red"
          variant="filled"
          withCloseButton
          sx={{ mb: 1, width: "100%" }}
        >
          {state.error}
        </Alert>
      )}

      <Box
        sx={{ flex: "0 0 auto", maxHeight: "45vh", overflow: "auto", p: 1, width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}
        data-testid="experiments-config-scroll"
      >
        <ExperimentsConfig />
      </Box>

      <Grid container spacing={1} sx={{ flex: 1, minHeight: 0, justifyContent: "center", alignItems: "stretch", p: 1 }}>
        <Grid size={{ xs: 12, md: 3 }} sx={{ display: "flex", justifyContent: "center" }}>
          <Card elevation={0} sx={{ height: "100%", overflow: "auto", width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }} data-testid="experiments-session-list">
            <CardContent sx={{ p: 1, width: "100%", "&:last-child": { pb: 1 }, display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1, width: "100%" }}>
                <Text fw={600} size="sm">
                  Sessions
                </Text>
              </Box>
              <TableContainer sx={{ width: "100%", p: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                {state.sessions.length === 0 ? (
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
                    <Text size="sm" c="dimmed">
                      No sessions yet
                    </Text>
                  </Box>
                ) : (
                  <Stack gap={1} sx={{ width: "100%", alignItems: "stretch" }}>
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
                            p: 1,
                            display: "flex",
                            flexDirection: "column",
                            gap: 1,
                            alignItems: "center",
                          }}
                        >
                          <Text size="sm" fw={500} truncate>
                            {session.session}
                          </Text>
                          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, flexWrap: "wrap" }}>
                            <Badge size="xs" variant="light" color="blue">
                              {session.strategy}
                            </Badge>
                            <Text size="xs" c="dimmed">
                              {session.tf}m
                            </Text>
                            <Text size="xs" c="dimmed">
                              {session.runs} runs
                            </Text>
                          </Box>
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
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }} sx={{ display: "flex", justifyContent: "center" }}>
          <Card elevation={0} sx={{ height: "100%", overflow: "auto", width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <CardContent sx={{ p: 1, width: "100%", "&:last-child": { pb: 1 }, display: "flex", flexDirection: "column", gap: 1, alignItems: "center" }}>
              <TableContainer sx={{ width: "100%", p: 1, display: "flex", flexDirection: "column", gap: 1, alignItems: "center" }}>
                <ExperimentsProgress />
                <ExperimentsResultsTable />
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }} sx={{ display: "flex", justifyContent: "center" }}>
          <Card elevation={0} sx={{ height: "100%", minHeight: 0, width: "100%" }} data-testid="experiments-chart-panel">
            <CardContent sx={{ height: "100%", display: "flex", flexDirection: "column", p: 1, gap: 1, alignItems: "center" }}>
              <ExperimentsChart />
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
