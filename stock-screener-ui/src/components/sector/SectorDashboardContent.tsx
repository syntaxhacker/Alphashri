import { Box, Stack } from "@/ui";
import { Card } from "@/ui";
import { Text } from "@/ui";
import { IconBellRinging, IconTrendingUp, IconClock } from "@tabler/icons-react";
import { SectorTable } from "./SectorTable";
import type { SectorResponse } from "../../types/sector";
import { formatPercentage } from "../../utils/ui-helpers";
import { SectorTreemap } from "./SectorHelpers";
import { SectorAlertsList } from "./SectorAlertsList";
import { IntervalMoversTable } from "./IntervalMoversTable";
import type { SectorAlert, InternalStockMover } from "./sectorUtils";

function AlertsAndMovers({
  alerts,
  intervalMovers,
}: {
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
}) {
  return (
    <Stack spacing={1} className="overflow-hidden items-center justify-center">
      <Card className="flex-[1_1_50%] flex flex-col p-2 w-full" data-testid="sector-alerts-card" id="sector-alerts-card">
        <div className="flex flex-col items-center justify-center p-2 w-full">
          <div className="flex items-center justify-center gap-2 p-2 w-full">
            <Text className="flex items-center justify-center">Real-time Alerts</Text>
            <IconBellRinging size={18} className="text-fin-warning" />
          </div>
          <div className="flex items-center justify-center p-2 w-full flex-1 min-h-0 overflow-auto">
            <SectorAlertsList alerts={alerts} />
          </div>
        </div>
      </Card>

      <Card className="flex-[1_1_50%] flex flex-col p-2 w-full" data-testid="sector-interval-movers-card" id="sector-interval-movers-card">
        <div className="flex flex-col items-center justify-center p-2 w-full">
          <div className="flex items-center justify-center gap-2 p-2 w-full">
            <Text className="flex items-center justify-center">Interval Movers</Text>
            <IconTrendingUp size={18} className="text-fin-primary" />
          </div>
          <div className="flex items-center justify-center p-2 w-full flex-1 min-h-0 overflow-auto">
            <IntervalMoversTable movers={intervalMovers} />
          </div>
        </div>
      </Card>
    </Stack>
  );
}

export function DashboardContent({
  data,
  alerts,
  intervalMovers,
}: {
  data: SectorResponse;
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
}) {
  const bottomSector = data.sectors[data.sectors.length - 1];
  const totalAdvances = data.sectors.reduce((acc, s) => acc + s.advances, 0);
  const totalDeclines = data.sectors.reduce((acc, s) => acc + s.declines, 0);

  return (
    <Stack spacing={1} className="p-2 items-center justify-center">
      <div className="grid gap-2 items-center justify-center">
        <div className="flex justify-center">
          <Card className="w-full p-2">
            <div className="flex flex-col items-center justify-center p-2 gap-2">
              <Text size="xs" className="flex items-center justify-center">Top Sector</Text>
              <Text className="flex items-center justify-center">{data.sectors[0].sector}</Text>
              <Text size="xs" className="flex items-center justify-center">{`Avg Change: ${formatPercentage(data.sectors[0].avg_change)}`}</Text>
            </div>
          </Card>
        </div>
        <div className="flex justify-center">
          <Card className="w-full p-2">
            <div className="flex flex-col items-center justify-center p-2 gap-2">
              <Text size="xs" className="flex items-center justify-center">Market Breadth</Text>
              <div className="flex items-center justify-center gap-2 p-2">
                <div className="flex items-center justify-center gap-2 p-2" style={{ "background-color": "rgba(63, 185, 80, 0.12)", "border-radius": "4px" }}>{totalAdvances} UP</div>
                <div className="flex items-center justify-center gap-2 p-2" style={{ "background-color": "rgba(248, 81, 73, 0.12)", "border-radius": "4px" }}>{totalDeclines} DOWN</div>
              </div>
            </div>
          </Card>
        </div>
        <div className="flex justify-center">
          <Card className="w-full p-2">
            <div className="flex flex-col items-center justify-center p-2 gap-2">
              <Text size="xs" className="flex items-center justify-center">Weakest Sector</Text>
              <Text className="flex items-center justify-center">{bottomSector.sector}</Text>
              <Text size="xs" className="flex items-center justify-center">{`Avg Change: ${formatPercentage(bottomSector.avg_change)}`}</Text>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-2 items-stretch w-full">
        <div className="flex justify-center">
          <Card className="w-full p-2 flex flex-col items-center" data-testid="sector-treemap-container" id="sector-treemap-container">
            <div className="flex flex-col items-center justify-center p-2 w-full">
              <div className="flex items-center justify-center gap-2 p-2 w-full">
                <Text className="flex items-center justify-center">Live Sector Map</Text>
                {data.last_updated && (
                  <div className="flex items-center justify-center gap-2 p-2">
                    <IconClock size={12} className="text-fin-text-muted" />
                    <Text size="xs" className="flex items-center justify-center">{new Date(data.last_updated).toLocaleTimeString()}</Text>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-center p-2 w-full">
                <SectorTreemap sectors={data.sectors} />
              </div>
            </div>
          </Card>
        </div>
        <div className="flex justify-center">
          <Card className="w-full p-2 flex flex-col items-center" data-testid="sector-table-container" id="sector-table-container">
            <div className="flex flex-col items-center justify-center p-2 w-full">
              <div className="flex items-center justify-center gap-2 p-2 w-full">
                <Text className="flex items-center justify-center">Sector Performance</Text>
              </div>
              <div className="flex items-center justify-center p-2 w-full">
                <SectorTable sectors={data.sectors} />
              </div>
            </div>
          </Card>
        </div>
        <div className="flex justify-center">
          <Box className="w-full flex items-center justify-center p-2">
            <AlertsAndMovers alerts={alerts} intervalMovers={intervalMovers} />
          </Box>
        </div>
      </div>
    </Stack>
  );
}
