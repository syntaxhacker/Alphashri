import { useMemo } from "react";
import { Text, Badge, Group } from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import type { LLMRun, ModelUsage } from "../../types/admin";
import { getStatusColor } from "../../utils/ui-helpers";
import { CompactPanel } from "../../components/common/compact";
import { TanStackTable } from "../../components/common/TanStackTable";
import { formatCost, formatResponseTime, formatDateTime, truncateUrl } from "./formatters";

export { formatCost, formatResponseTime, formatDateTime, truncateUrl } from "./formatters";
export { getStatusColor } from "../../utils/ui-helpers";

export function ModelBreakdown({ models }: { models: ModelUsage[] }) {
  if (!models || models.length === 0) return null;
  return (
    <CompactPanel title="Model Breakdown">
      <Group gap="sm">
        {models.map((m, idx) => (
          <Badge key={idx} variant="light" size="lg">
            {m.model}: {m.count} runs
          </Badge>
        ))}
      </Group>
    </CompactPanel>
  );
}

export function RecentRunsTable({ runs }: { runs: LLMRun[] }) {
  const columns = useMemo<ColumnDef<LLMRun>[]>(
    () => [
      {
        id: "url",
        header: "URL",
        accessorKey: "url",
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
        cell: (info) => <Text size="sm">{info.getValue<string>()}</Text>,
      },
      {
        id: "tokens",
        header: "Tokens",
        accessorFn: (row) => (row.input_tokens + row.output_tokens).toLocaleString(),
        cell: (info) => <Text size="sm">{info.getValue<string>()}</Text>,
      },
      {
        id: "cost",
        header: "Cost",
        accessorKey: "cost_usd",
        cell: (info) => <Text size="sm">{formatCost(info.getValue<number>())}</Text>,
      },
      {
        id: "response_time",
        header: "Response Time",
        accessorKey: "response_time_ms",
        cell: (info) => (
          <Text size="sm">{formatResponseTime(info.getValue<number>())}</Text>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: (info) => (
          <Badge color={getStatusColor(info.getValue<string>())} variant="light" size="sm">
            {info.getValue<string>()}
          </Badge>
        ),
      },
      {
        id: "created_at",
        header: "Created At",
        accessorKey: "created_at",
        cell: (info) => (
          <Text size="sm">{formatDateTime(info.getValue<string>())}</Text>
        ),
      },
    ],
    [],
  );

  return (
    <TanStackTable<LLMRun>
      data={runs}
      columns={columns}
      dataTestId="runs-table"
      enableSorting={false}
      emptyMessage="No recent runs"
    />
  );
}
