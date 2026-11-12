import { NEGATIVE, POSITIVE } from "@/ui/palette";
import { Box, Text } from "@/ui";
import { TanStackTable, type TableColumnDef } from "@/components/common/TanStackTable";
import { withAlpha } from "@/utils/color";
import { formatPercentage, getPnLTextColor } from "@/utils/ui-helpers";
import type { RotationPeriod, RotationRow } from "@/types/rotation";

const PERIODS: RotationPeriod[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"];

function heatBackground(value: number): string {
  const intensity = Math.min(Math.abs(value) / 12, 1) * 0.2;
  return withAlpha(value >= 0 ? POSITIVE : NEGATIVE, intensity);
}

export interface RotationMatrixProps {
  rows: RotationRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function RotationMatrix(props: RotationMatrixProps) {
  const columns: TableColumnDef<RotationRow>[] = [
    {
      id: "group",
      header: "Group",
      accessorFn: (row) => row.name,
      size: 180,
      meta: { align: "left" },
      cell: ({ row }) => (
        <Text truncate className="text-[10.5px] font-semibold leading-[1.15]">
          {row.original.name}
        </Text>
      ),
    },
    ...PERIODS.map<TableColumnDef<RotationRow>>((period) => ({
      id: period,
      header: period,
      accessorFn: (row) => row.returns[period],
      size: 64,
      meta: { align: "right" },
      cell: ({ row }) => {
        const value = row.original.returns[period];
        return (
          <Box
            className="flex items-center justify-end min-h-[14px] px-[2px] rounded-[0.5px]"
            style={{ backgroundColor: heatBackground(value) }}
          >
            <Text
              c={getPnLTextColor(value)}
              className="font-mono text-[10px] font-semibold tabular-nums leading-none"
            >
              {formatPercentage(value, 1, true)}
            </Text>
          </Box>
        );
      },
    })),
  ];

  return (
    <Box
      data-testid="rotation-matrix"
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      <TanStackTable<RotationRow>
        data={props.rows}
        columns={columns}
        dataTestId="rotation-matrix-table"
        initialState={{ sorting: [{ id: "1M", desc: true }] }}
        onRowClick={(row) => props.onSelect(row.id)}
        stickyHeader
        fillContainer
        dense
        minTableWidth={700}
        getRowTestId={(row) => `rotation-matrix-row-${row.id}`}
        getRowStyle={(row) =>
          row.id === props.selectedId
            ? {
                background: "rgba(88, 166, 255, 0.12)",
                boxShadow: "inset 2px 0 0 var(--color-fin-primary)",
              }
            : undefined
        }
        getRowAttributes={(row) => ({
          dataActive: row.id === props.selectedId ? "true" : undefined,
        })}
      />
    </Box>
  );
}
