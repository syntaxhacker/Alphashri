import { Text, Stack, Paper } from "@mantine/core";

export function GreeksPanel() {
  return (
    <Stack>
      <Text size="lg" fw={500}>
        Greeks Analysis
      </Text>
      <Paper p="lg" withBorder>
        <Text c="dimmed">Greeks visualization will appear here</Text>
      </Paper>
    </Stack>
  );
}
