import { useState, useEffect, useCallback } from "react";
import { Text, Group, Stack, Loader, Box, ActionIcon, ScrollArea } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { useAuth } from "../components/auth/AuthProvider2";
import {
  CompactPage,
  CompactPanel,
  CompactStat,
  CompactStatGrid,
} from "../components/common/compact";
import type { LLMStats } from "../types/admin";
import {
  RecentRunsTable,
  ModelBreakdown,
  formatCost,
  formatResponseTime,
} from "./admin/RecentRunsTable";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

function LoadingState() {
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

function ErrorState({ error }: { error: string }) {
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

function AdminContent({
  stats,
  error,
  onRefresh,
  loading,
}: {
  stats: LLMStats;
  error: string | null;
  onRefresh: () => void;
  loading: boolean;
}) {
  const { recent_runs, aggregate } = stats;
  return (
    <Box data-testid="admin-page" style={{ height: "100%", overflow: "hidden" }}>
      <CompactPage
        title="LLM Admin Dashboard"
        description="Recent model usage, response time, and cost telemetry."
        actions={
          <ActionIcon
            variant="light"
            onClick={onRefresh}
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
          <ModelBreakdown models={aggregate.models_used} />
          <CompactPanel
            title="Recent Runs"
            style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
          >
            <ScrollArea flex={1}>
              <RecentRunsTable runs={recent_runs} />
            </ScrollArea>
          </CompactPanel>
        </Stack>
      </CompactPage>
    </Box>
  );
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

  if (loading && !stats) return <LoadingState />;
  if (error && !stats) return <ErrorState error={error} />;

  return <AdminContent stats={stats!} error={error} onRefresh={fetchStats} loading={loading} />;
}
