import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Box, Text } from "@/ui";
import { TanStackTable } from "@/components/common/TanStackTable";
import { formatPercentage, getPnLTextColor } from "@/utils/ui-helpers";
import type { RotationPeriod, RotationRow, RotationStatus } from "@/types/rotation";
import { ROTATION_STATUS_COLORS_BOARD, ROTATION_STATUS_LABELS } from "./rotationStatus";

const BOARD_PERIODS: RotationPeriod[] = ["1D", "1W", "1M"];

function Return({ value, strong = false }: { value: number; strong?: boolean }) {
  return (
    <Text
      c={getPnLTextColor(value)}
      className="font-mono text-[10.5px] tabular-nums leading-none"
      style={{ "font-weight": strong ? 700 : 600 }}
    >
      {formatPercentage(value, 2, true)}
    </Text>
  );
}

function Num({ value, suffix = "", color }: { value: number; suffix?: string; color: string }) {
  return (
    <Text
      c={color}
      className="font-mono text-[10.5px] font-semibold tabular-nums leading-none"
    >
      {value.toFixed(2)}
      {suffix}
    </Text>
  );
}

function Status({ status }: { status: RotationStatus }) {
  const info = ROTATION_STATUS_COLORS_BOARD[status];
  const label = ROTATION_STATUS_LABELS[status].short;
  return (
    <Box className="inline-flex items-center justify-center gap-1">
      <Box className="size-[5px] rounded-full shrink-0" style={{ "background-color": info }} />
      <Text className="text-[9px] font-bold tracking-[0.4px]" style={{ color: info }}>{label}</Text>
    </Box>
  );
}

export interface RotationBoardProps {
  rows: RotationRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  period: RotationPeriod;
}

export function RotationBoard({ rows, selectedId, onSelect, period }: RotationBoardProps) {
  const columns = useMemo<ColumnDef<RotationRow>[]>(
    () => [
      {
        id: "group",
        header: "Group",
        accessorFn: (row) => row.name,
        size: 190,
        meta: { align: "left" },
        cell: (info) => (
          <Text
            truncate
            title={`${info.row.original.category || info.row.original.kind} · ${info.row.original.quadrant} · ${info.row.original.members} members`}
            className="text-[10.5px] font-semibold leading-[1.15]"
          >
            {info.getValue<string>()}
          </Text>
        ),
      },
      ...BOARD_PERIODS.map<ColumnDef<RotationRow>>((p) => ({
        id: p,
        header: p,
        accessorFn: (row) => row.returns[p],
        size: 64,
        meta: { align: "right" },
        cell: (info) => <Return value={info.getValue<number>()} strong={p === "1M"} />,
      })),
      {
        id: "rs",
        header: "RS",
        accessorKey: "rs_1m",
        size: 60,
        meta: { align: "right" },
        cell: (info) => <Num value={info.getValue<number>()} color={getPnLTextColor(info.getValue<number>())} />,
      },
      {
        id: "delta",
        header: "ΔR",
        accessorKey: "rank_delta",
        size: 52,
        meta: { align: "right" },
        cell: (info) => {
          const delta = info.getValue<number>();
          return (
            <Text
              c={delta > 0 ? "success" : delta < 0 ? "error" : "dimmed"}
              className="font-mono text-[10.5px] font-semibold tabular-nums"
            >
              {delta > 0 ? `+${delta}` : delta}
            </Text>
          );
        },
      },
      {
        id: "breadth",
        header: "BR",
        accessorKey: "breadth",
        size: 52,
        meta: { align: "right" },
        cell: (info) => {
          const breadth = info.getValue<number>();
          return (
            <Text
              c={breadth >= 55 ? "success" : breadth <= 45 ? "error" : "dimmed"}
              className="font-mono text-[10.5px] font-semibold tabular-nums"
            >
              {breadth.toFixed(0)}%
            </Text>
          );
        },
      },
      {
        id: "volume",
        header: "Vol",
        accessorKey: "rel_volume",
        size: 56,
        meta: { align: "right" },
        cell: (info) => {
          const volume = info.getValue<number>();
          return (
            <Text
              c={volume >= 1.2 ? "success" : "dimmed"}
              className="font-mono text-[10.5px] font-semibold tabular-nums"
            >
              {volume.toFixed(1)}x
            </Text>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        size: 84,
        meta: { align: "center" },
        cell: (info) => <Status status={info.getValue<RotationStatus>()} />,
      },
    ],
    [],
  );

  const initialSortId = BOARD_PERIODS.includes(period) ? period : "1M";

  return (
    <Box
      data-testid="rotation-board"
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      <TanStackTable<RotationRow>
        key={period}
        data={rows}
        columns={columns}
        dataTestId="rotation-board-table"
        initialState={{ sorting: [{ id: initialSortId, desc: true }] }}
        onRowClick={(row) => onSelect(row.id)}
        stickyHeader
        fillContainer
        dense
        minTableWidth={760}
        getRowTestId={(row) => `rotation-row-${row.id}`}
        getRowStyle={(row) =>
          row.id === selectedId
            ? {
                background: "rgba(88, 166, 255, 0.12)",
                "box-shadow": "inset 2px 0 0 var(--color-fin-primary)",
              }
            : undefined
        }
        getRowAttributes={(row) => ({
          "data-active": row.id === selectedId ? "true" : undefined,
        })}
      />
    </Box>
  );
}
