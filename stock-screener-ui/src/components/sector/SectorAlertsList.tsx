import { For, Show } from "solid-js";
import { Box, Text } from "@/ui";
import type { SectorAlert } from "./sectorUtils";
import { formatPercentage } from "../../utils/ui-helpers";
import { NEGATIVE, POSITIVE } from "@/ui/palette";

export interface SectorAlertsListProps {
  alerts: SectorAlert[];
  /** Resolves an alert's sector to its lead symbol; absent → label stays inert text. */
  onSectorClick?: (sector: string) => void;
}

export function SectorAlertsList(props: SectorAlertsListProps) {
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
                <Text c="dimmed" className="text-ui-micro tabular-nums font-mono">
                  {alert.timestamp}
                </Text>
                <Show when={props.onSectorClick} fallback={
                  <Text truncate className="text-ui-micro">
                    {alert.sector}
                  </Text>
                }>
                  <button
                    type="button"
                    data-testid={`sector-alert-symbol-${alert.sector}`}
                    aria-label={`Open ${alert.sector} lead stock chart`}
                    onClick={() => props.onSectorClick?.(alert.sector)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      props.onSectorClick?.(alert.sector);
                    }}
                    className="min-w-0 truncate bg-transparent p-0 text-left text-ui-micro text-fin-text hover:text-fin-primary focus-visible:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-text"
                  >
                    {alert.sector}
                  </button>
                </Show>
                <Box className="inline-flex items-center gap-1">
                  <Box className="size-[5px] rounded-full shrink-0" style={{ "background-color": color }} />
                  <Text className="text-ui-micro font-bold whitespace-nowrap font-mono tabular-nums" style={{ color }}>
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
