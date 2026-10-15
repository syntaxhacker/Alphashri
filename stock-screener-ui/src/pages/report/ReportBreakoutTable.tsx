import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Box, Chip, Text, ToolbarRow } from "@/ui";
import { BORDER, SURFACE } from "@/ui/palette";
import { TanStackTable } from "@/components/common/TanStackTable";
import { SymbolAvatar } from "../../components/screener/SymbolAvatar";
import { Sparkline } from "../../components/screener/Sparkline";
import type { BreakoutRow, BreakoutSide } from "../../types/report";
import { formatCurrency, formatPercentage, getPnLTextColor } from "../../utils/ui-helpers";

export const BREAKOUT_TYPE_LABELS: Record<string, string> = {
  "52w_high": "52W High",
  base_20: "Base 20D",
  base_50: "Base 50D",
  base_100: "Base 100D",
  gap: "Gap",
};

function typeLabel(type: string): string {
  return BREAKOUT_TYPE_LABELS[type] ?? type;
}

function typeColor(type: string, direction: "up" | "down"): "success" | "error" | "warning" | "info" | "secondary" | "primary" {
  if (direction === "down") return "error";
  switch (type) {
    case "52w_high":
      return "success";
    case "gap":
      return "warning";
    case "base_20":
      return "info";
    case "base_50":
      return "primary";
    default:
      return "secondary";
  }
}

interface ReportBreakoutTableProps {
  title: string;
  side: BreakoutSide | null;
  direction: "up" | "down";
  testId: string;
  onOpenSymbol?: (symbol: string) => void;
  emptyMessage?: string;
  /** Spark source: intraday payload spark (0..1) or 5-day daily-close spark
   * derived client-side from `daily_closes` (min-max normalized). Rows without
   * daily closes always keep the payload spark. */
  sparkRange?: "intraday" | "5d";
}

function normalizeDailyCloses(closes: number[] | undefined): number[] {
  const vals = (Array.isArray(closes) ? closes : []).filter(
    (c): c is number => typeof c === "number" && Number.isFinite(c),
  );
  if (vals.length === 0) return [];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (hi <= lo) return vals.map(() => 0.5);
  const span = hi - lo;
  return vals.map((c) => (c - lo) / span);
}

export function ReportBreakoutTable({
  title,
  side,
  direction,
  testId,
  onOpenSymbol,
  emptyMessage = "No breakouts today",
  sparkRange = "intraday",
}: ReportBreakoutTableProps) {
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const rows = useMemo(() => {
    const all = side?.rows ?? [];
    const sorted = [...all].sort((a, b) => b.pct_above - a.pct_above);
    if (typeFilter === "all") return sorted;
    return sorted.filter((r) => r.type === typeFilter);
  }, [side, typeFilter]);

  const byType = side?.by_type ?? {};

  const columns = useMemo<ColumnDef<BreakoutRow>[]>(
    () => [
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "symbol",
        meta: { align: "left" },
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
              <SymbolAvatar symbol={r.symbol} name={r.name} size={20} />
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
          <Badge size="xs" color={typeColor(row.original.type, direction)}>
            {typeLabel(row.original.type)}
          </Badge>
        ),
      },
      {
        id: "level",
        header: "Level",
        accessorKey: "level",
        meta: { align: "right" },
        cell: ({ row }) => (
          <Text size="xs" span sx={{ fontVariantNumeric: "tabular-nums" }}>
            {formatCurrency(row.original.level, 2)}
          </Text>
        ),
      },
      {
        id: "close",
        header: "Close",
        accessorKey: "close",
        meta: { align: "right" },
        cell: ({ row }) => (
          <Text size="xs" span sx={{ fontVariantNumeric: "tabular-nums" }}>
            {formatCurrency(row.original.close, 2)}
          </Text>
        ),
      },
      {
        id: "pct_above",
        header: "% Above",
        accessorKey: "pct_above",
        meta: { align: "right" },
        cell: ({ row }) => (
          <Text size="xs" c={direction === "up" ? "success" : "error"} span sx={{ fontVariantNumeric: "tabular-nums" }}>
            {formatPercentage(row.original.pct_above)}
          </Text>
        ),
      },
      {
        id: "volume_ratio",
        header: "Vol ×",
        accessorKey: "volume_ratio",
        meta: { align: "right" },
        cell: ({ row }) => {
          const v = row.original.volume_ratio;
          return (
            <Text size="xs" span sx={{ fontVariantNumeric: "tabular-nums" }}>
              {typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)}x` : "—"}
            </Text>
          );
        },
      },
      {
        id: "change",
        header: "Chg %",
        accessorKey: "change",
        meta: { align: "right" },
        cell: ({ row }) => (
          <Text size="xs" c={getPnLTextColor(row.original.change)} span sx={{ fontVariantNumeric: "tabular-nums" }}>
            {formatPercentage(row.original.change)}
          </Text>
        ),
      },
      {
        id: "to_52w_high",
        header: "52W gap %",
        accessorKey: "to_52w_high",
        meta: { align: "right" },
        cell: ({ row }) => {
          const v = row.original.to_52w_high;
          return (
            <Text size="xs" c={getPnLTextColor(-(v ?? 0))} span sx={{ fontVariantNumeric: "tabular-nums" }}>
              {typeof v === "number" && Number.isFinite(v) ? formatPercentage(v) : "—"}
            </Text>
          );
        },
      },
      {
        id: "sector",
        header: "Sector",
        accessorKey: "sector",
        meta: { align: "left" },
        cell: ({ row }) => (
          <Text size="xs" c="dimmed" truncate span>
            {row.original.sector || "—"}
          </Text>
        ),
      },
      {
        id: "spark",
        header: "Trend",
        accessorKey: "spark",
        meta: { align: "center" },
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original;
          const data =
            sparkRange === "5d" && Array.isArray(r.daily_closes) && r.daily_closes.length > 0
              ? normalizeDailyCloses(r.daily_closes)
              : (r.spark ?? []);
          return <Sparkline data={data} change={r.change} width={64} height={20} />;
        },
      },
    ],
    [direction, sparkRange],
  );

  const filterKeys = ["all", ...Object.keys(byType)];

  return (
    <Box data-testid={`${testId}-section`} sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
      <ToolbarRow gap={8} wrap={false}>
        <Text size="sm" fw={700} span data-testid={`${testId}-title`}>
          {title}
        </Text>
        <Badge size="xs" data-testid={`${testId}-count`}>
          {side?.count ?? 0}
        </Badge>
        <Box sx={{ flex: 1, minWidth: 0 }} />
      </ToolbarRow>
      <ToolbarRow gap={4} wrap data-testid={`${testId}-filters`}>
        {filterKeys.map((key) => (
          <Chip
            key={key}
            size="xs"
            checked={typeFilter === key}
            onChange={() => setTypeFilter(key)}
            data-testid={`${testId}-filter-${key}`}
          >
            {key === "all" ? `All (${side?.count ?? 0})` : `${typeLabel(key)} (${byType[key] ?? 0})`}
          </Chip>
        ))}
      </ToolbarRow>
      {/* Bare table in a single bordered wrapper: the shared container's
          minHeight floor leaves ~100px of dead space under small result sets. */}
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
          initialState={{ sorting: [{ id: "pct_above", desc: true }] }}
          onRowClick={onOpenSymbol ? (row) => onOpenSymbol(row.symbol) : undefined}
          getRowTestId={(row) => `${testId}-row-${row.symbol}`}
        />
      </Box>
    </Box>
  );
}
