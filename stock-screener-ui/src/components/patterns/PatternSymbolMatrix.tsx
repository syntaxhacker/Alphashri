import { createMemo, For, Show } from "solid-js";
import { alpha } from "@/ui/alpha";
import { Box, Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { TableColumnDef } from "@/components/common/TanStackTable";
import { TanStackTable } from "@/components/common/TanStackTable";
import { NumCell } from "@/components/common";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { SymbolLink } from "@/components/common/SymbolLink";
import { hasIndexMembers } from "@/config/indexGroups";
import { MembersButton } from "./MembersButton";
import { PatternScrollRegion } from "./PatternScrollRegion";
import {
  directionGlyph,
  directionTone,
  formatTfLabel,
  isFresherHit,
  matrixTfOrder,
  type MatrixCell,
  type PatternMatrixRow,
} from "./symbolMatrix";
import { formatMatrixPct, formatMatrixPrice, formatRangePos, formatScore } from "./patternFormat";
import { changeTextTone, textToneChartColor } from "./patternTone";

export interface PatternSymbolMatrixProps {
  rows: PatternMatrixRow[];
  timeframes: string[];
  onSelect: (hit: PatternHitDTO) => void;
  onShowMembers?: (symbol: string) => void;
  loading?: boolean;
  emptyMessage?: string;
  activeSymbol?: string | null;
  /** Emits the rows in rendered (post-sort) order for prev/next navigation. */
  onRowsChange?: (rows: PatternMatrixRow[]) => void;
  onSymbolPreview?: (symbol: string) => void;
  onSymbolPreviewEnd?: (symbol: string) => void;
  onSymbolOpen?: (symbol: string) => void;
}

const MAX_CHIPS = 8;
// Sized numeric columns already carry their values at 390px; the extra width
// keeps the unsized chip column from collapsing into a mid-word clip.
const MIN_MATRIX_WIDTH = 720;
const MIN_COLUMN_WIDTH = 76;

interface PreparedChips {
  shown: PatternHitDTO[];
  extra: number;
}

const EMPTY_CHIPS: PreparedChips = { shown: [], extra: 0 };

const STATUS_RANK: Record<string, number> = { confirmed: 0, forming: 1, failed: 2, marginal: 2 };
const DIRECTION_RANK: Record<string, number> = { bullish: 0, bearish: 1, neutral: 2 };

function compareConviction(a: PatternHitDTO, b: PatternHitDTO): number {
  const confA = a.confidence ?? Number.NEGATIVE_INFINITY;
  const confB = b.confidence ?? Number.NEGATIVE_INFINITY;
  if (confA !== confB) return confB - confA;
  return (a.bars_ago ?? Number.POSITIVE_INFINITY) - (b.bars_ago ?? Number.POSITIVE_INFINITY);
}

function rank(map: Record<string, number>, value: unknown): number {
  return map[String(value ?? "").toLowerCase()] ?? 3;
}

function sortHits(hits: PatternHitDTO[]): PatternHitDTO[] {
  // Decorate once: the original comparator recomputed lowercased ranks on every
  // pairwise comparison, which dominated rows with many chips.
  return hits
    .map((hit, index) => ({
      hit,
      index,
      status: rank(STATUS_RANK, hit.status),
      direction: rank(DIRECTION_RANK, hit.direction),
      confidence: hit.confidence ?? 0,
    }))
    .sort(
      (a, b) =>
        a.status - b.status ||
        a.direction - b.direction ||
        b.confidence - a.confidence ||
        a.index - b.index,
    )
    .map((entry) => entry.hit);
}

/** Render/build counters for the matrix perf work. Every render/memo rebuild
 *  bumps the matching counter so tests can assert that columns/cells are not
 *  rebuilt when only callback identity changes. */
export interface MatrixRenderStats {
  matrixRenders: number;
  columnsBuilds: number;
  visibleRowsBuilds: number;
  symbolCellRenders: number;
  tfGlyphRenders: number;
  patternChipRenders: number;
  numTextRenders: number;
}

const matrixStats: MatrixRenderStats = {
  matrixRenders: 0,
  columnsBuilds: 0,
  visibleRowsBuilds: 0,
  symbolCellRenders: 0,
  tfGlyphRenders: 0,
  patternChipRenders: 0,
  numTextRenders: 0,
};

export function matrixRenderStats(): Readonly<MatrixRenderStats> {
  // Copy so callers can take before/after snapshots without aliasing the live counters.
  return { ...matrixStats };
}

export function matrixRenderStatsReset(): void {
  for (const key of Object.keys(matrixStats) as Array<keyof MatrixRenderStats>) {
    matrixStats[key] = 0;
  }
}

/** Numeric cell with the matrix render counter kept for the perf suite. */
function NumText(props: {
  value: number | null | undefined;
  format: (value: number) => string;
  tone?: "success" | "error" | "dimmed" | "default";
}) {
  matrixStats.numTextRenders += 1;
  return <NumCell value={props.value} format={props.format} tone={props.tone} fw={600} />;
}

/**
 * Not the kit's `SymbolCell`: this identity column also carries the hover
 * preview, the chart icon and the index-members trigger under its own
 * `patterns-matrix-*` test ids.
 */
function SymbolCell(props: {
  row: PatternMatrixRow;
  onShowMembers?: (symbol: string) => void;
  onSymbolPreview?: (symbol: string) => void;
  onSymbolPreviewEnd?: (symbol: string) => void;
  onSymbolOpen?: (symbol: string) => void;
}) {
  matrixStats.symbolCellRenders += 1;
  const row = () => props.row;
  const canShowMembers = () => Boolean(props.onShowMembers && hasIndexMembers(row().symbol));
  return (
    <Box className="min-w-0">
      <Box className="flex min-w-0 items-center gap-[2px]">
        <SymbolLink
          symbol={row().symbol}
          testId={`patterns-matrix-tv-${row().symbol}`}
          chartTestId={`patterns-matrix-chart-${row().symbol}`}
          onOpen={props.onSymbolOpen}
          onPreview={props.onSymbolPreview}
          onPreviewEnd={props.onSymbolPreviewEnd}
          size="xs"
          weight={700}
          className="flex-1"
        />
        <Show when={canShowMembers()}>
          <MembersButton
            symbol={row().symbol}
            testId={`patterns-matrix-members-${row().symbol}`}
            onShowMembers={props.onShowMembers}
            size={14}
            iconSize={11}
          />
        </Show>
      </Box>
      <Show when={row().name}>
        <Text c="dimmed" truncate title={row().name ?? undefined} className="text-ui-micro leading-[1.1]">
          {row().name}
        </Text>
      </Show>
    </Box>
  );
}

function TfGlyph(props: { cell: MatrixCell | undefined }) {
  matrixStats.tfGlyphRenders += 1;
  const cell = () => props.cell;
  if (!cell()) {
    return (
      <Text c="dimmed" className="text-ui-micro leading-[1.1]">
        —
      </Text>
    );
  }
  const tone = () => directionTone(cell()!.direction);
  return (
    <span
      title={
        cell()!.count > 1
          ? `${cell()!.count} patterns · latest: ${cell()!.patterns.join(", ")}`
          : `1 pattern: ${cell()!.patterns.join(", ")}`
      }
      className="inline-flex items-center justify-center gap-[1px]"
    >
      <span className="text-ui-micro font-bold leading-none" style={{ color: textToneChartColor(tone()) }}>
        {directionGlyph(cell()!.direction)}
      </span>
      <Show when={cell()!.count > 1}>
        <span className="text-ui-micro leading-none" style={{ color: palette.TEXT_MUTED }}>
          {cell()!.count}
        </span>
      </Show>
    </span>
  );
}

function PatternChip(props: { hit: PatternHitDTO; onSelect: (hit: PatternHitDTO) => void }) {
  matrixStats.patternChipRenders += 1;
  const hit = () => props.hit;
  const tone = () => directionTone(hit().direction);
  const label = () => `${hit().pattern_name} ${formatTfLabel(hit().timeframe)}`;
  return (
    <button
      type="button"
      aria-label={`Open ${label()} chart`}
      onClick={(event) => {
        event.stopPropagation();
        props.onSelect(hit());
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        props.onSelect(hit());
      }}
      title={`${label()} — ${String(hit().status ?? "")}`}
      className="inline-flex h-4 shrink-0 cursor-pointer select-none items-center whitespace-nowrap rounded-[3px] border px-1 text-ui-micro leading-none"
      style={{
        "border-color": alpha(textToneChartColor(tone()), 0.45),
        background: alpha(textToneChartColor(tone()), 0.14),
        color: textToneChartColor(tone()),
      }}
    >
      {label()}
    </button>
  );
}

export function PatternSymbolMatrix(props: PatternSymbolMatrixProps) {
  matrixStats.matrixRenders += 1;

  const orderedTimeframes = createMemo(() => matrixTfOrder(props.timeframes));

  // Keyed on the source row object + ordered-timeframe array, so a fresh rows
  // array holding the same row objects (a filter pass, a chip click, a selection
  // change) keeps every derived reference. TanStackTable's stable row slots then
  // see an unchanged frame and skip re-rendering those cells.
  const rowCache = new WeakMap<
    PatternMatrixRow,
    { tfs: string[]; derived: PatternMatrixRow | null }
  >();
  const chipsCache = new WeakMap<PatternHitDTO[], PatternHitDTO[]>();
  const chipsByRow = new WeakMap<PatternMatrixRow, PreparedChips>();

  const orderedChips = (hits: PatternHitDTO[]): PatternHitDTO[] => {
    const cached = chipsCache.get(hits);
    if (cached) return cached;
    const ordered = sortHits(hits);
    chipsCache.set(hits, ordered);
    return ordered;
  };

  const visibleRows = createMemo(() => {
    matrixStats.visibleRowsBuilds += 1;
    const tfs = orderedTimeframes();
    const allowed = new Set(tfs);
    const out: PatternMatrixRow[] = [];
    for (const row of props.rows) {
      let cached = rowCache.get(row);
      let derived: PatternMatrixRow | null;
      if (cached && cached.tfs === tfs) {
        derived = cached.derived;
      } else {
        const byTimeframe = new Map<string, PatternHitDTO>();
        for (const hit of row.hits) {
          if (!allowed.has(hit.timeframe)) continue;
          const prev = byTimeframe.get(hit.timeframe);
          if (!prev || isFresherHit(hit, prev)) byTimeframe.set(hit.timeframe, hit);
        }
        const hits = [...byTimeframe.values()];
        if (hits.length === 0) {
          derived = null;
        } else {
          // Linear best-of preserves sort's stable first-on-tie without a second array.
          let best: PatternHitDTO | null = null;
          for (const hit of hits) {
            if (!best || compareConviction(hit, best) < 0) best = hit;
          }
          derived = { ...row, hits, best, hit_count: hits.length };
          const ordered = orderedChips(hits);
          const shown = ordered.slice(0, MAX_CHIPS);
          chipsByRow.set(derived, { shown, extra: ordered.length - shown.length });
        }
        cached = { tfs, derived };
        rowCache.set(row, cached);
      }
      if (derived) out.push(derived);
    }
    out.sort((a, b) => (a.best && b.best ? compareConviction(a.best, b.best) : a.best ? -1 : 1));
    return out;
  });

  const onRowClick = (row: PatternMatrixRow) => {
    if (row.best) props.onSelect(row.best);
  };

  // Cell renderers read the volatile props (selection, chip callbacks) only when
  // invoked, so this memo depends solely on the ordered timeframe list.
  const columns = createMemo<TableColumnDef<PatternMatrixRow>[]>(() => {
    matrixStats.columnsBuilds += 1;
    const tfColumns: TableColumnDef<PatternMatrixRow>[] = orderedTimeframes().map((tf) => ({
      id: `tf-${tf}`,
      header: formatTfLabel(tf),
      accessorFn: (row) => row.timeframes[tf]?.confidence ?? null,
      size: 40,
      meta: { align: "center" },
      cell: (ctx) => <TfGlyph cell={ctx.row.original.timeframes[tf]} />,
    }));

    return [
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "symbol",
        size: 140,
        meta: { align: "left" },
        cell: (ctx) => (
          <SymbolCell
            row={ctx.row.original}
            onShowMembers={props.onShowMembers}
            onSymbolPreview={props.onSymbolPreview}
            onSymbolPreviewEnd={props.onSymbolPreviewEnd}
            onSymbolOpen={props.onSymbolOpen}
          />
        ),
      },
      {
        id: "ltp",
        header: "LTP",
        accessorKey: "ltp",
        size: 92,
        meta: { align: "right" },
        cell: (ctx) => <NumText value={ctx.row.original.ltp} format={formatMatrixPrice} />,
      },
      {
        id: "chg",
        header: "Chg %",
        accessorKey: "day_change_pct",
        size: 74,
        meta: { align: "right" },
        cell: (ctx) => {
          const value = ctx.row.original.day_change_pct;
          return <NumText value={value} format={formatMatrixPct} tone={changeTextTone(value)} />;
        },
      },
      ...tfColumns,
      {
        id: "score",
        header: "Score",
        accessorFn: (row) => row.best?.confidence ?? null,
        size: 66,
        meta: { align: "right" },
        cell: (ctx) => (
          <NumText value={ctx.row.original.best?.confidence} format={formatScore} />
        ),
      },
      {
        id: "pos",
        header: "Pos %",
        accessorFn: (row) => row.best?.range_pos ?? null,
        size: 64,
        meta: { align: "right" },
        cell: (ctx) => <NumText value={ctx.row.original.best?.range_pos} format={formatRangePos} />,
      },
      {
        id: "patterns",
        header: "Patterns",
        accessorKey: "hit_count",
        meta: { align: "center" },
        cell: (ctx) => {
          const chips = chipsByRow.get(ctx.row.original) ?? EMPTY_CHIPS;
          const title = () => {
            const labels = chips.shown.map(
              (hit) => `${hit.pattern_name} ${formatTfLabel(hit.timeframe)}`,
            );
            if (chips.extra > 0) labels.push(`+${chips.extra} more`);
            return labels.join(", ") || undefined;
          };
          return (
            <Box className="flex items-center gap-1 overflow-hidden" title={title()}>
              <For each={chips.shown}>
                {(hit) => <PatternChip hit={hit} onSelect={props.onSelect} />}
              </For>
              <Show when={chips.extra > 0}>
                <Text c="dimmed" className="shrink-0 text-ui-micro leading-none">
                  {`+${chips.extra}`}
                </Text>
              </Show>
            </Box>
          );
        },
      },
    ];
  });

  const activeSymbol = () => props.activeSymbol ?? null;

  return (
    <PatternScrollRegion
      testId="patterns-matrix-scroll-region"
      cueTestId="patterns-matrix-scroll-cue"
      ariaLabel="Pattern matrix, scroll sideways for more columns"
      stickyFirstColumn
    >
      <TanStackTable<PatternMatrixRow>
        data={visibleRows()}
        columns={columns()}
        dataTestId="patterns-symbol-matrix"
        loading={props.loading}
        emptyMessage={props.emptyMessage ?? "No symbols match the current filters."}
        enableSorting
        stickyHeader
        fillContainer
        // One derived width keeps the table inside its panel: it scrolls rather
        // than widening the docked-chart viewport at 1366px.
        minTableWidth={Math.max(MIN_MATRIX_WIDTH, columns().length * MIN_COLUMN_WIDTH)}
        rowWindowSize={80}
        onRowClick={onRowClick}
        getRowStyle={(row) =>
          activeSymbol() && row.symbol === activeSymbol()
            ? {
                background: alpha(palette.PRIMARY, 0.12),
                boxShadow: "inset 3px 0 0 var(--color-fin-primary)",
              }
            : undefined
        }
        getRowAttributes={(row) => ({
          "data-active": activeSymbol() && row.symbol === activeSymbol() ? "true" : undefined,
        })}
        getRowTestId={(row) => `patterns-matrix-row-${row.symbol}`}
        onSortedRowsChange={props.onRowsChange}
      />
    </PatternScrollRegion>
  );
}
