import { For, Show, createMemo } from "solid-js";
import { Box, Stack, Text, Group, Badge, useColorScheme } from "@/ui";
import type { SectorItem } from "../../types/sector";
import { formatPercentage } from "../../utils/ui-helpers";
import {
  SECTOR_STRONG_GREEN,
  SECTOR_GREEN,
  SECTOR_LIGHT_GREEN,
  SECTOR_NEUTRAL,
  SECTOR_LIGHT_RED,
  SECTOR_RED,
  SECTOR_STRONG_RED,
  CREAM,
  BLACK,
} from "../../config/colors";
import { withAlpha } from "../../utils/color";
import { buildTreemapData } from "./sectorUtils";

// Pure helpers live in sectorUtils.ts — re-exported here so existing
// `./SectorHelpers` importers keep working.
export { detectSectorAlerts, detectIntervalMovers, buildTreemapData } from "./sectorUtils";
export type { SectorAlert, InternalStockMover } from "./sectorUtils";

const HEAT_COLORS = {
  strongGreen: SECTOR_STRONG_GREEN,
  mildGreen: SECTOR_GREEN,
  faintGreen: SECTOR_LIGHT_GREEN,
  neutral: SECTOR_NEUTRAL,
  faintRed: SECTOR_LIGHT_RED,
  mildRed: SECTOR_RED,
  strongRed: SECTOR_STRONG_RED,
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

function TreemapTile(props: {
  sector: ReturnType<typeof buildTreemapData>[number] & { itemStyle: { color: string } };
  index: number;
  span: { col: string; row: string; minHeight: number };
  isDark: boolean;
}) {
  const sector = () => props.sector;
  const index = () => props.index;

  return (
    <Box
      style={{
        gridColumn: props.span.col,
        gridRow: props.span.row,
        minHeight: `${props.span.minHeight}px`,
        background: sector().itemStyle.color,
        color: "#ffffff",
        padding: index() === 0 ? "16px" : "12px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxShadow: props.isDark
          ? `inset 0 1px 0 ${withAlpha(CREAM, 0.04)}`
          : `inset 0 1px 0 ${withAlpha(CREAM, 0.16)}`,
      }}
    >
      <Stack gap={4}>
        <Text fw={800} size={index() === 0 ? "lg" : "sm"} lh={1.1}>
          {sector().name}
        </Text>
        <Text fw={700} size={index() === 0 ? "md" : "sm"} opacity={0.95} className="font-mono tabular-nums">
          {formatPercentage(sector().avgChange)}
        </Text>
      </Stack>
      <Group justify="space-between" align="flex-end" gap="xs" wrap="nowrap">
        <Stack gap={2}>
          <Text size="xs" opacity={0.75} className="font-mono tabular-nums">
            Stocks {sector().stockCount}
          </Text>
          <Text size="xs" opacity={0.75} className="font-mono tabular-nums">
            {sector().advances} / {sector().declines}
          </Text>
        </Stack>
        <Show when={index() < 6}>
          <Badge
            size="xs"
            variant="filled"
            color="secondary"
            style={{
              backgroundColor: withAlpha(BLACK, 0.28),
              color: "#ffffff",
            }}
          >
            #{index() + 1}
          </Badge>
        </Show>
      </Group>
    </Box>
  );
}

export function SectorTreemap(props: { sectors: SectorItem[] }) {
  const { isDark } = useColorScheme();

  const treemapData = createMemo(() =>
    buildTreemapData(props.sectors).map((sector) => ({
      ...sector,
      itemStyle: { color: getSectorColor(sector.avgChange), gapWidth: 0 },
    })),
  );

  return (
    <Box
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gridAutoRows: "minmax(72px, auto)",
        gap: "8px",
        height: "100%",
        minHeight: "320px",
      }}
    >
      <For each={treemapData()}>
        {(sector, index) => (
          <TreemapTile
            sector={sector}
            index={index()}
            span={getTileSpan(index())}
            isDark={isDark()}
          />
        )}
      </For>
    </Box>
  );
}
