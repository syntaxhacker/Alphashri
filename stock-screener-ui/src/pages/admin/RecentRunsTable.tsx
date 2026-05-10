import { Text, Badge, Group, Table } from "@mantine/core";
import type { LLMRun, ModelUsage } from "../../types/admin";
import { getStatusColor } from "../../utils/ui-helpers";
import { CompactPanel } from "../../components/common/compact";
import { DataTable } from "../../components/common/DataTable";
import { TableEmptyState } from "../../components/common/TableEmptyState";
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
  if (runs.length === 0) {
    return <TableEmptyState message="No recent runs" />;
  }
  return (
    <DataTable dataTestId="runs-table">
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
        {runs.map((run) => (
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
              <Text size="sm">{(run.input_tokens + run.output_tokens).toLocaleString()}</Text>
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
    </DataTable>
  );
}
