import { Table, Group, Text, ActionIcon, Alert, Stack, Badge, Tooltip } from "@mantine/core";
import { IconEdit, IconTrash, IconStar, IconAlertCircle } from "@tabler/icons-react";
import type { StrategiesListProps } from "./types";

export function StrategiesList({
  strategies,
  templates,
  onEdit,
  onDelete,
  isLoading,
}: StrategiesListProps) {
  // Filter out templates
  const nonTemplates = strategies.filter((s) => !s.is_template);

  if (isLoading) {
    return (
      <Stack align="center" gap="md" mt="xl">
        <div className="spinner" data-testid="strategies-loading" />
        <Text size="sm" c="dimmed">
          Loading strategies...
        </Text>
      </Stack>
    );
  }

  if (nonTemplates.length === 0) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} title="No Strategies" color="yellow" mt="xl">
        No strategy variations created yet. Create one from a template.
      </Alert>
    );
  }

  const getParentName = (parentId: number | null): string => {
    if (!parentId) return "-";
    const parent = templates.find((t) => t.id === parentId);
    return parent ? parent.name : `#${parentId}`;
  };

  const rows = nonTemplates.map((strategy) => (
    <Table.Tr
      key={strategy.id}
      data-testid={`strategy-row-${strategy.id}`}
      className={strategy.is_default ? "default-strategy-row" : ""}
    >
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          {strategy.is_default && (
            <Tooltip label="Default Strategy">
              <IconStar size={14} color="var(--mantine-color-yellow-5)" />
            </Tooltip>
          )}
          <Text fw={500} size="sm">
            {strategy.name}
          </Text>
        </Group>
      </Table.Td>
      <Table.Td>
        <Badge size="xs" variant="light">
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
        {strategy.is_default ? (
          <Text size="sm" c="teal">
            Yes
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            No
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        <Group gap={4}>
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
            onClick={() => onDelete(strategy.id)}
            disabled={strategy.is_default}
            data-testid="delete-strategy-btn"
            title={strategy.is_default ? "Cannot delete default strategy" : "Delete"}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <Table striped highlightOnHover withTableBorder withColumnBorders>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Name</Table.Th>
          <Table.Th>Type</Table.Th>
          <Table.Th>Parent</Table.Th>
          <Table.Th>SL%</Table.Th>
          <Table.Th>TP%</Table.Th>
          <Table.Th>Max Positions</Table.Th>
          <Table.Th>Default</Table.Th>
          <Table.Th>Actions</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>{rows}</Table.Tbody>
    </Table>
  );
}
