import type { JSX } from "solid-js";
import { EmptyCompact } from "./states";

interface TableEmptyStateProps {
  message: string;
  icon?: JSX.Element;
  action?: JSX.Element;
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
export function TableEmptyState(props: TableEmptyStateProps) {
  return (
    <EmptyCompact data-testid="table-empty-state" icon={props.icon} title={props.message}>
      {props.action}
    </EmptyCompact>
  );
}
