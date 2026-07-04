import { useCallback, useEffect, useRef, useState } from "react";
import { Text, Group, Stack, Loader, Paper, Badge, Button, ScrollArea, Table, Alert, Box } from "@mantine/core";
import { IconRefresh, IconTrash } from "@tabler/icons-react";
import { useAuth } from "../../components/auth/AuthProvider2";
import type { LLMStats, LLMRun, ModelUsage } from "../../types/admin";
import { CompactPanel } from "../../components/common/compact";
import { DataTable } from "../../components/common/DataTable";
import { getStatusColor } from "../../utils/ui-helpers";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function formatResponseTime(ms: number): string {
  return `${ms.toFixed(0)}ms`;
}

function formatDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function truncateUrl(url: string, maxLength = 50): string {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength) + "...";
}

function ModelBadges({ models }: { models: ModelUsage[] }) {
  if (!models || models.length === 0) return null;
  return (
    <Group gap="xs">
      {models.map((m, idx) => (
        <Badge key={idx} variant="light" size="lg" title={`${m.model}: ${m.count} runs`}>
          {m.model.split("/").pop()}: {m.count}
        </Badge>
      ))}
    </Group>
  );
}

function RunsTable({ runs }: { runs: LLMRun[] }) {
  if (runs.length === 0) {
    return <Text c="dimmed" ta="center" py="sm">No recent runs</Text>;
  }
  return (
    <Box style={{ overflowX: "auto" }}>
      <DataTable dataTestId="runs-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>URL</Table.Th>
            <Table.Th>Model</Table.Th>
            <Table.Th>Tokens</Table.Th>
            <Table.Th>Cost</Table.Th>
            <Table.Th>Time</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Created</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {runs.map((run) => (
            <Table.Tr key={run.id}>
              <Table.Td><Text size="sm" title={run.url}>{truncateUrl(run.url)}</Text></Table.Td>
              <Table.Td><Text size="sm">{run.model.split("/").pop()}</Text></Table.Td>
              <Table.Td><Text size="sm">{(run.input_tokens + run.output_tokens).toLocaleString()}</Text></Table.Td>
              <Table.Td><Text size="sm">{formatCost(run.cost_usd)}</Text></Table.Td>
              <Table.Td><Text size="sm">{formatResponseTime(run.response_time_ms)}</Text></Table.Td>
              <Table.Td><Badge color={getStatusColor(run.status)} variant="light" size="sm">{run.status}</Badge></Table.Td>
              <Table.Td><Text size="sm">{formatDateTime(run.created_at)}</Text></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </DataTable>
    </Box>
  );
}

export function LLMStatsPanel() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<LLMStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const fetchStats = useCallback(async () => {
    if (!loadedRef.current) setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/llm-stats`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d);
      loadedRef.current = true;
      if (d.error) setError(d.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  const clearLogs = async () => {
    if (!window.confirm("Clear all LLM stats logs? Article analysis cache is not affected.")) return;
    setClearing(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/llm-stats/reset`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear");
    } finally {
      setClearing(false);
    }
  };

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const agg = data?.aggregate;

  return (
    <Stack gap="sm" data-testid="admin-llm-panel">
      {/* stats row */}
      <Paper withBorder p="sm" radius="sm">
        {loading && !data ? (
          <Group gap="sm" justify="center" py="sm">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">Loading LLM stats...</Text>
          </Group>
        ) : (
          <Group gap="xl" wrap="wrap" justify="center">
            <Stack gap={0} align="center">
              <Text fw={700} size="xl">{agg?.total_runs ?? "—"}</Text>
              <Text size="xs" c="dimmed">Total Runs</Text>
            </Stack>
            <Stack gap={0} align="center">
              <Text fw={700} size="xl">{agg?.total_tokens?.toLocaleString() ?? "—"}</Text>
              <Text size="xs" c="dimmed">Total Tokens</Text>
            </Stack>
            <Stack gap={0} align="center">
              <Text fw={700} size="xl">{formatCost(agg?.total_cost_usd ?? 0)}</Text>
              <Text size="xs" c="dimmed">Total Cost</Text>
            </Stack>
            <Stack gap={0} align="center">
              <Text fw={700} size="xl">{formatResponseTime(agg?.avg_response_time_ms ?? 0)}</Text>
              <Text size="xs" c="dimmed">Avg Response</Text>
            </Stack>
          </Group>
        )}
      </Paper>

      {/* model breakdown */}
      {agg?.models_used && agg.models_used.length > 0 && (
        <CompactPanel padded>
          <ModelBadges models={agg.models_used} />
        </CompactPanel>
      )}

      {/* error */}
      {error && <Alert color="red" variant="light">{error}</Alert>}

      {/* actions + recent runs */}
      <Group justify="space-between">
        <Text size="sm" fw={500}>Recent Runs</Text>
        <Group gap="xs">
          <Button size="compact-xs" variant="light" leftSection={<IconRefresh size={12} />} onClick={fetchStats} loading={loading}>Refresh</Button>
          <Button size="compact-xs" variant="light" color="red" leftSection={<IconTrash size={12} />} onClick={clearLogs} loading={clearing}>Clear logs</Button>
        </Group>
      </Group>

      {/* table */}
      {loading && !data ? (
        <Group gap="xs"><Loader size="sm" /><Text size="sm">Loading...</Text></Group>
      ) : (
        <CompactPanel flex={1} style={{ minHeight: 0 }}>
          <ScrollArea flex={1}>
            <RunsTable runs={data?.recent_runs ?? []} />
          </ScrollArea>
        </CompactPanel>
      )}
    </Stack>
  );
}
