import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Group, Loader, Paper, Stack, Text, ToolbarRow } from "@/ui";
import { IconRefresh, IconTrash } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useAuth } from "../../components/auth/AuthProvider2";
import { CompactPanel, CompactStat, CompactStatGrid } from "../../components/common/compact";
import { TanStackTable } from "../../components/common/TanStackTable";
import type { LLMStats, LLMRun, ModelUsage } from "../../types/admin";
import { formatCost, formatResponseTime, formatDateTime, truncateUrl } from "./formatters";
import { getStatusColor } from "../../utils/ui-helpers";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

function ModelBadges({ models }: { models: ModelUsage[] }) {
  if (!models || models.length === 0) return null;
  return (
    <Group gap="xs" wrap="wrap">
      {models.map((m) => (
        <Badge key={m.model} variant="light" size="lg">
          {m.model.split("/").pop()}: {m.count}
        </Badge>
      ))}
    </Group>
  );
}

const RUN_COLUMNS: ColumnDef<LLMRun>[] = [
  {
    id: "url",
    header: "URL",
    accessorKey: "url",
    meta: { align: "left" },
    cell: (info) => (
      <Text size="sm" title={info.getValue<string>()}>
        {truncateUrl(info.getValue<string>())}
      </Text>
    ),
  },
  {
    id: "model",
    header: "Model",
    accessorKey: "model",
    meta: { align: "left" },
    cell: (info) => <Text size="sm">{info.getValue<string>().split("/").pop()}</Text>,
  },
  {
    id: "tokens",
    header: "Tokens",
    accessorFn: (row) => (row.input_tokens + row.output_tokens).toLocaleString(),
    meta: { align: "right" },
    cell: (info) => <Text size="sm">{info.getValue<string>()}</Text>,
  },
  {
    id: "cost",
    header: "Cost",
    accessorKey: "cost_usd",
    meta: { align: "right" },
    cell: (info) => <Text size="sm">{formatCost(info.getValue<number>())}</Text>,
  },
  {
    id: "response_time",
    header: "Response time",
    accessorKey: "response_time_ms",
    meta: { align: "right" },
    cell: (info) => <Text size="sm">{formatResponseTime(info.getValue<number>())}</Text>,
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    meta: { align: "center" },
    cell: (info) => (
      <Badge color={getStatusColor(info.getValue<string>())} variant="filled" size="sm">
        {info.getValue<string>()}
      </Badge>
    ),
  },
  {
    id: "created",
    header: "Created",
    accessorKey: "created_at",
    meta: { align: "left" },
    cell: (info) => <Text size="sm">{formatDateTime(info.getValue<string>())}</Text>,
  },
];

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

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const agg = data?.aggregate;
  const runs = data?.recent_runs ?? [];
  const models = agg?.models_used ?? [];

  if (loading && !data) {
    return (
      <Paper p="sm" radius="sm" data-testid="admin-llm-loading">
        <Group gap="sm" justify="center" py="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Loading LLM stats…</Text>
        </Group>
      </Paper>
    );
  }

  return (
    <Stack gap="sm" data-testid="admin-llm-panel">
      {error && <Alert color="error" data-testid="admin-llm-error">{error}</Alert>}

      <CompactStatGrid>
        <CompactStat label="Total runs" value={agg?.total_runs ?? "—"} />
        <CompactStat
          label="Total tokens"
          value={agg?.total_tokens != null ? agg.total_tokens.toLocaleString() : "—"}
        />
        <CompactStat label="Total cost" value={formatCost(agg?.total_cost_usd ?? 0)} />
        <CompactStat label="Avg response" value={formatResponseTime(agg?.avg_response_time_ms ?? 0)} />
      </CompactStatGrid>

      {models.length > 0 && (
        <CompactPanel title="Models used">
          <ModelBadges models={models} />
        </CompactPanel>
      )}

      <CompactPanel
        title="Recent Runs"
        description={runs.length ? `${runs.length} logged runs` : "No recent runs"}
        action={
          <ToolbarRow gap={8}>
            <Button size="xs" variant="light" leftSection={<IconRefresh size={12} />} onClick={fetchStats} loading={loading}>
              Refresh
            </Button>
            <Button size="xs" variant="filled" color="error" leftSection={<IconTrash size={12} />} onClick={clearLogs} loading={clearing}>
              Clear logs
            </Button>
          </ToolbarRow>
        }
        scrollable
      >
        <TanStackTable<LLMRun>
          data={runs}
          columns={RUN_COLUMNS}
          dataTestId="runs-table"
          enableSorting={false}
          emptyMessage="No recent runs"
          bare
        />
      </CompactPanel>

    </Stack>
  );
}
