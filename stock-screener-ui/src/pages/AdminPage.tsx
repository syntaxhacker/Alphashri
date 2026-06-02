import { useState, useEffect, useCallback } from "react";
import {
  Text,
  Group,
  Stack,
  Loader,
  Box,
  ActionIcon,
  ScrollArea,
  Tabs,
} from "@mantine/core";
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
import { Admin52wRangePanel } from "./admin/Admin52wRangePanel";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

function LoadingState() {
  return (
    <Box data-testid="admin-page" h="100%" style={{ overflow: "hidden" }}>
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
    <Box data-testid="admin-page" h="100%" style={{ overflow: "hidden" }}>
      <CompactPanel title="Unable to load stats" description={error} c="red.6" />
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
    <Box data-testid="admin-page" h="100%" style={{ overflow: "hidden" }}>
      <CompactPage
        title="Admin"
        description="LLM telemetry and 52-week range batch jobs."
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
        <Tabs defaultValue="llm" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Tabs.List>
            <Tabs.Tab value="llm">LLM stats</Tabs.Tab>
            <Tabs.Tab value="52w" data-testid="admin-tab-52w">
              52W range batch
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="llm" pt="sm" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <Stack gap="sm" h="100%" style={{ minHeight: 0 }}>
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
              <CompactPanel title="Recent Runs" flex={1} style={{ minHeight: 0 }}>
                <ScrollArea flex={1}>
                  <RecentRunsTable runs={recent_runs} />
                </ScrollArea>
              </CompactPanel>
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="52w" pt="sm">
            <Admin52wRangePanel />
          </Tabs.Panel>
        </Tabs>
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
      if (data.error) {
        setError(data.error);
      }
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
