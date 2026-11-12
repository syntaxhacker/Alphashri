import { Show } from "solid-js";
import { Box, Text } from "@/ui";
import { TanStackTable, type TableColumnDef } from "@/components/common/TanStackTable";
import { formatPercentage, getPnLTextColor } from "@/utils/ui-helpers";
import type { RotationPeriod, RotationRow, RotationStatus } from "@/types/rotation";
import { ROTATION_STATUS_COLORS_BOARD, ROTATION_STATUS_LABELS } from "./rotationStatus";

const BOARD_PERIODS: RotationPeriod[] = ["1D", "1W", "1M"];

function Return(props: { value: number; strong?: boolean }) {
  return (
    <Text
      c={getPnLTextColor(props.value)}
      className="font-mono text-[10.5px] tabular-nums leading-none"
      style={{ "font-weight": props.strong ? 700 : 600 }}
    >
      {formatPercentage(props.value, 2, true)}
    </Text>
  );
}

function Num(props: { value: number; suffix?: string; color: string }) {
  return (
    <Text
      c={props.color}
      className="font-mono text-[10.5px] font-semibold tabular-nums leading-none"
    >
      {props.value.toFixed(2)}
      {props.suffix}
    </Text>
  );
}

function Status(props: { status: RotationStatus }) {
  const info = () => ROTATION_STATUS_COLORS_BOARD[props.status];
  const label = () => ROTATION_STATUS_LABELS[props.status].short;
  return (
    <Box className="inline-flex items-center justify-center gap-1">
      <Box className="size-[5px] rounded-full shrink-0" style={{ "background-color": info() }} />
      <Text className="text-[9px] font-bold tracking-[0.4px]" style={{ color: info() }}>{label()}</Text>
    </Box>
  );
}

export interface RotationBoardProps {
  rows: RotationRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  period: RotationPeriod;
}

export function RotationBoard(props: RotationBoardProps) {
  const columns: TableColumnDef<RotationRow>[] = [
    {
      id: "group",
      header: "Group",
      accessorFn: (row) => row.name,
      size: 190,
      meta: { align: "left" },
      cell: ({ row }) => (
        <Text
          truncate
          title={`${row.original.category || row.original.kind} · ${row.original.quadrant} · ${row.original.members} members`}
          className="text-[10.5px] font-semibold leading-[1.15]"
        >
          {row.original.name}
        </Text>
      ),
    },
    ...BOARD_PERIODS.map<TableColumnDef<RotationRow>>((p) => ({
      id: p,
      header: p,
      accessorFn: (row) => row.returns[p],
      size: 64,
      meta: { align: "right" },
      cell: ({ row }) => <Return value={row.original.returns[p]} strong={p === "1M"} />,
    })),
    {
      id: "rs",
      header: "RS",
      accessorKey: "rs_1m",
      size: 60,
      meta: { align: "right" },
      cell: ({ row }) => <Num value={row.original.rs_1m} color={getPnLTextColor(row.original.rs_1m)} />,
    },
    {
      id: "delta",
      header: "ΔR",
      accessorKey: "rank_delta",
      size: 52,
      meta: { align: "right" },
      cell: ({ row }) => {
        const delta = row.original.rank_delta;
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
      cell: ({ row }) => {
        const breadth = row.original.breadth;
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
      cell: ({ row }) => {
        const volume = row.original.rel_volume;
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
      cell: ({ row }) => <Status status={row.original.status} />,
    },
  ];

  return (
    <Box
      data-testid="rotation-board"
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      {/* keyed Show re-creates the table when the period flips so the 1M default sort re-applies */}
      <Show when={props.period} keyed>
        {(period) => (
          <TanStackTable<RotationRow>
            data={props.rows}
            columns={columns}
            dataTestId="rotation-board-table"
            initialState={{ sorting: [{ id: BOARD_PERIODS.includes(period) ? period : "1M", desc: true }] }}
            onRowClick={(row) => props.onSelect(row.id)}
            stickyHeader
            fillContainer
            dense
            minTableWidth={760}
            getRowTestId={(row) => `rotation-row-${row.id}`}
            getRowStyle={(row) =>
              row.id === props.selectedId
                ? {
                    background: "rgba(88, 166, 255, 0.12)",
                    "box-shadow": "inset 2px 0 0 var(--color-fin-primary)",
                  }
                : undefined
            }
            getRowAttributes={(row) => ({
              "data-active": row.id === props.selectedId ? "true" : undefined,
            })}
          />
        )}
      </Show>
    </Box>
  );
}
