import { Box, Text } from "@/ui";
import type { SectorAlert } from "./sectorUtils";
import { formatPercentage } from "../../utils/ui-helpers";
import { NEGATIVE, POSITIVE } from "@/ui/palette";

export function SectorAlertsList({ alerts }: { alerts: SectorAlert[] }) {
  if (alerts.length === 0) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
        <Text size="xs" c="dimmed" ta="center" py={1}>
          Waiting for major movements...
        </Text>
      </Box>
    );
  }

  return (
    <Box data-testid="sector-alerts-table" sx={{ display: "flex", flexDirection: "column" }}>
      {alerts.map((alert) => {
        const positive = alert.direction === "SURGING";
        const color = positive ? POSITIVE : NEGATIVE;
        return (
          <Box
            key={`${alert.timestamp}-${alert.sector}`}
            sx={{
              display: "grid",
              gridTemplateColumns: "62px minmax(0, 1fr) auto",
              alignItems: "center",
              gap: 0.5,
              minHeight: 20,
              px: 0.5,
              borderBottom: "1px solid",
              borderColor: "divider",
            }}
          >
            <Text c="dimmed" sx={{ fontSize: 9, fontVariantNumeric: "tabular-nums" }}>
              {alert.timestamp}
            </Text>
            <Text truncate sx={{ fontSize: 10.5 }}>
              {alert.sector}
            </Text>
            <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
              <Box sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
              <Text sx={{ fontSize: 9.5, fontWeight: 700, color, whiteSpace: "nowrap" }}>
                {alert.direction} ({formatPercentage(alert.delta, 2, false)})
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
