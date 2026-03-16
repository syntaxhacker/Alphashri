import { Text, Stack, Paper } from "@mantine/core";

export function GreeksPanel() {
  return (
    <Stack id="greeks-panel" className="greeks-panel" data-testid="options-greeks-panel">
      <Text size="lg" fw={500} className="greeks-title">
        Greeks Analysis
      </Text>
      <Paper p="lg" withBorder className="greeks-content" data-testid="options-greeks-content">
        <Text c="dimmed">Greeks visualization will appear here</Text>
      </Paper>
    </Stack>
  );
}
