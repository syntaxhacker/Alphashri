import { createMemo, Show } from "solid-js";
import { Box, Text } from "@/ui";
import { alpha, PRIMARY } from "@/ui/palette";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import { TanStackTable } from "@/components/common/TanStackTable";
import { BadgeCell, NumCell, TextCell } from "@/components/common";
import { formatPercentage } from "@/utils/ui-helpers";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { fullscreenDedupeKey } from "@/utils/patterns/fullscreenKey";
import { QUALITY_INFO } from "@/config/patternCatalog";
import { SymbolLink } from "@/components/common/SymbolLink";
import { hasIndexMembers } from "@/config/indexGroups";
import { MembersButton } from "./MembersButton";
import { displayStatusForHit } from "./patternDisplayStatus";
import { triggerDistancePct } from "./triggerDistance";
import { directionGlyph, directionTone } from "./symbolMatrix";
import { qualityBadgeTone, qualityLabel } from "./patternTone";
import { formatChartPrice } from "./chartFormat";
import { formatSignedPct1, hitChangePct } from "./patternFormat";
import { PatternTags, rowTags } from "./rowBadges";

export interface PatternListViewProps {
  hits: PatternHitDTO[];
  onSelect: (hit: PatternHitDTO) => void;
  onShowMembers?: (symbol: string) => void;
  sort?: string;
  activeHit?: PatternHitDTO | null;
  /** Emits the rows in rendered (post-sort) order for prev/next navigation. */
  onOrderChange?: (hits: PatternHitDTO[]) => void;
  onSymbolPreview?: (symbol: string) => void;
  onSymbolPreviewEnd?: (symbol: string) => void;
  onSymbolOpen?: (symbol: string) => void;
}

function sortingFor(sort?: string): { id: string; desc: boolean }[] {
  if (sort === "newest") return [{ id: "bars_ago", desc: false }];
  if (sort === "range_pos") return [{ id: "range_pos", desc: true }];
  if (sort === "breakout") return [{ id: "breakout_score", desc: true }];
  // `distance` is client-ordered by absolute distance in `sortStreamedHits`;
  // seed no header sort so the table keeps that order.
  if (sort === "distance") return [];
  return [{ id: "confidence", desc: true }];
}

function priceOf(hit: PatternHitDTO): number | null {
  return hit.last_close ?? hit.end_price ?? null;
}

function gapPct(value: number): string {
  return `${Number.isInteger(value) ? String(value) : value.toFixed(1)}%`;
}

function StatusCell(props: { hit: PatternHitDTO }) {
  const display = () => displayStatusForHit(props.hit);
  const label = () => {
    const raw = display().label;
    return raw.charAt(0) + raw.slice(1).toLowerCase();
  };
  return (
    <BadgeCell
      label={label()}
      color={display().tone === "neutral" ? "default" : display().tone}
      title={display().tooltip}
      testId={`patterns-status-${String(props.hit.status ?? "").toLowerCase() || "unknown"}`}
    />
  );
}

/** Compact direction glyph: ▲ bullish / ▼ bearish / ◆ otherwise (value kept in title/aria). */
function DirectionGlyph(props: { direction: string | null | undefined }) {
  const raw = () => String(props.direction ?? "—").toLowerCase();
  return (
    <Text
      fw={700}
      c={directionTone(props.direction)}
      title={raw()}
      aria-label={raw()}
      truncate
    >
      {directionGlyph(props.direction)}
    </Text>
  );
}

function QualityGlyph(props: { quality: string | null | undefined }) {
  const key = () => String(props.quality ?? "").toLowerCase();
  const info = () => QUALITY_INFO[key() as keyof typeof QUALITY_INFO];
  const label = () => qualityLabel(props.quality);
  const letter = () => label().charAt(0).toUpperCase();
  const tone = () => qualityBadgeTone(props.quality);
  const title = () => (info() ? `${info()!.label}: ${info()!.description}` : label());
  return (
    <Text
      fw={700}
      c={tone()}
      title={title()}
      aria-label={label()}
      data-testid={`patterns-quality-${key() || "unknown"}`}
      truncate
    >
      {letter()}
    </Text>
  );
}

