import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Text } from "@/ui";
import { TanStackTable } from "@/components/common/TanStackTable";
import { formatCurrency, formatPercentage, getPnLTextColor } from "@/utils/ui-helpers";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { QUALITY_INFO } from "@/config/patternCatalog";
import { StatusBadge } from "./StatusBadge";

export interface PatternListViewProps {
  hits: PatternHitDTO[];
  onSelect: (hit: PatternHitDTO) => void;
  /** Active rail sort — seeds the table's sort so the header matches the rail. */
  sort?: string;
}

/** Rail sort -> the column the table seeds its sort indicator from. */
function sortingFor(sort?: string): { id: string; desc: boolean }[] {
  if (sort === "newest") return [{ id: "bars_ago", desc: false }];
  if (sort === "range_pos") return [{ id: "range_pos", desc: true }];
  if (sort === "breakout") return [{ id: "breakout_score", desc: true }];
  return [{ id: "confidence", desc: true }];
}

/** Latest tradable price for the row (live close, falling back to the pattern end). */
function priceOf(hit: PatternHitDTO): number | null {
  return hit.last_close ?? hit.end_price ?? null;
}

/** Day change when available, otherwise the pattern-window move. */
function changePctOf(hit: PatternHitDTO): number {
  if (hit.day_change_pct != null) return hit.day_change_pct;
  return hit.start_price !== 0 ? ((hit.end_price - hit.start_price) / hit.start_price) * 100 : 0;
}

