import { useMemo } from "react";
import { Text, Badge, Group, Progress, Box, ScrollArea } from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import type { SectorItem } from "../../types/sector";
import { TanStackTable } from "../common/TanStackTable";
import { getPnLTextColor } from "../../utils/ui-helpers";

interface SectorTableProps {
  sectors: SectorItem[];
}

export function getMovementBarValue(pctChange: number): { capped: number; color: string } {
  const normalized = (pctChange + 3) / 6;
  const capped = Math.max(0, Math.min(1, normalized)) * 100;
  const color = getPnLTextColor(pctChange);
  return { capped, color };
}

export function getStrengthInfo(avgAdx: number): { label: string; color: string } {
  if (avgAdx > 25) return { label: "Strong", color: "green" };
  if (avgAdx < 15) return { label: "Weak", color: "red" };
  return { label: "Neutral", color: "gray" };
}

function getMovementBar(pctChange: number) {
  const { capped, color } = getMovementBarValue(pctChange);

  return (
    <Box w={100}>
      <Progress value={capped} color={color} size="sm" radius="xl" />
    </Box>
  );
}

export function SectorTable({ sectors }: SectorTableProps) {
  const columns = useMemo<ColumnDef<SectorItem>[]>(
    () => [
      {
        id: "sector",
        header: "Sector",
        accessorKey: "sector",
        cell: (info) => <span style={{ fontWeight: 700, fontSize: 13 }}>{info.getValue<string>()}</span>,
      },
      {
        id: "avg_change",
        header: "Change",
        accessorKey: "avg_change",
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <span style={{ color: getPnLTextColor(val), fontWeight: 700, fontSize: 12, textAlign: "right", display: "block" }}>
              {val >= 0 ? "+" : ""}
              {val.toFixed(2)}%
            </span>
          );
        },
      },
      {
        id: "movement",
        header: "Movement",
        accessorKey: "avg_change",
        cell: (info) => <Group justify="center">{getMovementBar(info.getValue<number>())}</Group>,
      },
      {
        id: "ad_ratio",
        header: "A/D Ratio",
        accessorFn: (row) => `${row.advances} : ${row.declines}`,
        cell: (info) => {
          const row = info.row.original;
          const adColor = row.advances > row.declines ? "green" : "red";
          return (
            <span style={{ color: adColor, fontSize: 12, fontWeight: 600, textAlign: "center", display: "block" }}>
              {row.advances} : {row.declines}
            </span>
          );
        },
      },
      {
        id: "strength",
        header: "Strength",
        accessorKey: "avg_adx",
        cell: (info) => {
          const { label, color } = getStrengthInfo(info.getValue<number>());
          return (
            <Group justify="center">
              <Badge color={color} variant="light" size="sm">
                {label}
              </Badge>
            </Group>
          );
        },
      },
      {
        id: "top_movers",
        header: "Top Movers",
        accessorKey: "top_movers",
        cell: (info) => (
          <Text size="sm" c="dimmed" lineClamp={1}>
            {info.getValue<string>()}
          </Text>
        ),
      },
    ],
    [],
  );

  return (
    <ScrollArea h="100%" offsetScrollbars>
      <TanStackTable<SectorItem>
        data={sectors}
        columns={columns}
        enableSorting={false}
        emptyMessage="No sector data available"
        dataTestId="sector-table"
        getRowTestId={(sector) => `sector-row-${sector.sector.toLowerCase()}`}
      />
    </ScrollArea>
  );
}
