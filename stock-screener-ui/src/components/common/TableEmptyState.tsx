import { Flex, Text, Group } from "@/ui";
import type { ReactNode } from "react";

interface TableEmptyStateProps {
  message: string;
  icon?: ReactNode;
  action?: ReactNode;
}

/**
 * Reusable empty state component for tables.
 * Displays a consistent message when a table has no data.
 *
 * @example
 * <TableEmptyState message="No open positions" />
 * <TableEmptyState message="No trades found" icon={<IconArchive />} />
 * <TableEmptyState
 *   message="No results yet. Run a backtest."
 *   action={<Button>Run Backtest</Button>}
 * />
 */
export function TableEmptyState({ message, icon, action }: TableEmptyStateProps) {
  return (
    <Flex
      py="lg"
      justify="center"
      align="center"
      direction="column"
      gap={4}
      data-testid="table-empty-state"
    >
      {icon && <Group justify="center">{icon}</Group>}
      <Text size="sm" fw={500} c="dimmed">
        {message}
      </Text>
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </Flex>
  );
}
