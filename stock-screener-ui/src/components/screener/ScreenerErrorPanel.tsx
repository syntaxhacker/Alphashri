import { Stack, Box, Text, Button } from "@/ui";
import { IconAlertCircle } from "./icons";

interface ScreenerErrorPanelProps {
  error: string;
  onRefresh: () => void;
}

export function ScreenerErrorPanel(props: ScreenerErrorPanelProps) {
  return (
    <Stack
      gap="sm"
      align="stretch"
      data-testid="screener-error-container"
      className="p-2"
    >
      <Box className="flex items-center justify-between gap-2">
        <Box className="flex items-center gap-2">
          <IconAlertCircle size={18} />
          <Text fw={600} size="sm">
            Screener failed to load
          </Text>
        </Box>
        <Button
          onClick={props.onRefresh}
          variant="filled"
          color="error"
          size="sm"
          data-testid="screener-retry-btn"
        >
          Retry
        </Button>
      </Box>
      <Text size="sm" c="dimmed">
        {props.error}
      </Text>
    </Stack>
  );
}
