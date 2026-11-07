import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Box, Text } from "@/ui";
import { MONO, NEGATIVE, POSITIVE } from "@/ui/palette";
import { TanStackTable } from "@/components/common/TanStackTable";
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

export function RotationMatrix({ rows, selectedId, onSelect }: RotationMatrixProps) {
  const columns = useMemo<ColumnDef<RotationRow>[]>(
    () => [
      {
        id: "group",
        header: "Group",
        accessorFn: (row) => row.name,
        size: 180,
        meta: { align: "left" },
        cell: (info) => (
          <Text truncate sx={{ fontSize: 10.5, fontWeight: 600, lineHeight: 1.15 }}>
            {info.getValue<string>()}
          </Text>
        ),
      },
      ...PERIODS.map<ColumnDef<RotationRow>>((period) => ({
        id: period,
        header: period,
        accessorFn: (row) => row.returns[period],
        size: 64,
        meta: { align: "right" },
        cell: (info) => {
          const value = info.getValue<number>();
          return (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                minHeight: 14,
                px: 0.25,
                borderRadius: 0.5,
                bgcolor: heatBackground(value),
              }}
            >
              <Text
                c={getPnLTextColor(value)}
                sx={{
                  fontFamily: MONO,
                  fontSize: 10,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                }}
              >
                {formatPercentage(value, 1, true)}
              </Text>
            </Box>
          );
        },
      })),
    ],
    [],
  );

  return (
    <Box
      data-testid="rotation-matrix"
      sx={{ display: "flex", flexDirection: "column", flex: 1, height: "100%", minHeight: 0 }}
    >
      <TanStackTable<RotationRow>
        data={rows}
        columns={columns}
        dataTestId="rotation-matrix-table"
        initialState={{ sorting: [{ id: "1M", desc: true }] }}
        onRowClick={(row) => onSelect(row.id)}
        stickyHeader
        fillContainer
        dense
        minTableWidth={700}
        getRowTestId={(row) => `rotation-matrix-row-${row.id}`}
        getRowStyle={(row) =>
          row.id === selectedId
            ? {
                background: "var(--mui-palette-action-selected)",
                boxShadow: "inset 2px 0 0 var(--mui-palette-primary-main)",
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
