import { createMemo } from "solid-js";
import { Badge, Text, ToolbarRow } from "@/ui";
import { BadgeCell, NumCell, SymbolCell } from "@/components/common/tableCells";
import { TanStackTable, type TableColumnDef } from "@/components/common/TanStackTable";
import type { FollowThroughRow, FollowThroughSide } from "../../types/report";
import { formatCurrency, formatPercentage } from "../../utils/ui-helpers";
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

export function ReportFollowThroughTable(props: ReportFollowThroughTableProps) {
  const side = () => props.side;
  const testId = () => props.testId;
  const emptyMessage = () => props.emptyMessage ?? "No follow-through rows";
  const rows = createMemo(() => {
    const all = side()?.rows ?? [];
    return [...all].sort((a, b) => b.ret_pct - a.ret_pct);
  });

  const columns = createMemo<TableColumnDef<FollowThroughRow>[]>(
    () => [
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "symbol",
        meta: { align: "left" },
        cell: ({ row }) => (
          <SymbolCell symbol={row.original.symbol} name={row.original.name} />
        ),
      },
      {
        id: "type",
        header: "Type",
        accessorKey: "type",
        meta: { align: "center" },
        cell: ({ row }) => (
          <BadgeCell
            label={typeLabel(row.original.type)}
            color={row.original.ret_pct >= 0 ? "success" : "error"}
          />
        ),
      },
      {
        id: "ref_close",
        header: "Ref close",
        accessorKey: "ref_close",
        meta: { align: "right" },
        cell: ({ row }) => (
          <NumCell value={row.original.ref_close} format={(v) => formatCurrency(v, 2)} />
        ),
      },
      {
        id: "last_close",
        header: "Last",
        accessorKey: "last_close",
        meta: { align: "right" },
        cell: ({ row }) => (
          <NumCell value={row.original.last_close} format={(v) => formatCurrency(v, 2)} />
        ),
      },
      {
        id: "ret_pct",
        header: "Ret %",
        accessorKey: "ret_pct",
        meta: { align: "right" },
        cell: ({ row }) => (
          <NumCell value={row.original.ret_pct} signed format={formatPercentage} />
        ),
      },
      {
        id: "max_fav_pct",
        header: "Max fav %",
        accessorKey: "max_fav_pct",
        meta: { align: "right" },
        cell: ({ row }) => (
          <NumCell value={row.original.max_fav_pct} signed format={formatPercentage} />
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
  );

  return (
    <div data-testid={`${testId()}-section`} class="flex flex-col gap-2 min-w-0">
      <ToolbarRow gap={8} wrap={false}>
        <Text size="sm" fw={700} span data-testid={`${testId()}-title`}>
          {props.title}
        </Text>
        <Badge size="xs" data-testid={`${testId()}-count`}>
          {side()?.count ?? 0}
        </Badge>
        <Text size="xs" c="dimmed" span data-testid={`${testId()}-summary`} className="font-mono tabular-nums">
          {formatSummary(side(), props.emptyNote)}
        </Text>
        <div class="flex-1 min-w-0" />
      </ToolbarRow>
      <div
        class="min-w-0 w-full overflow-hidden border border-fin-border rounded-[1px] bg-fin-surface"
      >
        <TanStackTable
          data={rows()}
          columns={columns()}
          dataTestId={testId()}
          emptyMessage={emptyMessage()}
          stickyHeader
          bare
          dense
          initialState={{ sorting: [{ id: "ret_pct", desc: true }] }}
          onRowClick={props.onOpenSymbol ? (row) => props.onOpenSymbol!(row.symbol) : undefined}
          getRowTestId={(row) => `${testId()}-row-${row.symbol}`}
        />
      </div>
    </div>
  );
}
