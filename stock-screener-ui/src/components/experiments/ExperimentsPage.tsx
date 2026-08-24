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
      sx={{ py: 2, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto", height: "100%" }}
    >
      {state.error && (
        <Alert
          data-testid="experiments-error"
          icon={<IconAlertCircle size={16} />}
          title="Error"
          color="red"
          variant="filled"
          withCloseButton
          style={{ marginBottom: "16px" }}
        >
          {state.error}
        </Alert>
      )}

      <Box
        flex="0 0 auto"
        mb="md"
        style={{ maxHeight: "45vh", overflow: "auto" }}
        data-testid="experiments-config-scroll"
      >
        <ExperimentsConfig />
      </Box>

      <Grid container spacing={2} sx={{ flex: 1, minHeight: 0 }}>
        <Grid size={{ xs: 12, md: 3 }}>
          <Card elevation={1} sx={{ height: "100%", overflow: "auto" }} data-testid="experiments-session-list">
            <CardContent>
              <Text
                fw={600}
                size="sm"
                style={{ marginBottom: "8px" }}
              >
                Sessions
              </Text>
              <TableContainer>
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
                          sx={{
                            cursor: "pointer",
                            borderRadius: 1,
                            bgcolor: active ? "primary.light" : undefined,
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
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Card elevation={1} sx={{ height: "100%", overflow: "auto" }}>
            <CardContent>
              <TableContainer>
                <ExperimentsProgress />
                <ExperimentsResultsTable />
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Card elevation={1} sx={{ height: "100%", minHeight: 0 }} data-testid="experiments-chart-panel">
            <CardContent sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
              <ExperimentsChart />
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
