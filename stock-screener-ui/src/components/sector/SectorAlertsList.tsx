import { Stack, Paper, Group, Text, Badge } from "@mantine/core";
import type { SectorAlert } from "./sectorUtils";
import { formatPercentage } from "../../utils/ui-helpers";

export function SectorAlertsList({ alerts }: { alerts: SectorAlert[] }) {
  if (alerts.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="xl">
        Waiting for major movements...
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {alerts.map((alert, i) => (
        <Paper
          key={i}
          p="xs"
          withBorder
          bg={alert.direction === "SURGING" ? "rgba(64, 192, 87, 0.05)" : "rgba(250, 82, 82, 0.05)"}
        >
          <Group justify="space-between">
            <Text size="sm" fw={700}>
              [{alert.timestamp}] {alert.sector}
            </Text>
            <Badge color={alert.direction === "SURGING" ? "green" : "red"} size="sm">
              {alert.direction} ({formatPercentage(alert.delta, 2, false)})
            </Badge>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}
