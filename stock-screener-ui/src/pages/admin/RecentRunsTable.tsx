import { createMemo, For, Show } from "solid-js";
import { Text, Badge, Group } from "@/ui";
import type { TableColumnDef } from "../../components/common/TanStackTable";
import type { LLMRun, ModelUsage } from "../../types/admin";
import { getStatusColor } from "../../utils/ui-helpers";
import { CompactPanel } from "../../components/common/compact";
import { TanStackTable } from "../../components/common/TanStackTable";
import { formatCost, formatResponseTime, formatDateTime, truncateUrl } from "./formatters";

export { formatCost, formatResponseTime, formatDateTime, truncateUrl } from "./formatters";
export { getStatusColor } from "../../utils/ui-helpers";

const MONO = "font-mono tabular-nums";

export function ModelBreakdown(props: { models: ModelUsage[] }) {
  return (
    <Show when={props.models && props.models.length > 0}>
      <CompactPanel title="Model Breakdown">
        <Group gap="sm">
          <For each={props.models ?? []}>
            {(m) => (
              <Badge variant="light" size="lg">
                {m.model}: {m.count} runs
              </Badge>
            )}
          </For>
        </Group>
      </CompactPanel>
    </Show>
  );
}

export function RecentRunsTable(props: { runs: LLMRun[] }) {
  const columns = createMemo<TableColumnDef<LLMRun>[]>(() => [
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
      cell: ({ row }) => <Text size="sm">{row.original.model}</Text>,
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
      header: "Response Time",
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
      id: "created_at",
      header: "Created At",
      accessorKey: "created_at",
      meta: { align: "left" },
      cell: ({ row }) => (
        <Text size="sm" class={MONO}>
          {formatDateTime(row.original.created_at)}
        </Text>
      ),
    },
  ]);

  return (
    <TanStackTable<LLMRun>
      data={props.runs}
      columns={columns()}
      dataTestId="runs-table"
      enableSorting={false}
      emptyMessage="No recent runs"
    />
  );
}
