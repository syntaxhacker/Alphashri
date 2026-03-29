import { Group, Text } from "@mantine/core";
import { IconDatabaseOff } from "@tabler/icons-react";
import { CompactPanel } from "../common/compact";
import type { ScreenerEmptyProps } from "./types";

export function ScreenerEmpty({ message = "No results found" }: ScreenerEmptyProps) {
  return (
    <CompactPanel
      id="screener-empty"
      className="screener-empty"
      testId="screener-empty"
      title={
        <Group gap="xs" wrap="nowrap">
          <IconDatabaseOff size={18} stroke={1.7} />
          <Text fw={600} size="sm">
            No results found
          </Text>
        </Group>
      }
      description={message}
      padded
    />
  );
}
