import { Center, Loader, Text } from "@mantine/core";

interface ScreenerLoadingProps {
  message?: string;
}

export function ScreenerLoading({ message }: ScreenerLoadingProps) {
  return (
    <Center h={200} style={{ flexDirection: "column", gap: 16 }} data-testid="screener-loading">
      <Loader size="lg" />
      {message && (
        <Text c="dimmed" size="sm">
          {message}
        </Text>
      )}
    </Center>
  );
}
