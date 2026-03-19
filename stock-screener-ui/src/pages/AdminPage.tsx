import { useState, useEffect, useCallback } from "react";
import {
  Text,
  Table,
  Badge,
  Group,
  Stack,
  Loader,
  Box,
  ActionIcon,
  ScrollArea,
} from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { useAuth } from "../components/auth/AuthProvider";
import {
  CompactPage,
  CompactPanel,
  CompactStat,
  CompactStatGrid,
} from "../components/common/compact";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

interface LLMRun {
  id: number;
  url: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  response_time_ms: number;
  status: string;
  created_at: string;
}

interface ModelUsage {
  model: string;
  count: number;
}

interface Aggregate {
  total_runs: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_response_time_ms: number;
  models_used: ModelUsage[];
}

interface LLMStats {
  recent_runs: LLMRun[];
  aggregate: Aggregate;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function formatResponseTime(ms: number): string {
  return `${ms.toFixed(0)}ms`;
}

function formatDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString();
  } catch {
    return isoString;
  }
}

function truncateUrl(url: string, maxLength: number = 50): string {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength) + "...";
}

function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "success":
      return "green";
    case "error":
      return "red";
    case "pending":
      return "yellow";
    default:
      return "gray";
  }
}

export default function AdminPage() {
  const { fetchWithAuth } = useAuth();
  const [stats, setStats] = useState<LLMStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithAuth(`${API_BASE}/api/admin/llm-stats`);
      if (!response.ok) {
        throw new Error(`Failed to fetch stats: ${response.status}`);
      }
      const data = await response.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading && !stats) {
    return (
      <Box data-testid="admin-page" style={{ height: "100%", overflow: "hidden" }}>
        <CompactPanel
          padded
          title={
            <Group gap="xs" wrap="nowrap">
              <Loader size="sm" />
              <Text fw={600} size="sm">
                Loading LLM stats
              </Text>
            </Group>
          }
          description="Fetching the latest admin telemetry."
        />
      </Box>
    );
  }

  if (error && !stats) {
    return (
      <Box data-testid="admin-page" style={{ height: "100%", overflow: "hidden" }}>
        <CompactPanel
          title="Unable to load stats"
          description={error}
          style={{ color: "var(--mantine-color-red-6)" }}
        />
      </Box>
    );
  }

  const { recent_runs, aggregate } = stats || {
    recent_runs: [],
    aggregate: {
      total_runs: 0,
      total_tokens: 0,
      total_cost_usd: 0,
      avg_response_time_ms: 0,
      models_used: [],
    },
  };

  return (
    <Box data-testid="admin-page" style={{ height: "100%", overflow: "hidden" }}>
      <CompactPage
        title="LLM Admin Dashboard"
        description="Recent model usage, response time, and cost telemetry."
        actions={
          <ActionIcon
            variant="light"
            onClick={fetchStats}
            loading={loading}
            data-testid="refresh-btn"
          >
            <IconRefresh size={18} />
          </ActionIcon>
        }
      >
        <Stack gap="sm" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <CompactStatGrid>
            <CompactStat label="Total Runs" value={aggregate.total_runs} />
            <CompactStat label="Total Tokens" value={aggregate.total_tokens.toLocaleString()} />
            <CompactStat label="Total Cost" value={formatCost(aggregate.total_cost_usd)} />
            <CompactStat
              label="Avg Response Time"
              value={formatResponseTime(aggregate.avg_response_time_ms)}
            />
          </CompactStatGrid>

          {error && (
            <Text c="orange" size="sm">
              Warning: {error}
            </Text>
          )}

          {aggregate.models_used && aggregate.models_used.length > 0 && (
            <CompactPanel title="Model Breakdown">
              <Group gap="sm">
                {aggregate.models_used.map((m, idx) => (
                  <Badge key={idx} variant="light" size="lg">
                    {m.model}: {m.count} runs
                  </Badge>
                ))}
              </Group>
            </CompactPanel>
          )}

          <CompactPanel
            title="Recent Runs"
            style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
          >
            <ScrollArea flex={1}>
              {recent_runs.length === 0 ? (
                <Text c="dimmed" ta="center" py="sm">
                  No recent runs
                </Text>
              ) : (
                <Table striped highlightOnHover data-testid="runs-table">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>URL</Table.Th>
                      <Table.Th>Model</Table.Th>
                      <Table.Th>Tokens</Table.Th>
                      <Table.Th>Cost</Table.Th>
                      <Table.Th>Response Time</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Created At</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {recent_runs.map((run) => (
                      <Table.Tr key={run.id}>
                        <Table.Td>
                          <Text size="sm" title={run.url}>
                            {truncateUrl(run.url)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{run.model}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">
                            {(run.input_tokens + run.output_tokens).toLocaleString()}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{formatCost(run.cost_usd)}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{formatResponseTime(run.response_time_ms)}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge color={getStatusColor(run.status)} variant="light" size="sm">
                            {run.status}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{formatDateTime(run.created_at)}</Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </ScrollArea>
          </CompactPanel>
        </Stack>
      </CompactPage>
    </Box>
  );
}
