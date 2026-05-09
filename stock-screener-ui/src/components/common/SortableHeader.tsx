import { Table, Group, Text } from "@mantine/core";
import { IconArrowUp, IconArrowDown } from "@tabler/icons-react";
import type { ReactNode } from "react";

interface SortableHeaderProps {
  label: string;
  columnKey: string;
  sortColumn: string | null;
  sortDirection: "asc" | "desc";
  onSort: (column: string) => void;
  sortable?: boolean;
  testId?: string;
  children?: ReactNode;
  extraContent?: ReactNode;
}

export function SortableHeader({
  label,
  columnKey,
  sortColumn,
  sortDirection,
  onSort,
  sortable = true,
  testId,
  children,
  extraContent,
}: SortableHeaderProps) {
  const isActive = sortColumn === columnKey && sortable;

  return (
    <Table.Th
      onClick={() => sortable && onSort(columnKey)}
      data-testid={testId || `sort-header-${columnKey}`}
      data-sorted={isActive ? "true" : "false"}
      data-direction={sortDirection}
    >
      <Group gap={4} wrap="nowrap">
        <Text size="sm" fw={500}>
          {label}
        </Text>
        {isActive && (
          <span
            className={`sort-indicator ${sortDirection}`}
            data-testid={`sort-indicator-${columnKey}`}
          >
            {sortDirection === "asc" ? <IconArrowUp size={14} /> : <IconArrowDown size={14} />}
          </span>
        )}
        {children}
        {extraContent}
      </Group>
    </Table.Th>
  );
}
