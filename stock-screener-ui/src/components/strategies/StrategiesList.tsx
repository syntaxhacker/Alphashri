import { Table, Group, Text, ActionIcon, Alert, Stack, Badge, Tooltip } from "@mantine/core";
import { IconEdit, IconTrash, IconCheck, IconAlertCircle } from "@tabler/icons-react";
import type { StrategiesListProps } from "./types";

export function StrategiesList({
  strategies,
  templates,
  onEdit,
  onDelete,
  onSetActive,
  isLoading,
}: StrategiesListProps) {
  const nonTemplates = strategies.filter((s) => !s.is_template);

  // Determine the actual active strategy (prefer default if multiple or none active)
  const activeByFlag = nonTemplates.filter((s) => s.is_active);
  let activeStrategy: (typeof nonTemplates)[0] | undefined;

  if (activeByFlag.length === 1) {
    activeStrategy = activeByFlag[0];
  } else {
    // Multiple active or none - prefer default
    activeStrategy = nonTemplates.find((s) => s.is_default) || nonTemplates[0];
  }

  if (isLoading) {
    return (
      <Stack align="center" gap="md" mt="xl" className="strategy-list-loading">
        <div className="spinner" data-testid="strategies-loading" />
        <Text size="sm" c="dimmed">
          Loading strategies...
        </Text>
      </Stack>
    );
  }

  if (nonTemplates.length === 0) {
    return (
      <Alert
        icon={<IconAlertCircle size={16} />}
        title="No Strategies"
        color="yellow"
        mt="xl"
        className="strategy-list-empty"
        data-testid="strategies-empty-state"
      >
        No strategy variations created yet. Create one from a template.
      </Alert>
    );
  }

  const getParentName = (parentId: number | null): string => {
    if (!parentId) return "-";
    const parent = templates.find((t) => Number(t.id) === parentId || t.internal_id === parentId);
    return parent ? parent.name : `#${parentId}`;
  };

  const isActive = (strategy: (typeof nonTemplates)[0]) => {
    return activeStrategy?.id === strategy.id;
  };

  const rows = nonTemplates.map((strategy) => (
    <Table.Tr
      key={strategy.id}
      data-testid={`strategy-row-${strategy.id}`}
      style={isActive(strategy) ? { backgroundColor: "var(--mantine-color-teal-1)" } : undefined}
    >
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          {isActive(strategy) && (
            <Tooltip label="Active Strategy">
              <IconCheck size={14} color="var(--mantine-color-teal-5)" />
            </Tooltip>
          )}
          <Text fw={500} size="sm">
            {strategy.name}
          </Text>
        </Group>
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
        <Text size="sm">{strategy.sl_pct}%</Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm">{strategy.tp_pct}%</Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm">{strategy.max_positions}</Text>
      </Table.Td>
      <Table.Td>
        {isActive(strategy) ? (
          <Badge size="sm" color="teal" variant="light">
            Active
          </Badge>
        ) : (
          <Text size="sm" c="dimmed">
            -
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        <Group gap={4}>
          {!isActive(strategy) && (
            <Tooltip label="Set as Active">
              <ActionIcon
                size="sm"
                variant="subtle"
                color="teal"
                onClick={() => onSetActive(strategy.internal_id ?? Number(strategy.id))}
                data-testid="set-active-btn"
              >
                <IconCheck size={14} />
              </ActionIcon>
            </Tooltip>
          )}
          <ActionIcon
            size="sm"
            variant="subtle"
            color="blue"
            onClick={() => onEdit(strategy)}
            data-testid="edit-strategy-btn"
            title="Edit"
          >
            <IconEdit size={14} />
          </ActionIcon>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            onClick={() => onDelete(strategy.internal_id ?? Number(strategy.id))}
            disabled={isActive(strategy)}
            data-testid="delete-strategy-btn"
            title={isActive(strategy) ? "Cannot delete active strategy" : "Delete"}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <Table
      striped
      highlightOnHover
      withTableBorder
      withColumnBorders
      className="strategy-list-table"
      id="strategy-list"
      data-testid="strategy-list-table"
    >
      <Table.Thead className="strategy-list-header" data-testid="strategy-list-header">
        <Table.Tr>
          <Table.Th>Name</Table.Th>
          <Table.Th>Type</Table.Th>
          <Table.Th>Parent</Table.Th>
          <Table.Th>SL%</Table.Th>
          <Table.Th>TP%</Table.Th>
          <Table.Th>Max Positions</Table.Th>
          <Table.Th>Status</Table.Th>
          <Table.Th>Actions</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody className="strategy-list-body" data-testid="strategy-list-body">
        {rows}
      </Table.Tbody>
    </Table>
  );
}
