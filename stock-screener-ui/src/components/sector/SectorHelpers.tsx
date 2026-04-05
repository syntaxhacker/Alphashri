import { Box, Stack, Text, Group, Badge, useMantineColorScheme } from "@mantine/core";
import type { SectorItem, StockMover } from "../../types/sector";
import { formatPercentage } from "../../utils/ui-helpers";

export interface SectorAlert {
  timestamp: string;
  sector: string;
  direction: "SURGING" | "DROPPING";
  delta: number;
}

export interface InternalStockMover extends StockMover {
  prev_change: number;
  delta: number;
}

export function detectSectorAlerts(
  sectors: SectorItem[],
  prevData: Record<string, number>,
): SectorAlert[] {
  const alerts: SectorAlert[] = [];
  sectors.forEach((item) => {
    const prevChange = prevData[item.sector];
    if (prevChange !== undefined) {
      const delta = item.avg_change - prevChange;
      if (Math.abs(delta) >= 0.3) {
        alerts.push({
          timestamp: new Date().toLocaleTimeString(),
          sector: item.sector,
          direction: delta > 0 ? "SURGING" : "DROPPING",
          delta,
        });
      }
    }
  });
  return alerts;
}

export function detectIntervalMovers(
  movers: StockMover[],
  prevData: Record<string, number>,
): InternalStockMover[] {
  const results: InternalStockMover[] = [];
  movers.forEach((item) => {
    const prevChange = prevData[item.symbol];
    if (prevChange !== undefined) {
      const delta = item.change - prevChange;
      if (Math.abs(delta) >= 0.3) {
        results.push({ ...item, prev_change: prevChange, delta });
      }
    }
  });
  return results.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function buildTreemapData(sectors: SectorItem[]) {
  return [...sectors]
    .map((sector) => ({
      name: sector.sector,
      value: Math.max(Math.abs(sector.avg_change), 0.01),
      avgChange: sector.avg_change,
      stockCount: sector.stock_count,
      advances: sector.advances,
      declines: sector.declines,
      avgRsi: sector.avg_rsi,
      avgAdx: sector.avg_adx,
      topMovers: sector.top_movers,
    }))
    .sort((a, b) => Math.abs(b.avgChange) - Math.abs(a.avgChange) || b.value - a.value);
}

const HEAT_COLORS = {
  strongGreen: "#166534",
  mildGreen: "#1f7a4a",
  faintGreen: "#2b5f46",
  neutral: "#2a3441",
  faintRed: "#7a2e2e",
  mildRed: "#991b1b",
  strongRed: "#7f1d1d",
} as const;

function getSectorColor(avgChange: number): string {
  if (avgChange >= 2.5) return HEAT_COLORS.strongGreen;
  if (avgChange >= 1.25) return HEAT_COLORS.mildGreen;
  if (avgChange >= 0.25) return HEAT_COLORS.faintGreen;
  if (avgChange <= -2.5) return HEAT_COLORS.strongRed;
  if (avgChange <= -1.25) return HEAT_COLORS.mildRed;
  if (avgChange <= -0.25) return HEAT_COLORS.faintRed;
  return HEAT_COLORS.neutral;
}

function getTileSpan(index: number) {
  if (index === 0) return { col: "span 2", row: "span 2", minHeight: 212 };
  if (index < 3) return { col: "span 1", row: "span 1", minHeight: 102 };
  if (index < 7) return { col: "span 1", row: "span 1", minHeight: 84 };
  return { col: "span 1", row: "span 1", minHeight: 72 };
}

function TreemapTile({
  sector,
  index,
  span,
  isDark,
}: {
  sector: ReturnType<typeof buildTreemapData>[number] & { itemStyle: { color: string } };
  index: number;
  span: ReturnType<typeof getTileSpan>;
  isDark: boolean;
}) {
  return (
    <Box
      style={{
        gridColumn: span.col,
        gridRow: span.row,
        minHeight: span.minHeight,
        background: sector.itemStyle.color,
        color: "var(--mantine-color-gray-0)",
        padding: index === 0 ? "16px" : "12px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxShadow: isDark
          ? "inset 0 1px 0 rgba(255,255,255,0.04)"
          : "inset 0 1px 0 rgba(255,255,255,0.16)",
      }}
    >
      <Stack gap={4}>
        <Text fw={800} size={index === 0 ? "lg" : "sm"} lh={1.1}>
          {sector.name}
        </Text>
        <Text fw={700} size={index === 0 ? "md" : "sm"} opacity={0.95}>
          {formatPercentage(sector.avgChange)}
        </Text>
      </Stack>
      <Group justify="space-between" align="flex-end" gap="xs" wrap="nowrap">
        <Stack gap={2}>
          <Text size="xs" opacity={0.75}>
            Stocks {sector.stockCount}
          </Text>
          <Text size="xs" opacity={0.75}>
            {sector.advances} / {sector.declines}
          </Text>
        </Stack>
        {index < 6 ? (
          <Badge
            size="xs"
            variant="filled"
            color="dark"
            styles={{
              root: {
                backgroundColor: "rgba(15, 23, 42, 0.28)",
                color: "var(--mantine-color-gray-0)",
              },
            }}
          >
            #{index + 1}
          </Badge>
        ) : null}
      </Group>
    </Box>
  );
}

export function SectorTreemap({ sectors }: { sectors: SectorItem[] }) {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  const rawTreemapData = buildTreemapData(sectors);
  const treemapData = rawTreemapData.map((sector) => ({
    ...sector,
    itemStyle: { color: getSectorColor(sector.avgChange), gapWidth: 0 },
  }));

  return (
    <Box
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gridAutoRows: "minmax(72px, auto)",
        gap: "8px",
        height: "100%",
        minHeight: 320,
      }}
    >
      {treemapData.map((sector, index) => (
        <TreemapTile
          key={sector.name}
          sector={sector}
          index={index}
          span={getTileSpan(index)}
          isDark={isDark}
        />
      ))}
    </Box>
  );
}
