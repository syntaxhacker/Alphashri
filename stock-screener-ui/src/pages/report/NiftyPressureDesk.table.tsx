import * as palette from "@/ui/palette";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import { TanStackTable } from "@/components/common/TanStackTable";
import {
  SELECTED,
  statusColor,
} from "./NiftyPressureDesk.format";
import { FuelBar, SideMark } from "./NiftyPressureDesk.legend";
import { fmtOI, fmtPct, flowLabel } from "./niftyWallsFormat";
import {
  confidenceOf,
  flowText,
  wallLabel,
  type PressureWall,
} from "./pressureDesk";

function pressureColumns(): TableColumnDef<PressureWall>[] {
  return [
    {
      id: "wall",
      header: "WALL",
      accessorFn: (wall) => wallLabel(wall.side, wall.strike),
      cell: ({ row }) => (
        <div class="flex items-center gap-1">
          <SideMark side={row.original.side} />
          <span>{wallLabel(row.original.side, row.original.strike)}</span>
        </div>
      ),
      meta: { align: "left" },
      size: 118,
    },
    {
      id: "oi",
      header: "OI",
      accessorFn: (wall) => wall.row.oi,
      cell: ({ row }) => fmtOI(row.original.row.oi),
      meta: { align: "right" },
      size: 62,
    },
    {
      id: "open",
      header: "OPEN",
      accessorFn: (wall) => wall.row.oi_open ?? 0,
      cell: ({ row }) => fmtOI(row.original.row.oi_open),
      meta: { align: "right" },
      size: 62,
    },
    {
      id: "oi5",
      header: "5m OI",
      accessorFn: (wall) => wall.row.erosion_5m ?? 0,
      cell: ({ row }) => fmtPct(row.original.row.erosion_5m),
      meta: { align: "right" },
      size: 56,
    },
    {
      id: "oi15",
      header: "15m OI",
      accessorFn: (wall) => wall.row.erosion_15m ?? 0,
      cell: ({ row }) => fmtPct(row.original.row.erosion_15m),
      meta: { align: "right" },
      size: 58,
    },
    {
      id: "oi30",
      header: "30m OI",
      accessorFn: (wall) => wall.row.erosion_30m ?? 0,
      cell: ({ row }) => fmtPct(row.original.row.erosion_30m),
      meta: { align: "right" },
      size: 60,
    },
    {
      id: "prem5",
      header: "5m PREM",
      accessorFn: (wall) => wall.row.prem_chg_5m ?? 0,
      cell: ({ row }) => fmtPct(row.original.row.prem_chg_5m),
      meta: { align: "right" },
      size: 62,
    },
    {
      id: "prem15",
      header: "15m PREM",
      accessorFn: (wall) => wall.row.prem_chg_15m ?? 0,
      cell: ({ row }) => fmtPct(row.original.row.prem_chg_15m),
      meta: { align: "right" },
      size: 66,
    },
    {
      id: "prem30",
      header: "30m PREM",
      accessorFn: (wall) => wall.row.prem_chg_30m ?? 0,
      cell: ({ row }) => fmtPct(row.original.row.prem_chg_30m),
      meta: { align: "right" },
      size: 66,
    },
    {
      id: "fuel",
      header: "FUEL",
      accessorFn: (wall) => wall.row.fuel_score ?? 0,
      cell: ({ row }) => (
        <div class="flex items-center justify-end gap-1">
          <FuelBar score={row.original.row.fuel_score} width={38} />
          <span>{row.original.row.fuel_score ?? "—"}</span>
        </div>
      ),
      meta: { align: "right" },
      size: 72,
    },
    {
      id: "flow",
      header: "FLOW 5m",
      accessorFn: (wall) => flowLabel(wall.row.flow),
      cell: ({ row }) => flowText(row.original.row.flow),
      meta: { align: "left" },
      size: 88,
    },
    {
      id: "conf",
      header: "CONF",
      accessorFn: (wall) => confidenceOf(wall.row).level,
      cell: ({ row }) => confidenceOf(row.original.row).level,
      meta: { align: "center" },
      size: 52,
    },
    {
      id: "status",
      header: "STATUS",
      accessorFn: (wall) => wall.row.status ?? "",
      cell: ({ row }) => <span style={{ color: statusColor(row.original.row.status) }}>{row.original.row.status ?? "—"}</span>,
      meta: { align: "center" },
      size: 76,
    },
  ];
}

export function PressureTable(props: {
  walls: PressureWall[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const columns = pressureColumns();
  return (
    <div class="h-[218px] min-w-0">
      <TanStackTable<PressureWall>
        data={props.walls}
        columns={columns}
        dataTestId="pressure-desk-table"
        ariaLabel="Pressure desk wall values"
        dense
        fillContainer
        minTableWidth={1050}
        onRowClick={(wall) => props.onSelect(wall.key)}
        getRowClassName={(wall) => (wall.key === props.selectedKey ? "pressure-row-selected" : undefined)}
        getRowStyle={(wall) =>
          wall.key === props.selectedKey
            ? { background: palette.SURFACE_ALT, "box-shadow": `inset 2px 0 0 ${SELECTED}` }
            : undefined
        }
        getRowTestId={(wall) => `pressure-table-${wall.key}`}
      />
    </div>
  );
}
