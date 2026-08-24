import { Group, Loader, Text } from "@/ui";
import { CompactPanel } from "../common/compact";
import type { ScreenerLoadingProps } from "./types";

export function ScreenerLoading({ message }: ScreenerLoadingProps) {
  return (
    <CompactPanel
      id="screener-loading"
      testId="screener-loading"
      title={
        <Group gap="xs" wrap="nowrap">
          <Loader size="sm" data-testid="screener-loader" />
          <Text fw={600} size="sm">
            Loading screener
          </Text>
        </Group>
      }
      description={message}
    />
  );
}
