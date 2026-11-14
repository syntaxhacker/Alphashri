import { createMemo, createSignal, For, Show } from "solid-js";
import { Badge, Chip, SegmentedControl, ToolbarRow } from "@/ui";
import { CompactPanel } from "@/components/common/compact";
import { BadgeCell, NumCell, SymbolCell, TextCell } from "@/components/common/tableCells";
import { TanStackTable, type TableColumnDef } from "@/components/common/TanStackTable";
import { LocalSymbolAvatar, LocalSparkline } from "./reportBits";
import { ReportPanelTitle } from "./reportCells";
import type { BreakoutRow, BreakoutSide } from "../../types/report";
import { formatCurrency, formatPercentage } from "../../utils/ui-helpers";

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
  /** Symbols the scan inspected. Printed once, on the scan's primary table —
   * the date/universe already live in the identity band, so this panel never
   * re-prints them. */
  scanned?: number;
  /** Override for the scanned badge id (the page owns the historic
   * `report-breakouts-scanned` name). */
  scannedTestId?: string;
  /** Renders the scan-level spark-range control in this panel's header. Only
   * one panel may own it — two controls would be two sources of truth for the
   * same view switch. */
  showSparkRange?: boolean;
  onSparkRangeChange?: (range: "intraday" | "5d") => void;
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

export function ReportBreakoutTable(props: ReportBreakoutTableProps) {
  const side = () => props.side;
  const testId = () => props.testId;
  const emptyMessage = () => props.emptyMessage ?? "No breakouts today";
  const sparkRange = () => props.sparkRange ?? "intraday";
  const direction = () => props.direction;
  const scanned = () => props.scanned;
  const scannedTestId = () => props.scannedTestId ?? `${testId()}-scanned`;
  const showSparkRange = () => props.showSparkRange ?? false;
  const [typeFilter, setTypeFilter] = createSignal<string>("all");

  const rows = createMemo(() => {
    const all = side()?.rows ?? [];
    const sorted = [...all].sort((a, b) => b.pct_above - a.pct_above);
    const filter = typeFilter();
    if (filter === "all") return sorted;
    return sorted.filter((r) => r.type === filter);
  });

  const byType = () => side()?.by_type ?? {};

  const columns = createMemo<TableColumnDef<BreakoutRow>[]>(
    () => [
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "symbol",
        meta: { align: "left" },
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div class="flex items-center gap-2 min-w-0">
              <LocalSymbolAvatar symbol={r.symbol} name={r.name} size={20} />
              <SymbolCell symbol={r.symbol} name={r.name} />
            </div>
          );
        },
      },
      {
        id: "type",
        header: "Type",
        accessorKey: "type",
        meta: { align: "center" },
        cell: ({ row }) => (
          <BadgeCell label={typeLabel(row.original.type)} color={typeColor(row.original.type, direction())} />
        ),
      },
      {
        id: "level",
        header: "Level",
        accessorKey: "level",
        meta: { align: "right" },
        cell: ({ row }) => (
          <NumCell value={row.original.level} format={(v) => formatCurrency(v, 2)} />
        ),
      },
      {
        id: "close",
        header: "Close",
        accessorKey: "close",
        meta: { align: "right" },
        cell: ({ row }) => (
          <NumCell value={row.original.close} format={(v) => formatCurrency(v, 2)} />
        ),
      },
      {
        id: "pct_above",
        header: "% Above",
        accessorKey: "pct_above",
        meta: { align: "right" },
        cell: ({ row }) => (
          <NumCell
            value={row.original.pct_above}
            format={formatPercentage}
            tone={direction() === "up" ? "success" : "error"}
          />
        ),
      },
      {
        id: "volume_ratio",
        header: "Vol ×",
        accessorKey: "volume_ratio",
        meta: { align: "right" },
        cell: ({ row }) => (
          <NumCell value={row.original.volume_ratio} format={(v) => `${v.toFixed(1)}x`} />
        ),
      },
      {
        id: "change",
        header: "Chg %",
        accessorKey: "change",
        meta: { align: "right" },
        cell: ({ row }) => (
          <NumCell value={row.original.change} signed format={formatPercentage} />
        ),
      },
      {
        id: "to_52w_high",
        header: () => (
          <span title="Percent below the 52-week high. Positive means still under the high; negative means above it.">
            52W gap %
          </span>
        ),
        accessorKey: "to_52w_high",
        meta: { align: "right" },
        cell: ({ row }) => (
          <NumCell value={row.original.to_52w_high} format={formatPercentage} />
        ),
      },
      {
        id: "sector",
        header: "Sector",
        accessorKey: "sector",
        meta: { align: "left" },
        cell: ({ row }) => <TextCell value={row.original.sector} dimmed />,
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
            sparkRange() === "5d" && Array.isArray(r.daily_closes) && r.daily_closes.length > 0
              ? normalizeDailyCloses(r.daily_closes)
              : (r.spark ?? []);
          return <LocalSparkline data={data} change={r.change} width={64} height={20} />;
        },
      },
    ],
  );

  const filterKeys = () => ["all", ...Object.keys(byType())];

  return (
    <CompactPanel
      flush
      scrollable
      testId={`${testId()}-section`}
      title={
        <div class="flex items-center gap-2 min-w-0">
          <ReportPanelTitle testId={`${testId()}-title`}>{props.title}</ReportPanelTitle>
          <Badge size="xs" data-testid={`${testId()}-count`}>
            {side()?.count ?? 0}
          </Badge>
          <Show when={scanned() != null}>
            <span data-testid="report-breakouts-meta" class="flex items-center gap-2 min-w-0">
              <Badge size="xs" data-testid={scannedTestId()}>
                {scanned()} scanned
              </Badge>
            </span>
          </Show>
          <ToolbarRow gap={4} wrap={false} data-testid={`${testId()}-filters`} className="ml-2 min-w-0">
            <For each={filterKeys()}>
              {(key) => (
                <Chip
                  size="xs"
                  checked={typeFilter() === key}
                  onChange={() => setTypeFilter(key)}
                  data-testid={`${testId()}-filter-${key}`}
                >
                  {key === "all" ? `All (${side()?.count ?? 0})` : `${typeLabel(key)} (${byType()[key] ?? 0})`}
                </Chip>
              )}
            </For>
          </ToolbarRow>
        </div>
      }
      action={
        <Show when={showSparkRange()}>
          <SegmentedControl
            size="xs"
            value={sparkRange()}
            onChange={(v) => props.onSparkRangeChange?.(v === "5d" ? "5d" : "intraday")}
            data={[
              { value: "intraday", label: "Intraday" },
              { value: "5d", label: "5D" },
            ]}
            data-testid="report-spark-range"
          />
        </Show>
      }
    >
      {/* Bare table: the panel's own border would be a second card, and the
          shared container's minHeight floor leaves dead space under small
          result sets. The table scrolls its own overflow (9 columns wide). */}
      <div class="min-w-0 w-full overflow-hidden">
        <TanStackTable
          data={rows()}
          columns={columns()}
          dataTestId={testId()}
          emptyMessage={emptyMessage()}
          stickyHeader
          bare
          dense
          initialState={{ sorting: [{ id: "pct_above", desc: true }] }}
          onRowClick={props.onOpenSymbol ? (row) => props.onOpenSymbol!(row.symbol) : undefined}
          getRowTestId={(row) => `${testId()}-row-${row.symbol}`}
        />
      </div>
    </CompactPanel>
  );
}
