import type { JSX } from "solid-js";
import { EmptyCompact } from "./states";

interface TableEmptyStateProps {
  message: string;
  icon?: JSX.Element;
  action?: JSX.Element;
}

export function TableEmptyState(props: TableEmptyStateProps) {
  return (
    <EmptyCompact data-testid="table-empty-state" icon={props.icon} title={props.message}>
      {props.action}
    </EmptyCompact>
  );
}
