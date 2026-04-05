import { Paper, Group, Text, Box, Tooltip, Loader, CloseButton } from "@mantine/core";

export function NewsListHeader({
  wsConnected,
  isRefreshing,
  onClose,
}: {
  wsConnected: boolean;
  isRefreshing: boolean;
  onClose: () => void;
}) {
  return (
    <Paper withBorder p="sm" mb="xs" id="news-panel-header" data-testid="news-panel-header">
      <Group justify="space-between">
        <Group gap="xs">
          <Text fw={600}>NEWS</Text>
          {wsConnected && (
            <Tooltip label="Live updates connected">
              <Box
                w={6}
                h={6}
                bg="green"
                style={{ borderRadius: "50%" }}
                data-testid="news-ws-indicator"
              />
            </Tooltip>
          )}
          {isRefreshing && <Loader size="sm" />}
        </Group>
        <CloseButton onClick={onClose} className="news-close-btn" data-testid="news-close-btn" />
      </Group>
    </Paper>
  );
}
