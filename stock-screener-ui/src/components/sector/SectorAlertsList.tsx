import { Box, Text } from "@/ui";
import type { SectorAlert } from "./sectorUtils";
import { formatPercentage } from "../../utils/ui-helpers";
import { NEGATIVE, POSITIVE } from "@/ui/palette";

export function SectorAlertsList({ alerts }: { alerts: SectorAlert[] }) {
  if (alerts.length === 0) {
    return (
      <Box className="flex items-center justify-center p-2">
        <Text size="xs" c="dimmed" ta="center" py={1}>
          Waiting for major movements...
        </Text>
      </Box>
    );
  }

  return (
    <Box data-testid="sector-alerts-table" className="flex flex-col">
      {alerts.map((alert) => {
        const positive = alert.direction === "SURGING";
        const color = positive ? POSITIVE : NEGATIVE;
        return (
          <Box
            key={`${alert.timestamp}-${alert.sector}`}
            className="grid grid-cols-[62px_minmax(0,1fr)_auto] items-center gap-1 min-h-[20px] px-1 border-b border-fin-border"
          >
            <Text c="dimmed" className="text-[9px] tabular-nums">
              {alert.timestamp}
            </Text>
            <Text truncate className="text-[10.5px]">
              {alert.sector}
            </Text>
            <Box className="inline-flex items-center gap-1">
              <Box className="size-[5px] rounded-full shrink-0" style={{ "background-color": color }} />
              <Text className="text-[9.5px] font-bold whitespace-nowrap" style={{ color }}>
                {alert.direction} ({formatPercentage(alert.delta, 2, false)})
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
