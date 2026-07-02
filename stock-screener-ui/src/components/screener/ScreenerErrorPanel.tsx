import { Stack, Text, Button } from "@/ui";
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
      className="screener-error-container"
      data-testid="screener-error-container"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <IconAlertCircle size={18} />
          <Text fw={600} size="sm">
            Screener failed to load
          </Text>
        </div>
        <Button
          onClick={onRefresh}
          variant="light"
          color="red"
          size="sm"
          data-testid="screener-retry-btn"
        >
          Retry
        </Button>
      </div>
      <Text size="sm" c="dimmed">
        {error}
      </Text>
    </Stack>
  );
}
