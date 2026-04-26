import { Table, Group, Text, ActionIcon, Badge, Anchor } from "@mantine/core";
import { IconEdit, IconTrash, IconAlertCircle } from "@tabler/icons-react";
import type { StrategiesListProps } from "./types";
import { CompactPanel } from "../common/compact";
import { DataTable } from "../common/DataTable";
import { EditableNumberCell } from "./EditableNumberCell";

export function StrategiesList({
  strategies,
  templates,
  onEdit,
  onDelete,
  onUpdate,
  isLoading,
}: StrategiesListProps) {
  const nonTemplates = strategies.filter((s) => !s.is_template);

  if (isLoading) {
    return (
      <CompactPanel
        className="strategy-list-loading"
        testId="strategies-loading-state"
        title={
          <Group gap="xs" wrap="nowrap">
            <div className="spinner" data-testid="strategies-loading" />
            <Text fw={600} size="sm">
              Loading strategies
            </Text>
          </Group>
        }
        description="Fetching strategy variations and defaults"
      />
    );
  }

  if (nonTemplates.length === 0) {
    return (
      <CompactPanel
        className="strategy-list-empty"
        testId="strategies-empty-state"
        title={
          <Group gap="xs" wrap="nowrap">
            <IconAlertCircle size={18} />
            <Text fw={600} size="sm">
              No strategies yet
            </Text>
          </Group>
        }
        description="Create a variation from a template to populate this list."
      />
    );
  }

  const getParentName = (parentId: number | null): string => {
    if (!parentId) return "-";
    const parent = templates.find((t) => Number(t.id) === parentId || t.internal_id === parentId);
    return parent ? parent.name : `#${parentId}`;
  };

  const rows = nonTemplates.map((strategy) => (
    <Table.Tr key={strategy.id} data-testid={`strategy-row-${strategy.id}`}>
      <Table.Td>
        <Anchor
          component="button"
          size="sm"
          fw={500}
          onClick={() => onEdit(strategy)}
          data-testid={`strategy-name-link-${strategy.id}`}
        >
          {strategy.name}
        </Anchor>
      </Table.Td>
      <Table.Td>
        <Badge size="sm" variant="light">
          {strategy.strategy_type}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Text size="sm">{getParentName(strategy.parent_id)}</Text>
      </Table.Td>
      <Table.Td>
        <EditableNumberCell
          value={strategy.sl_pct}
          field="sl_pct"
          strategyId={strategy.internal_id ?? Number(strategy.id)}
          step={0.1}
          decimalScale={1}
          min={0.1}
          suffix="%"
          onUpdate={onUpdate}
        />
      </Table.Td>
      <Table.Td>
        <EditableNumberCell
          value={strategy.tp_pct}
          field="tp_pct"
          strategyId={strategy.internal_id ?? Number(strategy.id)}
          step={0.1}
          decimalScale={1}
          min={0.1}
          suffix="%"
          onUpdate={onUpdate}
        />
      </Table.Td>
      <Table.Td>
        <EditableNumberCell
          value={strategy.min_rr_ratio}
          field="min_rr_ratio"
          strategyId={strategy.internal_id ?? Number(strategy.id)}
          step={0.1}
          decimalScale={1}
          min={0.5}
          suffix="x"
          onUpdate={onUpdate}
        />
      </Table.Td>
      <Table.Td>
        <Group gap={4}>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="blue"
            onClick={() => onEdit(strategy)}
            data-testid={`edit-strategy-btn-${strategy.id}`}
            title="Edit"
          >
            <IconEdit size={14} />
          </ActionIcon>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            onClick={() => onDelete(strategy.internal_id ?? Number(strategy.id))}
            data-testid={`delete-strategy-btn-${strategy.id}`}
            title="Delete"
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <CompactPanel
      title="All strategies"
      description="Review active variations and manage defaults"
      className="strategy-list-table-card"
      id="strategy-list"
      testId="strategy-list-table"
      scrollable
    >
      <DataTable
        withTableBorder
        withColumnBorders
        verticalSpacing="xs"
        horizontalSpacing="sm"
        className="strategy-list-table"
        dataTestId="strategy-list-table-inner"
      >
        <Table.Thead className="strategy-list-header" data-testid="strategy-list-header">
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th>Parent</Table.Th>
            <Table.Th>SL%</Table.Th>
            <Table.Th>TP%</Table.Th>
            <Table.Th>Min RR</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody className="strategy-list-body" data-testid="strategy-list-body">
          {rows}
        </Table.Tbody>
      </DataTable>
    </CompactPanel>
  );
}
