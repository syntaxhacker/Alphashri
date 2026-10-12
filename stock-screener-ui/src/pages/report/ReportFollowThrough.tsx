import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Box, Text, ToolbarRow } from "@/ui";
import { BORDER, SURFACE } from "@/ui/palette";
import { TanStackTable } from "@/components/common/TanStackTable";
import type { FollowThroughRow, FollowThroughSide } from "../../types/report";
import { formatCurrency, formatPercentage, getPnLTextColor } from "../../utils/ui-helpers";
import { BREAKOUT_TYPE_LABELS } from "./ReportBreakoutTable";

function typeLabel(type: string): string {
  return BREAKOUT_TYPE_LABELS[type] ?? type;
}

function formatSummary(side: FollowThroughSide | null | undefined, emptyNote?: string): string {
  if (!side) return "";
  if ((side.count ?? 0) === 0) return emptyNote ?? "";
  const rows = side.rows ?? [];
  // No session has elapsed since the reference date (e.g. report date is the
  // latest completed session): nothing to win/lose yet.
  if (rows.length > 0 && rows.every((r) => (r.ret_pct ?? 0) === 0)) {
    return "Awaiting next session";
  }
  return `${side.winners}W / ${side.losers}L · avg ${formatPercentage(side.avg_ret)}`;
}

interface ReportFollowThroughTableProps {
  title: string;
  side: FollowThroughSide | null;
  testId: string;
  onOpenSymbol?: (symbol: string) => void;
  emptyMessage?: string;
  /** Shown in the header summary when there are no rows (e.g. the source date). */
  emptyNote?: string;
}

export function ReportFollowThroughTable({
  title,
  side,
  testId,
  onOpenSymbol,
  emptyMessage = "No follow-through rows",
  emptyNote,
}: ReportFollowThroughTableProps) {
  const rows = useMemo(() => {
    const all = side?.rows ?? [];
    return [...all].sort((a, b) => b.ret_pct - a.ret_pct);
  }, [side]);

  const columns = useMemo<ColumnDef<FollowThroughRow>[]>(
    () => [
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "symbol",
        meta: { align: "left" },
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
              <Text size="xs" fw={700} truncate span>
                {r.symbol}
              </Text>
              {r.name ? (
                <Text size="xs" c="dimmed" truncate span>
                  {r.name}
                </Text>
              ) : null}
            </Box>
          );
        },
      },
      {
        id: "type",
        header: "Type",
        accessorKey: "type",
        meta: { align: "center" },
        cell: ({ row }) => (
          <Badge size="xs" color={row.original.ret_pct >= 0 ? "success" : "error"}>
            {typeLabel(row.original.type)}
          </Badge>
        ),
      },
      {
        id: "ref_close",
        header: "Ref close",
        accessorKey: "ref_close",
        meta: { align: "right" },
        cell: ({ row }) => (
          <Text size="xs" span sx={{ fontVariantNumeric: "tabular-nums" }}>
            {formatCurrency(row.original.ref_close, 2)}
          </Text>
        ),
      },
      {
        id: "last_close",
        header: "Last",
        accessorKey: "last_close",
        meta: { align: "right" },
        cell: ({ row }) => (
          <Text size="xs" span sx={{ fontVariantNumeric: "tabular-nums" }}>
            {formatCurrency(row.original.last_close, 2)}
          </Text>
        ),
      },
      {
        id: "ret_pct",
        header: "Ret %",
        accessorKey: "ret_pct",
        meta: { align: "right" },
        cell: ({ row }) => (
          <Text size="xs" c={getPnLTextColor(row.original.ret_pct)} span sx={{ fontVariantNumeric: "tabular-nums" }}>
            {formatPercentage(row.original.ret_pct)}
          </Text>
        ),
      },
      {
        id: "max_fav_pct",
        header: "Max fav %",
        accessorKey: "max_fav_pct",
        meta: { align: "right" },
        cell: ({ row }) => (
          <Text size="xs" c={getPnLTextColor(row.original.max_fav_pct)} span sx={{ fontVariantNumeric: "tabular-nums" }}>
            {formatPercentage(row.original.max_fav_pct)}
          </Text>
        ),
      },
      {
        id: "held",
        header: "Held",
        accessorKey: "held",
        meta: { align: "center" },
        cell: ({ row }) => (
          <Text size="xs" c={row.original.held ? "success" : "error"} span>
            {row.original.held ? "✓" : "✗"}
          </Text>
        ),
      },
    ],
    [],
  );

  return (
    <Box data-testid={`${testId}-section`} sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
      <ToolbarRow gap={8} wrap={false}>
        <Text size="sm" fw={700} span data-testid={`${testId}-title`}>
          {title}
        </Text>
        <Badge size="xs" data-testid={`${testId}-count`}>
          {side?.count ?? 0}
        </Badge>
        <Text size="xs" c="dimmed" span data-testid={`${testId}-summary`} sx={{ fontVariantNumeric: "tabular-nums" }}>
          {formatSummary(side, emptyNote)}
        </Text>
        <Box sx={{ flex: 1, minWidth: 0 }} />
      </ToolbarRow>
      <Box
        sx={{
          minWidth: 0,
          width: "100%",
          overflow: "hidden",
          border: 1,
          borderColor: BORDER,
          borderRadius: 1,
          bgcolor: SURFACE,
        }}
      >
        <TanStackTable
          data={rows}
          columns={columns}
          dataTestId={testId}
          emptyMessage={emptyMessage}
          stickyHeader
          bare
          initialState={{ sorting: [{ id: "ret_pct", desc: true }] }}
          onRowClick={onOpenSymbol ? (row) => onOpenSymbol(row.symbol) : undefined}
          getRowTestId={(row) => `${testId}-row-${row.symbol}`}
        />
      </Box>
    </Box>
  );
}
