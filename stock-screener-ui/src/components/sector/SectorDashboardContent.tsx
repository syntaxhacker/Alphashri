import { Group, Text, Stack, SimpleGrid, Title, Badge, ScrollArea } from "@/ui";
import { IconBellRinging, IconTrendingUp, IconClock } from "@tabler/icons-react";
import { SectorTable } from "./SectorTable";
import type { SectorResponse } from "../../types/sector";
import { CompactPanel, CompactStat, CompactStatGrid } from "../common/compact";
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
    <Stack gap="md" style={{ overflow: "hidden" }}>
      <CompactPanel
        id="sector-alerts-card"
        data-testid="sector-alerts-card"
        style={{ flex: "1 1 50%" }}
        title={
          <Group justify="space-between" mb="xs">
            <Title order={4}>Real-time Alerts</Title>
            <IconBellRinging size={18} color="orange" />
          </Group>
        }
      >
        <ScrollArea flex={1}>
          <SectorAlertsList alerts={alerts} />
        </ScrollArea>
      </CompactPanel>

      <CompactPanel
        id="sector-interval-movers-card"
        data-testid="sector-interval-movers-card"
        style={{ flex: "1 1 50%" }}
        title={
          <Group justify="space-between" mb="xs">
            <Title order={4}>Interval Movers</Title>
            <IconTrendingUp size={18} color="blue" />
          </Group>
        }
      >
        <ScrollArea flex={1}>
          <IntervalMoversTable movers={intervalMovers} />
        </ScrollArea>
      </CompactPanel>
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
    <Stack gap="sm">
      <CompactStatGrid>
        <CompactStat
          label="Top Sector"
          value={data.sectors[0].sector}
          tone="success.main"
          hint={`Avg Change: ${formatPercentage(data.sectors[0].avg_change)}`}
        />
        <CompactStat
          label="Market Breadth"
          value={
            <Group gap="xs">
              <Badge size="sm" color="green" variant="light">
                {totalAdvances} UP
              </Badge>
              <Badge size="sm" color="red" variant="light">
                {totalDeclines} DOWN
              </Badge>
            </Group>
          }
        />
        <CompactStat
          label="Weakest Sector"
          value={bottomSector.sector}
          tone="error.main"
          hint={`Avg Change: ${formatPercentage(bottomSector.avg_change)}`}
        />
      </CompactStatGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
        <CompactPanel
          id="sector-treemap-container"
          data-testid="sector-treemap-container"
          padded={false}
          title={
            <Group justify="space-between" mb="xs">
              <Title order={4}>Live Sector Map</Title>
              {data.last_updated && (
                <Group gap={4}>
                  <IconClock size={12} color="gray" />
                  <Text size="sm" c="dimmed">
                    {new Date(data.last_updated).toLocaleTimeString()}
                  </Text>
                </Group>
              )}
            </Group>
          }
          scrollable
        >
          <SectorTreemap sectors={data.sectors} />
        </CompactPanel>

        <CompactPanel
          id="sector-table-container"
          data-testid="sector-table-container"
          padded={false}
          title={<Title order={4}>Sector Performance</Title>}
          scrollable
        >
          <SectorTable sectors={data.sectors} />
        </CompactPanel>

        <AlertsAndMovers alerts={alerts} intervalMovers={intervalMovers} />
      </SimpleGrid>
    </Stack>
  );
}
