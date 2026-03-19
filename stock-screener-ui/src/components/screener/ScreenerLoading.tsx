import { Group, Loader, Text } from "@mantine/core";
import { CompactPanel } from "../common/compact";

interface ScreenerLoadingProps {
  message?: string;
}

export function ScreenerLoading({ message }: ScreenerLoadingProps) {
  return (
    <CompactPanel
      id="screener-loading"
      className="screener-loading"
      testId="screener-loading"
      title={
        <Group gap="xs" wrap="nowrap">
          <Loader size="sm" className="screener-loader" data-testid="screener-loader" />
          <Text fw={600} size="sm">
            Loading screener
          </Text>
        </Group>
      }
      description={message}
    />
  );
}
