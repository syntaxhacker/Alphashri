import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Box, Text } from "@/ui";
import { TanStackTable } from "@/components/common/TanStackTable";
import { formatPercentage, getPnLTextColor } from "@/utils/ui-helpers";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { fullscreenDedupeKey } from "@/hooks/usePatternFullscreen";
import { QUALITY_INFO } from "@/config/patternCatalog";
import { SymbolLink } from "@/components/common/SymbolLink";
import { hasIndexMembers } from "@/config/indexGroups";
import { MembersButton } from "./MembersButton";
import { StatusBadge } from "./StatusBadge";
import { displayStatusForHit } from "./patternDisplayStatus";
import { triggerDistancePct } from "./triggerDistance";
import { directionGlyph, directionTone } from "./symbolMatrix";
import { qualityBadgeTone, qualityLabel } from "./patternTone";
import { formatPrice } from "./shared";
import { formatSignedPct1, hitChangePct } from "./patternFormat";
import { PatternTags, rowTags } from "./rowBadges";

export interface PatternListViewProps {
  hits: PatternHitDTO[];
  onSelect: (hit: PatternHitDTO) => void;
  onShowMembers?: (symbol: string) => void;
  /** Active rail sort — seeds the table's sort so the header matches the rail. */
  sort?: string;
  /** Hit currently shown in the docked chart — highlighted in the table. */
  activeHit?: PatternHitDTO | null;
  /** Emits the rows in rendered (post-sort) order for prev/next navigation. */
  onOrderChange?: (hits: PatternHitDTO[]) => void;
  /** Hover intent for the right-side symbol preview (host debounces). */
  onSymbolPreview?: (symbol: string) => void;
  onSymbolPreviewEnd?: (symbol: string) => void;
  /** Chart icon: open the symbol in the right-side chart. */
  onSymbolOpen?: (symbol: string) => void;
}

/** Rail sort -> the column the table seeds its sort indicator from. */
function sortingFor(sort?: string): { id: string; desc: boolean }[] {
  if (sort === "newest") return [{ id: "bars_ago", desc: false }];
  if (sort === "range_pos") return [{ id: "range_pos", desc: true }];
  if (sort === "breakout") return [{ id: "breakout_score", desc: true }];
  // `distance` is client-ordered by absolute distance in `sortStreamedHits`;
  // seed no header sort so the table keeps that order.
  if (sort === "distance") return [];
  return [{ id: "confidence", desc: true }];
}

/** Latest tradable price for the row (live close, falling back to the pattern end). */
function priceOf(hit: PatternHitDTO): number | null {
  return hit.last_close ?? hit.end_price ?? null;
}

/** Range percentage with at most one decimal (`13` not `13.0`). */
function gapPct(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Number.isInteger(value) ? String(value) : value.toFixed(1)}%`;
}

/** Compact direction glyph: ▲ bullish / ▼ bearish / ◆ otherwise (value kept in title/aria). */
function DirectionGlyph({ direction }: { direction: string | null | undefined }) {
  const raw = String(direction ?? "—").toLowerCase();
  return (
    <Text
      size="sm"
      fw={700}
      c={directionTone(direction)}
      title={raw}
      aria-label={raw}
      truncate
    >
      {directionGlyph(direction)}
    </Text>
  );
}

/** Compact shape-quality letter: T/S/F/M with the tier color (full label in the title tooltip). */
function QualityGlyph({ quality }: { quality: string | null | undefined }) {
  const key = String(quality ?? "").toLowerCase();
  const info = QUALITY_INFO[key as keyof typeof QUALITY_INFO];
  const label = qualityLabel(quality);
  const letter = label.charAt(0).toUpperCase();
  const tone = qualityBadgeTone(quality);
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
export function PatternListView({
  hits,
  onSelect,
  onShowMembers,
  sort,
  activeHit = null,
  onOrderChange,
  onSymbolPreview,
  onSymbolPreviewEnd,
  onSymbolOpen,
}: PatternListViewProps) {
  const activeKey = activeHit ? fullscreenDedupeKey(activeHit) : null;
  const columns = useMemo<ColumnDef<PatternHitDTO>[]>(
    () => [
      {
        id: "symbol",
        header: "Symbol",
        accessorFn: (hit) => hit.symbol,
        size: 134,
        meta: { align: "left" },
        cell: (info) => {
          const symbol = info.getValue<string>();
          const canShowMembers = Boolean(onShowMembers && hasIndexMembers(symbol));
          return (
            <Box className="flex min-w-0 items-center gap-[2px]">
              <SymbolLink
                symbol={symbol}
                testId={`patterns-list-tv-${symbol}`}
                chartTestId={`patterns-list-chart-${symbol}`}
                onOpen={onSymbolOpen}
                onPreview={onSymbolPreview}
                onPreviewEnd={onSymbolPreviewEnd}
                className="flex-1"
              />
              {/* Results are equities, so only the F&O badge is shown — an ETF
                  tag is tolerated (no crash) but never rendered. */}
              <PatternTags
                tags={rowTags(info.row.original)}
                symbol={symbol}
                testIdPrefix="patterns-list"
                showEtf={false}
                compact
              />
              {canShowMembers ? (
                <MembersButton
                  symbol={symbol}
                  testId={`patterns-list-members-${symbol}`}
                  onShowMembers={onShowMembers}
                />
              ) : null}
            </Box>
          );
        },
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
        cell: (info) => (
          <StatusBadge
            status={info.row.original.status}
            display={displayStatusForHit(info.row.original)}
          />
        ),
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
              {formatPrice(value)}
            </Text>
          );
        },
      },
      {
        id: "chg",
        header: "Chg %",
        accessorFn: hitChangePct,
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
      {
        id: "to_trigger",
        header: "To trigger",
        accessorFn: (hit) =>
          hit.pattern_id === "consolidation" || (hit.base_days ?? 0) > 0
            ? triggerDistancePct(hit)
            : null,
        size: 100,
        meta: { align: "right" },
        cell: (info) => {
          const distance = info.getValue<number | null>();
          const text = formatSignedPct1(distance);
          const tone = distance == null ? "text.disabled" : distance > 0 ? "success" : "text.secondary";
          return (
            <Text size="sm" fw={600} c={tone} truncate>
              {text}
            </Text>
          );
        },
      },
    ],
    [onShowMembers, onSymbolOpen, onSymbolPreview, onSymbolPreviewEnd],
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
      onSortedRowsChange={onOrderChange}
      getRowStyle={(hit) =>
        activeKey && fullscreenDedupeKey(hit) === activeKey
          ? {
              background: "rgba(88, 166, 255, 0.12)",
              "box-shadow": "inset 3px 0 0 var(--color-fin-primary)",
            }
          : undefined
      }
      getRowAttributes={(hit) => ({
        "data-active":
          activeKey && fullscreenDedupeKey(hit) === activeKey ? "true" : undefined,
      })}
      getRowTestId={(hit) =>
        `patterns-list-row-${hit.symbol}-${hit.pattern_id}${hit.id != null ? `-${hit.id}` : ""}`
      }
    />
  );
}
