import { For, Show } from "solid-js";
import { Box, Text } from "@/ui";
import type { SectorAlert } from "./sectorUtils";
import { formatPercentage } from "../../utils/ui-helpers";
import { NEGATIVE, POSITIVE } from "@/ui/palette";

export function SectorAlertsList(props: { alerts: SectorAlert[] }) {
  const alerts = () => props.alerts ?? [];

  return (
    <Show
      when={alerts().length > 0}
      fallback={
        <Box className="flex items-center justify-center p-2">
          <Text size="xs" c="dimmed" ta="center" py={1}>
            Waiting for major movements...
          </Text>
        </Box>
      }
    >
      <Box data-testid="sector-alerts-table" className="flex flex-col">
        <For each={alerts()}>
          {(alert) => {
            const positive = alert.direction === "SURGING";
            const color = positive ? POSITIVE : NEGATIVE;
            return (
              <Box
                className="grid grid-cols-[62px_minmax(0,1fr)_auto] items-center gap-1 min-h-[20px] px-1 border-b border-fin-border"
              >
                <Text c="dimmed" className="text-[9px] tabular-nums font-mono">
                  {alert.timestamp}
                </Text>
                <Text truncate className="text-[10.5px]">
                  {alert.sector}
                </Text>
                <Box className="inline-flex items-center gap-1">
                  <Box className="size-[5px] rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <Text className="text-[9.5px] font-bold whitespace-nowrap font-mono tabular-nums" style={{ color }}>
                    {alert.direction} ({formatPercentage(alert.delta, 2, false)})
                  </Text>
                </Box>
              </Box>
            );
          }}
        </For>
      </Box>
    </Show>
  );
}
