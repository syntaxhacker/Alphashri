import { createSignal, createMemo, onMount, Show, For } from "solid-js";
import { Alert, Badge, Button, Group, Loader, Paper, Stack, Text, ToolbarRow } from "@/ui";
import { Icon } from "../../components/common/Icons";
import { useAuth } from "../../components/auth/AuthProvider2";
import { CompactPanel, CompactStat, CompactStatGrid } from "../../components/common/compact";
import { TanStackTable } from "../../components/common/TanStackTable";
import type { TableColumnDef } from "../../components/common/TanStackTable";
import type { LLMStats, LLMRun, ModelUsage } from "../../types/admin";
import { formatCost, formatResponseTime, formatDateTime, truncateUrl } from "./formatters";
import { getStatusColor } from "../../utils/ui-helpers";

import { API_BASE } from "@/api/config";

const MONO = "font-mono tabular-nums";

function ModelBadges(props: { models: ModelUsage[] }) {
  return (
    <Show when={props.models && props.models.length > 0}>
      <Group gap="xs" wrap="wrap">
        <For each={props.models ?? []}>
          {(m) => (
            <Badge variant="light" size="lg">
              {m.model.split("/").pop()}: {m.count}
            </Badge>
          )}
        </For>
      </Group>
    </Show>
  );
}

const RUN_COLUMNS: TableColumnDef<LLMRun>[] = [
  {
    id: "url",
    header: "URL",
    accessorKey: "url",
    meta: { align: "left" },
    cell: ({ row }) => (
      <Text size="sm" title={row.original.url}>
        {truncateUrl(row.original.url)}
      </Text>
    ),
  },
  {
    id: "model",
    header: "Model",
    accessorKey: "model",
    meta: { align: "left" },
    cell: ({ row }) => <Text size="sm">{row.original.model.split("/").pop()}</Text>,
  },
  {
    id: "tokens",
    header: "Tokens",
    accessorFn: (row) => row.input_tokens + row.output_tokens,
    meta: { align: "right" },
    cell: ({ row }) => (
      <Text size="sm" class={MONO}>
        {(row.original.input_tokens + row.original.output_tokens).toLocaleString()}
      </Text>
    ),
  },
  {
    id: "cost",
    header: "Cost",
    accessorKey: "cost_usd",
    meta: { align: "right" },
    cell: ({ row }) => (
      <Text size="sm" class={MONO}>
        {formatCost(row.original.cost_usd)}
      </Text>
    ),
  },
  {
    id: "response_time",
    header: "Response time",
    accessorKey: "response_time_ms",
    meta: { align: "right" },
    cell: ({ row }) => (
      <Text size="sm" class={MONO}>
        {formatResponseTime(row.original.response_time_ms)}
      </Text>
    ),
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    meta: { align: "center" },
    cell: ({ row }) => (
      <Badge color={getStatusColor(row.original.status)} variant="filled" size="sm">
        {row.original.status}
      </Badge>
    ),
  },
  {
    id: "created",
    header: "Created",
    accessorKey: "created_at",
    meta: { align: "left" },
    cell: ({ row }) => (
      <Text size="sm" class={MONO}>
        {formatDateTime(row.original.created_at)}
      </Text>
    ),
  },
];

export function LLMStatsPanel() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = createSignal<LLMStats | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [clearing, setClearing] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let loaded = false;

  const fetchStats = async () => {
    if (!loaded) setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/llm-stats`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d);
      loaded = true;
      if (d.error) setError(d.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

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

  onMount(() => {
    fetchStats();
  });

  const vm = createMemo(() => {
    const d = data();
    const agg = d?.aggregate;
    const runs = d?.recent_runs ?? [];
    const models = agg?.models_used ?? [];
    return { agg, runs, models };
  });

  return (
    <Show
      when={!loading() || data()}
      fallback={
        <Paper p="sm" radius="sm" data-testid="admin-llm-loading">
          <Group gap="sm" justify="center" py="sm">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">Loading LLM stats…</Text>
          </Group>
        </Paper>
      }
    >
      <Stack gap="sm" data-testid="admin-llm-panel">
        <Show when={error()}>
          <Alert color="error" data-testid="admin-llm-error">{error()}</Alert>
        </Show>

        <CompactStatGrid>
          <CompactStat label="Total runs" value={vm().agg?.total_runs ?? "—"} />
          <CompactStat
            label="Total tokens"
            value={vm().agg?.total_tokens != null ? vm().agg!.total_tokens!.toLocaleString() : "—"}
          />
          <CompactStat label="Total cost" value={formatCost(vm().agg?.total_cost_usd ?? 0)} />
          <CompactStat label="Avg response" value={formatResponseTime(vm().agg?.avg_response_time_ms ?? 0)} />
        </CompactStatGrid>

        <Show when={vm().models.length > 0}>
          <CompactPanel title="Models used">
            <ModelBadges models={vm().models} />
          </CompactPanel>
        </Show>

        <CompactPanel
          title="Recent Runs"
          description={vm().runs.length ? `${vm().runs.length} logged runs` : "No recent runs"}
          action={
            <ToolbarRow gap={8}>
              <Button size="xs" variant="light" leftSection={<Icon name="refresh" size={12} />} onClick={fetchStats} loading={loading()}>
                Refresh
              </Button>
              <Button size="xs" variant="filled" color="error" leftSection={<Icon name="trash" size={12} />} onClick={clearLogs} loading={clearing()}>
                Clear logs
              </Button>
            </ToolbarRow>
          }
          scrollable
        >
          <TanStackTable<LLMRun>
            data={vm().runs}
            columns={RUN_COLUMNS}
            dataTestId="runs-table"
            enableSorting={false}
            emptyMessage="No recent runs"
            bare
          />
        </CompactPanel>

      </Stack>
    </Show>
  );
}
