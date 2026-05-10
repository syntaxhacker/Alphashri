import { Flex, Text, Loader } from "@mantine/core";
import type { ReactNode } from "react";

interface TableLoadingStateProps {
  message?: string;
  showSpinner?: boolean;
  children?: ReactNode;
}

/**
 * Reusable loading state component for tables.
 * Displays a centered loader with optional message.
 *
 * @example
 * <TableLoadingState />
 * <TableLoadingState message="Loading positions..." />
 * <TableLoadingState showSpinner={false} message="Fetching data..." />
 */
export function TableLoadingState({
  message = "Loading...",
  showSpinner = true,
  children,
}: TableLoadingStateProps) {
  return (
    <Flex
      justify="center"
      align="center"
      py="lg"
      data-testid="table-loading-state"
      direction="column"
      gap="xs"
    >
      {showSpinner && <Loader size="sm" />}
      {children || (
        <Text size="xs" c="dimmed">
          {message}
        </Text>
      )}
    </Flex>
  );
}