/** Range percentage with at most one decimal (`13` not `13.0`). */
function gapPct(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Number.isInteger(value) ? String(value) : value.toFixed(1)}%`;
}

/** Compact direction glyph: ▲ bullish / ▼ bearish / ◆ otherwise (value kept in title/aria). */
function DirectionGlyph({ direction }: { direction: string | null | undefined }) {
  const raw = String(direction ?? "—").toLowerCase();
  const glyph = raw === "bullish" ? "▲" : raw === "bearish" ? "▼" : "◆";
  const tone = raw === "bullish" ? "success" : raw === "bearish" ? "error" : "dimmed";
  return (
    <Text size="sm" fw={700} c={tone} title={raw} aria-label={raw} truncate>
      {glyph}
    </Text>
  );
}

/** Compact shape-quality letter: T/S/F/M with the tier color (full label in the title tooltip). */
function QualityGlyph({ quality }: { quality: string | null | undefined }) {
  const key = String(quality ?? "").toLowerCase();
  const info = QUALITY_INFO[key as keyof typeof QUALITY_INFO];
  const label = info?.label ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Unknown");
  const letter = (info?.label ?? label).charAt(0).toUpperCase();
  const tone =
    key === "textbook" ? "success" : key === "strong" ? "primary" : key === "fair" ? "info" : "warning";
  const title = info ? `${info.label}: ${info.description}` : label;
  return (
    <Text
      size="sm"
      fw={700}
      c={tone}
      title={title}
      aria-label={label}
      data-testid={`patterns-quality-${key || "unknown"}`}
      truncate
    >
      {letter}
    </Text>
  );
}

/** Dense scanner table: one row per hit, ~28px rows, no sticky thead (see below). */
export function PatternListView({ hits, onSelect, sort }: PatternListViewProps) {
  const columns = useMemo<ColumnDef<PatternHitDTO>[]>(
    () => [
      {
        id: "symbol",
        header: "Symbol",
        accessorFn: (hit) => hit.symbol,
        size: 110,
        meta: { align: "left" },
        cell: (info) => (
          <Text size="sm" fw={700} truncate>
            {info.getValue<string>()}
          </Text>
        ),
      },
      {
        id: "pattern",
        header: "Pattern",
        accessorFn: (hit) => hit.pattern_name,
        meta: { align: "left" },
        cell: (info) => (
          <Text size="sm" truncate>
            {info.getValue<string>()}
          </Text>
        ),
      },
      {
        id: "confidence",
        header: () => (
          <span title="Pattern-fit confidence (geometry fit, R², volume) — not breakout conviction.">
            Score
          </span>
        ),
        accessorKey: "confidence",
        size: 70,
        meta: { align: "right" },
        cell: (info) => {
          const value = info.getValue<number>();
          return (
            <Text size="sm" fw={600} truncate>
              {value == null ? "—" : value.toFixed(1)}
            </Text>
          );
        },
      },
      {
        id: "breakout_score",
        header: () => (
          <span title="Breakout conviction (range position, pattern fit, status, direction) — higher means closer to breaking out.">
            Breakout
          </span>
        ),
        accessorKey: "breakout_score",
        size: 80,
        meta: { align: "right" },
        cell: (info) => {
          const value = info.getValue<number | null | undefined>();
          return (
            <Text size="sm" fw={600} truncate>
              {value == null ? "—" : Math.round(value).toString()}
            </Text>
          );
        },
      },
      {
        id: "direction",
        header: "Dir",
        accessorFn: (hit) => hit.direction,
        size: 44,
        meta: { align: "center" },
        cell: (info) => <DirectionGlyph direction={info.getValue<string>()} />,
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        size: 110,
        meta: { align: "center" },
        cell: (info) => <StatusBadge status={info.row.original.status} />,
      },
      {
        id: "quality",
        header: "Q",
        accessorKey: "quality",
        size: 44,
        meta: { align: "center" },
        cell: (info) => <QualityGlyph quality={info.row.original.quality} />,
      },
      {
        id: "gap52w",
        header: "52W gap %",
        accessorFn: (hit) => hit.to_52w_high,
        size: 90,
        meta: { align: "right" },
        cell: (info) => {
          const value = info.getValue<number | null>();
          return (
            <Text size="sm" truncate>
              {gapPct(value)}
            </Text>
          );
        },
      },
      {
        id: "range_pos",
        header: "Pos %",
        accessorKey: "range_pos",
        size: 70,
        meta: { align: "right" },
        cell: (info) => {
          const value = info.getValue<number | null | undefined>();
          return (
            <Text size="sm" truncate>
              {value == null ? "—" : `${Math.round(value)}%`}
            </Text>
          );
        },
      },
      {
        id: "bars_ago",
        header: "Bars ago",
        accessorKey: "bars_ago",
        size: 80,
        meta: { align: "right" },
      },
      {
        id: "price",
        header: "Price",
        accessorFn: priceOf,
        size: 100,
        meta: { align: "right" },
        cell: (info) => {
          const value = info.getValue<number | null>();
          return (
            <Text size="sm" fw={600} truncate>
              {value == null ? "—" : formatCurrency(value, 2)}
            </Text>
          );
        },
      },
      {
        id: "chg",
        header: "Chg %",
        accessorFn: changePctOf,
        size: 90,
        meta: { align: "right" },
        cell: (info) => {
          const value = info.getValue<number>();
          return (
            <Text size="sm" c={getPnLTextColor(value)} truncate>
              {formatPercentage(value, 2)}
            </Text>
          );
        },
      },
    ],
    [],
  );

  return (
    <TanStackTable
      data={hits}
      columns={columns}
      dataTestId="patterns-list"
      // No sticky thead: the merged universe/results toolbar above is sticky
      // (`top: 0`, higher z) and would cover a `top: 0` thead while scrolling.
      stickyHeader={false}
      // Seed the header sort indicator from the active rail sort; the parent
      // remounts (key=sort) so changing the rail re-seeds it. Sort keys match
      // the server ordering (confidence desc / bars_ago asc / range_pos desc /
      // breakout_score desc).
      initialState={{ sorting: sortingFor(sort) }}
      onRowClick={onSelect}
      getRowTestId={(hit) =>
        `patterns-list-row-${hit.symbol}-${hit.pattern_id}${hit.id != null ? `-${hit.id}` : ""}`
      }
    />
  );
}
