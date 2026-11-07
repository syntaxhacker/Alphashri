import type { ReactNode } from "react";
import { EmptyCompact } from "./states";

interface TableEmptyStateProps {
  message: string;
  icon?: ReactNode;
  action?: ReactNode;
}

/**
 * Reusable empty state component for tables.
 * Thin wrapper over `EmptyCompact` (CompactPanel + EmptyState).
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
    <EmptyCompact data-testid="table-empty-state" icon={icon} title={message}>
      {action}
    </EmptyCompact>
  );
}
