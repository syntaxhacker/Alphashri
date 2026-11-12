import { useMemo } from "react";
import { Text, Badge, Progress, Box } from "@/ui";
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
    <Box className="flex w-[70px] items-center justify-center">
      <Progress value={capped} color={color} size="sm" radius="xl" />
    </Box>
  );
}

function TopMoversCell({ text }: { text: string }) {
  const parts = Array.from(text.matchAll(/([A-Za-z0-9&._-]+)\(([+-]?\d+(?:\.\d+)?%)\)/g));
  if (parts.length === 0) {
    return (
      <Text size="xs" c="dimmed" lineClamp={1}>
        {text}
      </Text>
    );
  }
  return (
    <Box className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
      {parts.map((part) => {
        const symbol = part[1];
        const raw = part[2];
        return (
          <Text key={`${symbol}-${raw}`} span className="text-[10px]">
            <Box component="span" className="text-fin-text-muted">
              {symbol}
            </Box>
            <Box component="span" style={{ color: getPnLTextColor(parseFloat(raw)), "font-weight": 600 }}>
              ({raw})
            </Box>
          </Text>
        );
      })}
    </Box>
  );
}

export function SectorTable({ sectors }: SectorTableProps) {
  const columns = useMemo<ColumnDef<SectorItem>[]>(
    () => [
      {
        id: "sector",
        header: () => <Box className="flex items-center justify-start">Sector</Box>,
        accessorKey: "sector",
        meta: { align: "left" },
        size: 170,
        cell: (info) => <Box className="flex items-center justify-start text-[11px] font-semibold">{info.getValue<string>()}</Box>,
      },
      {
        id: "avg_change",
        header: () => <Box className="flex items-center justify-end">Change</Box>,
        accessorKey: "avg_change",
        meta: { align: "right" },
        size: 72,
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <Box className="flex items-center justify-end font-semibold tabular-nums text-[10.5px]" style={{ color: getPnLTextColor(val) }}>
              {val >= 0 ? "+" : ""}
              {val.toFixed(2)}%
            </Box>
          );
        },
      },
      {
        id: "movement",
        header: () => <Box className="flex items-center justify-center">Move</Box>,
        accessorKey: "avg_change",
        meta: { align: "center" },
        size: 88,
        cell: (info) => <Box className="flex items-center justify-center">{getMovementBar(info.getValue<number>())}</Box>,
      },
      {
        id: "ad_ratio",
        header: () => <Box className="flex items-center justify-end">A/D</Box>,
        accessorFn: (row) => `${row.advances} : ${row.declines}`,
        meta: { align: "right" },
        size: 76,
        cell: (info) => {
          const row = info.row.original;
          const adColor = row.advances > row.declines ? "success" : row.advances < row.declines ? "error" : "dimmed";
          return (
            <Box className="flex items-center justify-end font-semibold tabular-nums text-[10.5px]" style={{ color: adColor }}>
              {row.advances} : {row.declines}
            </Box>
          );
        },
      },
      {
        id: "strength",
        header: () => <Box className="flex items-center justify-center">ADX</Box>,
        accessorKey: "avg_adx",
        meta: { align: "center" },
        size: 72,
        cell: (info) => {
          const { label, color } = getStrengthInfo(info.getValue<number>());
          return (
            <Box className="flex items-center justify-center">
              <Badge color={color} variant="filled" size="xs">
                {label}
              </Badge>
            </Box>
          );
        },
      },
      {
        id: "top_movers",
        header: () => <Box className="flex items-center justify-start">Top Movers</Box>,
        accessorKey: "top_movers",
        meta: { align: "left" },
        cell: (info) => <TopMoversCell text={info.getValue<string>()} />,
      },
    ],
    [],
  );

  return (
    <TanStackTable<SectorItem>
      data={sectors}
      columns={columns}
      enableSorting={false}
      emptyMessage="No sector data available"
      dataTestId="sector-table"
      getRowTestId={(sector) => `sector-row-${sector.sector.toLowerCase()}`}
      dense
      fillContainer
      rowWindowSize={40}
      style={{ "min-width": "100%" }}
    />
  );
}
