import type { JSX } from "solid-js";
import { InlineLoader } from "./states";

interface TableLoadingStateProps {
  message?: string;
  showSpinner?: boolean;
  children?: JSX.Element;
}

/**
 * Reusable loading state component for tables.
 * Thin wrapper over `InlineLoader`.
 *
 * @example
 * <TableLoadingState />
 * <TableLoadingState message="Loading positions..." />
 * <TableLoadingState showSpinner={false} message="Fetching data..." />
 */
export function TableLoadingState({ message = "Loading...", showSpinner = true, children }: TableLoadingStateProps) {
  return (
    <InlineLoader data-testid="table-loading-state" size="sm" message={message} showSpinner={showSpinner}>
      {children}
    </InlineLoader>
  );
}