export function PatternListView(props: PatternListViewProps) {
  // Resolved once per active change: each row used to re-join the docked hit's
  // identity three times, so a highlight move rebuilt 200×3 keys for nothing.
  const activeKey = createMemo(() => (props.activeHit ? fullscreenDedupeKey(props.activeHit) : null));

  // A hit's identity fields are immutable, so join each row once and reuse the
  // key across the style and attribute callbacks for that instance's lifetime.
  const rowKeyCache = new WeakMap<PatternHitDTO, string>();
  const rowKey = (hit: PatternHitDTO): string => {
    let key = rowKeyCache.get(hit);
    if (key === undefined) {
      key = fullscreenDedupeKey(hit);
      rowKeyCache.set(hit, key);
    }
    return key;
  };

  const columns: TableColumnDef<PatternHitDTO>[] = [
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      size: 176,
      meta: { align: "left" },
      cell: (ctx) => {
        const hit = ctx.row.original;
        const symbol = hit.symbol;
        const canShowMembers = Boolean(props.onShowMembers && hasIndexMembers(symbol));
        return (
          // Not the kit's `SymbolCell`: this identity column also carries the
          // TradingView link, hover preview, F&O tag and members trigger.
          <Box className="flex min-w-0 items-center gap-[2px]">
            <SymbolLink
              symbol={symbol}
              testId={`patterns-list-tv-${symbol}`}
              chartTestId={`patterns-list-chart-${symbol}`}
              onOpen={props.onSymbolOpen}
              onPreview={props.onSymbolPreview}
              onPreviewEnd={props.onSymbolPreviewEnd}
              size="xs"
              weight={600}
              className="flex-1"
            />
            <PatternTags
              tags={rowTags(hit)}
              symbol={symbol}
              testIdPrefix="patterns-list"
              showEtf={false}
              compact
            />
            <Show when={canShowMembers}>
              <MembersButton
                symbol={symbol}
                testId={`patterns-list-members-${symbol}`}
                onShowMembers={props.onShowMembers}
              />
            </Show>
          </Box>
        );
      },
    },
    {
      id: "pattern",
      header: "Pattern",
      accessorKey: "pattern_name",
      size: 210,
      meta: { align: "left" },
      cell: (ctx) => (
        <TextCell value={ctx.row.original.pattern_name} title={ctx.row.original.pattern_name ?? undefined} />
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
      cell: (ctx) => (
        <NumCell value={ctx.row.original.confidence} format={(v) => v.toFixed(1)} fw={600} />
      ),
    },
    {
      id: "breakout_score",
      header: () => (
        <span title="Breakout conviction from the pattern scan — distinct from fit confidence.">
          BO
        </span>
      ),
      accessorKey: "breakout_score",
      size: 52,
      meta: { align: "right" },
      cell: (ctx) => (
        <NumCell value={ctx.row.original.breakout_score} signed format={(v) => v.toFixed(1)} />
      ),
    },
    {
      id: "direction",
      header: "Dir",
      accessorKey: "direction",
      size: 44,
      meta: { align: "center" },
      cell: (ctx) => <DirectionGlyph direction={ctx.row.original.direction} />,
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      size: 110,
      meta: { align: "center" },
      cell: (ctx) => <StatusCell hit={ctx.row.original} />,
    },
    {
      id: "quality",
      header: "Q",
      accessorKey: "quality",
      size: 44,
      meta: { align: "center" },
      cell: (ctx) => <QualityGlyph quality={ctx.row.original.quality} />,
    },
    {
      id: "gap52w",
      header: "52W gap %",
      accessorFn: (hit) => hit.to_52w_high,
      size: 90,
      meta: { align: "right" },
      cell: (ctx) => <NumCell value={ctx.row.original.to_52w_high} format={gapPct} />,
    },
    {
      id: "range_pos",
      header: "Pos %",
      accessorKey: "range_pos",
      size: 70,
      meta: { align: "right" },
      cell: (ctx) => (
        <NumCell value={ctx.row.original.range_pos} format={(v) => `${Math.round(v)}%`} />
      ),
    },
    {
      id: "bars_ago",
      header: "Bars ago",
      accessorKey: "bars_ago",
      size: 80,
      meta: { align: "right" },
      cell: (ctx) => <NumCell value={ctx.row.original.bars_ago} />,
    },
    {
      id: "price",
      header: "Price",
      accessorFn: priceOf,
      size: 100,
      meta: { align: "right" },
      cell: (ctx) => <NumCell value={priceOf(ctx.row.original)} format={formatChartPrice} fw={600} />,
    },
    {
      id: "chg",
      header: "Chg %",
      accessorFn: hitChangePct,
      size: 90,
      meta: { align: "right" },
      cell: (ctx) => (
        <NumCell value={hitChangePct(ctx.row.original)} signed format={formatPercentage} />
      ),
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
      cell: (ctx) => {
        const distance =
          ctx.row.original.pattern_id === "consolidation" || (ctx.row.original.base_days ?? 0) > 0
            ? triggerDistancePct(ctx.row.original)
            : null;
        return (
          <NumCell
            value={distance}
            format={(v) => formatSignedPct1(v)}
            fw={600}
            tone={distance != null && distance > 0 ? "success" : "dimmed"}
          />
        );
      },
    },
  ];

  return (
    <Show when={props.sort || "default"} keyed>
      <TanStackTable
        data={props.hits}
        columns={columns}
        dataTestId="patterns-list"
        dense
        fillContainer
        stickyHeader={false}
        // Sort keys match the server ordering (confidence desc / bars_ago asc /
        // range_pos desc / breakout_score desc).
        initialState={{ sorting: sortingFor(props.sort) }}
        onRowClick={props.onSelect}
        onSortedRowsChange={props.onOrderChange}
        getRowStyle={(hit) => {
          const key = activeKey();
          return key && rowKey(hit) === key
            ? {
                "background-color": alpha(PRIMARY, 0.12),
                "box-shadow": `inset 3px 0 0 ${PRIMARY}`,
              }
            : undefined;
        }}
        getRowAttributes={(hit) => {
          const key = activeKey();
          return { "data-active": key && rowKey(hit) === key ? "true" : undefined };
        }}
        getRowTestId={(hit) =>
          `patterns-list-row-${hit.symbol}-${hit.pattern_id}${hit.id != null ? `-${hit.id}` : ""}`
        }
      />
    </Show>
  );
}
