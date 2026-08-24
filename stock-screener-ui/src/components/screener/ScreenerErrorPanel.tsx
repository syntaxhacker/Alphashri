import { Stack, Box, Text, Button } from "@/ui";
import { IconAlertCircle } from "@tabler/icons-react";

interface ScreenerErrorPanelProps {
  error: string;
  onRefresh: () => void;
}

export function ScreenerErrorPanel({ error, onRefresh }: ScreenerErrorPanelProps) {
  return (
    <Stack
      gap="sm"
      align="stretch"
      data-testid="screener-error-container"
      sx={{ p: 1 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <IconAlertCircle size={18} />
          <Text fw={600} size="sm">
            Screener failed to load
          </Text>
        </Box>
        <Button
          onClick={onRefresh}
          variant="light"
          color="error"
          size="sm"
          data-testid="screener-retry-btn"
        >
          Retry
        </Button>
      </Box>
      <Text size="sm" c="dimmed">
        {error}
      </Text>
    </Stack>
  );
}
