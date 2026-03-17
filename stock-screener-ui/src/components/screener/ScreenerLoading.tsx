import { Center, Loader, Text } from "@mantine/core";

interface ScreenerLoadingProps {
  message?: string;
}

export function ScreenerLoading({ message }: ScreenerLoadingProps) {
  return (
    <Center
      h={200}
      style={{ flexDirection: "column", gap: 16 }}
      id="screener-loading"
      className="screener-loading"
      data-testid="screener-loading"
    >
      <Loader size="lg" className="screener-loader" data-testid="screener-loader" />
      {message && (
        <Text c="dimmed" size="sm" className="loading-message" data-testid="loading-message">
          {message}
        </Text>
      )}
    </Center>
  );
}
