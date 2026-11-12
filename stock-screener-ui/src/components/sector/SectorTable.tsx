import { For, Show } from "solid-js";
import { Text, Badge, Progress, Box } from "@/ui";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import type { SectorItem } from "../../types/sector";
import { TanStackTable } from "../common/TanStackTable";
import { getPnLTextColor } from "../../utils/ui-helpers";
import { POSITIVE, NEGATIVE, TEXT_MUTED } from "@/ui/palette";

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

function TopMoversCell(props: { text: string }) {
  const parts = () => Array.from(props.text.matchAll(/([A-Za-z0-9&._-]+)\(([+-]?\d+(?:\.\d+)?%)\)/g));

  return (
    <Show when={parts().length > 0} fallback={
      <Text size="xs" c="dimmed" lineClamp={1}>
        {props.text}
      </Text>
    }>
      <Box className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
        <For each={parts()}>
          {(part) => {
            const symbol = part[1];
            const raw = part[2];
            return (
              <Text span className="text-[10px] font-mono tabular-nums">
                <Box component="span" className="text-fin-text-muted">
                  {symbol}
                </Box>
                <Box component="span" style={{ color: getPnLTextColor(parseFloat(raw)) === "success" ? POSITIVE : NEGATIVE, fontWeight: 600 }}>
                  ({raw})
                </Box>
              </Text>
            );
          }}
        </For>
      </Box>
    </Show>
  );
}

export function SectorTable(props: SectorTableProps) {
  const columns: TableColumnDef<SectorItem>[] = [
    {
      id: "sector",
      header: () => <Box className="flex items-center justify-start">Sector</Box>,
      accessorKey: "sector",
      meta: { align: "left" },
      size: 170,
      cell: ({ row }) => <Box className="flex items-center justify-start text-[11px] font-semibold">{row.original.sector}</Box>,
    },
    {
      id: "avg_change",
      header: () => <Box className="flex items-center justify-end">Change</Box>,
      accessorKey: "avg_change",
      meta: { align: "right" },
      size: 72,
      cell: ({ row }) => {
        const val = row.original.avg_change;
        return (
          <Box
            className="flex items-center justify-end font-semibold tabular-nums font-mono text-[10.5px]"
            style={{ color: getPnLTextColor(val) === "success" ? POSITIVE : NEGATIVE }}
          >
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
      cell: ({ row }) => <Box className="flex items-center justify-center">{getMovementBar(row.original.avg_change)}</Box>,
    },
    {
      id: "ad_ratio",
      header: () => <Box className="flex items-center justify-end">A/D</Box>,
      accessorFn: (row) => `${row.advances} : ${row.declines}`,
      meta: { align: "right" },
      size: 76,
      cell: ({ row }) => {
        const adColor = row.original.advances > row.original.declines
          ? POSITIVE
          : row.original.advances < row.original.declines
            ? NEGATIVE
            : TEXT_MUTED;
        return (
          <Box className="flex items-center justify-end font-semibold tabular-nums font-mono text-[10.5px]" style={{ color: adColor }}>
            {row.original.advances} : {row.original.declines}
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
      cell: ({ row }) => {
        const { label, color } = getStrengthInfo(row.original.avg_adx);
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
      cell: ({ row }) => <TopMoversCell text={row.original.top_movers} />,
    },
  ];

  return (
    <TanStackTable<SectorItem>
      data={props.sectors}
      columns={columns}
      enableSorting={false}
      emptyMessage="No sector data available"
      dataTestId="sector-table"
      getRowTestId={(sector) => `sector-row-${sector.sector.toLowerCase()}`}
      dense
      fillContainer
      rowWindowSize={40}
      style={{ minWidth: "100%" }}
    />
  );
}
