import { createSignal, createMemo, onMount, Show, For } from "solid-js";
import { Alert, Badge, Box, Button, Loader, Stack, Text, ToolbarRow } from "@/ui";
import { Icon } from "../../components/common/Icons";
import { useAuth } from "../../components/auth/AuthProvider2";
import { CompactPanel, CompactStat, CompactStatGrid } from "../../components/common/compact";
import { TanStackTable } from "../../components/common/TanStackTable";
import type { TableColumnDef } from "../../components/common/TanStackTable";
import type { LLMStats, LLMRun, ModelUsage } from "../../types/admin";
import { formatCost, formatResponseTime, formatDateTime, truncateUrl } from "./formatters";
import { getStatusColor } from "../../utils/ui-helpers";

import { API_BASE } from "@/api/config";

const MONO = "font-mono tabular-nums text-[11px]";

function ModelBadges(props: { models: ModelUsage[] }) {
  return (
    <Show when={props.models && props.models.length > 0}>
      <ToolbarRow gap={4} data-testid="admin-llm-models">
        <For each={props.models ?? []}>
          {(m) => (
            <Badge variant="light" size="xs">
              {m.model.split("/").pop()}: {m.count}
            </Badge>
          )}
        </For>
      </ToolbarRow>
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
      <Text size="xs" title={row.original.url} class={MONO}>
        {truncateUrl(row.original.url)}
      </Text>
    ),
  },
  {
    id: "model",
    header: "Model",
    accessorKey: "model",
    meta: { align: "left" },
    cell: ({ row }) => <Text size="xs" class={MONO}>{row.original.model.split("/").pop()}</Text>,
  },
  {
    id: "tokens",
    header: "Tokens",
    accessorFn: (row) => row.input_tokens + row.output_tokens,
    meta: { align: "right" },
    cell: ({ row }) => (
      <Text size="xs" class={MONO}>
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
      <Text size="xs" class={MONO}>
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
      <Text size="xs" class={MONO}>
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
      <Badge color={getStatusColor(row.original.status)} variant="filled" size="xs">
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
      <Text size="xs" class={MONO}>
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
        <Box data-testid="admin-llm-loading" className="flex items-center gap-1 p-1">
          <Loader size="xs" />
          <Text size="xs" c="dimmed">Loading LLM stats…</Text>
        </Box>
      }
    >
      <Stack gap={4} className="h-full min-h-0" data-testid="admin-llm-panel">
        <Show when={error()}>
          <Alert color="error" data-testid="admin-llm-error">{error()}</Alert>
        </Show>

        <Box className="shrink-0">
          <CompactStatGrid cols={4} spacing={4}>
            <CompactStat dense label="Total runs" value={vm().agg?.total_runs ?? "—"} />
            <CompactStat
              dense
              label="Total tokens"
              value={vm().agg?.total_tokens != null ? vm().agg!.total_tokens!.toLocaleString() : "—"}
            />
            <CompactStat dense label="Total cost" value={formatCost(vm().agg?.total_cost_usd ?? 0)} />
            <CompactStat dense label="Avg response" value={formatResponseTime(vm().agg?.avg_response_time_ms ?? 0)} />
          </CompactStatGrid>
        </Box>

        <Show when={vm().models.length > 0}>
          <Box className="shrink-0">
            <CompactPanel title="Models used" flush>
              <Box className="px-1 py-[2px]">
                <ModelBadges models={vm().models} />
              </Box>
            </CompactPanel>
          </Box>
        </Show>

        <Box className="flex min-h-0 flex-1 flex-col">
          <CompactPanel
            title="Recent Runs"
            description={vm().runs.length ? `${vm().runs.length} logged runs` : "No recent runs"}
            action={
              <ToolbarRow gap={4}>
                <Button size="xs" variant="light" leftSection={<Icon name="refresh" size={12} />} onClick={fetchStats} loading={loading()}>
                  Refresh
                </Button>
                <Button size="xs" variant="filled" color="error" leftSection={<Icon name="trash" size={12} />} onClick={clearLogs} loading={clearing()}>
                  Clear logs
                </Button>
              </ToolbarRow>
            }
            scrollable
            flush
            style={{ flex: 1, "min-height": "0px" }}
          >
            {/* CompactPanel's scroll body is a block box, so the fill-height
                chain has to be restarted here for `fillContainer` to bind. */}
            <Box className="flex min-h-0 flex-col" style={{ height: "100%" }}>
            <TanStackTable<LLMRun>
              data={vm().runs}
              columns={RUN_COLUMNS}
              dataTestId="runs-table"
              enableSorting={false}
              emptyMessage="No recent runs"
              dense
              fillContainer
              rowWindowSize={40}
            />
            </Box>
          </CompactPanel>
        </Box>
      </Stack>
    </Show>
  );
}
