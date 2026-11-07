import { useMemo, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { alpha } from "@mui/material/styles";
import { Box, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { TanStackTable } from "@/components/common/TanStackTable";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { SymbolLink } from "@/components/common/SymbolLink";
import { hasIndexMembers } from "@/config/indexGroups";
import { MembersButton } from "./MembersButton";
import {
  directionGlyph,
  directionTone,
  formatMatrixPct,
  formatMatrixPrice,
  formatTfLabel,
  isFresherHit,
  matrixTfOrder,
  type MatrixCell,
  type PatternMatrixRow,
} from "./symbolMatrix";
import { changeTextTone } from "./patternTone";

export interface PatternSymbolMatrixProps {
  rows: PatternMatrixRow[];
  timeframes: string[];
  onSelect: (hit: PatternHitDTO) => void;
  onShowMembers?: (symbol: string) => void;
  loading?: boolean;
  emptyMessage?: string;
  /** Symbol currently shown in the docked chart — highlighted in the matrix. */
  activeSymbol?: string | null;
  /** Emits the rows in rendered (post-sort) order for prev/next navigation. */
  onRowsChange?: (rows: PatternMatrixRow[]) => void;
  /** Hover intent for the right-side symbol preview (host debounces). */
  onSymbolPreview?: (symbol: string) => void;
  onSymbolPreviewEnd?: (symbol: string) => void;
  /** Chart icon: open the symbol in the right-side chart. */
  onSymbolOpen?: (symbol: string) => void;
}

const MAX_CHIPS = 8;

const TONE_COLOR: Record<string, string> = { success: palette.POSITIVE, error: palette.NEGATIVE, dimmed: palette.TEXT_MUTED };

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
  return [...hits].sort(
    (a, b) =>
      rank(STATUS_RANK, a.status) - rank(STATUS_RANK, b.status) ||
      rank(DIRECTION_RANK, a.direction) - rank(DIRECTION_RANK, b.direction) ||
      (b.confidence ?? 0) - (a.confidence ?? 0),
  );
}

function NumText({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <Text c={color} fw={600} sx={{ fontSize: 11, lineHeight: 1.1 }}>
      {children}
    </Text>
  );
}

function SymbolCell({
  row,
  onShowMembers,
  onSymbolPreview,
  onSymbolPreviewEnd,
  onSymbolOpen,
}: {
  row: PatternMatrixRow;
  onShowMembers?: (symbol: string) => void;
  onSymbolPreview?: (symbol: string) => void;
  onSymbolPreviewEnd?: (symbol: string) => void;
  onSymbolOpen?: (symbol: string) => void;
}) {
  const canShowMembers = Boolean(onShowMembers && hasIndexMembers(row.symbol));
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: "2px", minWidth: 0 }}>
        <SymbolLink
          symbol={row.symbol}
          testId={`patterns-matrix-tv-${row.symbol}`}
          chartTestId={`patterns-matrix-chart-${row.symbol}`}
          onOpen={onSymbolOpen}
          onPreview={onSymbolPreview}
          onPreviewEnd={onSymbolPreviewEnd}
          size="xs"
          weight={700}
          sx={{ flex: 1 }}
        />
        {canShowMembers ? (
          <MembersButton
            symbol={row.symbol}
            testId={`patterns-matrix-members-${row.symbol}`}
            onShowMembers={onShowMembers}
            size={14}
            iconSize={11}
          />
        ) : null}
      </Box>
      {row.name ? (
        <Text c="dimmed" truncate sx={{ fontSize: 10, lineHeight: 1.1 }}>
          {row.name}
        </Text>
      ) : null}
    </Box>
  );
}

function TfGlyph({ cell }: { cell: MatrixCell | undefined }) {
  if (!cell) {
    return (
      <Text c="dimmed" sx={{ fontSize: 11, lineHeight: 1.1 }}>
        —
      </Text>
    );
  }
  const tone = directionTone(cell.direction);
  return (
    <Box
      component="span"
      title={
        cell.count > 1
          ? `${cell.count} patterns · latest: ${cell.patterns.join(", ")}`
          : `1 pattern: ${cell.patterns.join(", ")}`
      }
      sx={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "1px" }}
    >
      <Box component="span" sx={{ color: TONE_COLOR[tone], fontSize: 11, lineHeight: 1, fontWeight: 700 }}>
        {directionGlyph(cell.direction)}
      </Box>
      {cell.count > 1 ? (
        <Box component="span" sx={{ color: palette.TEXT_MUTED, fontSize: 9, lineHeight: 1 }}>
          {cell.count}
        </Box>
      ) : null}
    </Box>
  );
}

function PatternChip({ hit, onSelect }: { hit: PatternHitDTO; onSelect: (hit: PatternHitDTO) => void }) {
  const color = TONE_COLOR[directionTone(hit.direction)];
  const label = `${hit.pattern_name} ${formatTfLabel(hit.timeframe)}`;
  return (
    <Box
      component="span"
      role="button"
      tabIndex={0}
      aria-label={`Open ${label} chart`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(hit);
      }}
      onKeyDown={(event: React.KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onSelect(hit);
      }}
      title={`${label} — ${String(hit.status ?? "")}`}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        height: 16,
        px: "4px",
        borderRadius: "3px",
        border: `1px solid ${alpha(color, 0.45)}`,
        bgcolor: alpha(color, 0.14),
        color,
        fontSize: 10,
        lineHeight: 1,
        whiteSpace: "nowrap",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {label}
    </Box>
  );
}

export function PatternSymbolMatrix({
  rows,
  timeframes,
  onSelect,
  onShowMembers,
  loading = false,
  emptyMessage = "No symbols match the current filters.",
  activeSymbol = null,
  onRowsChange,
  onSymbolPreview,
  onSymbolPreviewEnd,
  onSymbolOpen,
}: PatternSymbolMatrixProps) {
  const orderedTimeframes = useMemo(() => matrixTfOrder(timeframes), [timeframes]);
  const visibleRows = useMemo(() => {
    const allowed = new Set(orderedTimeframes);
    return rows
      .flatMap((row) => {
        const byTimeframe = new Map<string, PatternHitDTO>();
        for (const hit of row.hits) {
          if (!allowed.has(hit.timeframe)) continue;
          const prev = byTimeframe.get(hit.timeframe);
          if (!prev || isFresherHit(hit, prev)) byTimeframe.set(hit.timeframe, hit);
        }
        const hits = [...byTimeframe.values()];
        if (hits.length === 0) return [];
        const best = [...hits].sort(compareConviction)[0] ?? null;
        return [{ ...row, hits, best, hit_count: hits.length }];
      })
      .sort((a, b) => (a.best && b.best ? compareConviction(a.best, b.best) : a.best ? -1 : 1));
  }, [rows, orderedTimeframes]);

  const columns = useMemo<ColumnDef<PatternMatrixRow>[]>(() => {
    const tfColumns: ColumnDef<PatternMatrixRow>[] = orderedTimeframes.map((tf) => ({
      id: `tf-${tf}`,
      header: formatTfLabel(tf),
      accessorFn: (row) => row.timeframes[tf]?.confidence ?? null,
      size: 40,
      meta: { align: "center" },
      cell: (info) => <TfGlyph cell={info.row.original.timeframes[tf]} />,
    }));

    return [
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "symbol",
        size: 140,
        meta: { align: "left" },
        cell: (info) => (
          <SymbolCell
            row={info.row.original}
            onShowMembers={onShowMembers}
            onSymbolPreview={onSymbolPreview}
            onSymbolPreviewEnd={onSymbolPreviewEnd}
            onSymbolOpen={onSymbolOpen}
          />
        ),
      },
      {
        id: "ltp",
        header: "LTP",
        accessorKey: "ltp",
        size: 92,
        meta: { align: "right" },
        cell: (info) => <NumText>{formatMatrixPrice(info.getValue<number | null>())}</NumText>,
      },
      {
        id: "chg",
        header: "Chg %",
        accessorKey: "day_change_pct",
        size: 74,
        meta: { align: "right" },
        cell: (info) => {
          const value = info.getValue<number | null>();
          return <NumText color={changeTextTone(value)}>{formatMatrixPct(value)}</NumText>;
        },
      },
      ...tfColumns,
      {
        id: "score",
        header: "Score",
        accessorFn: (row) => row.best?.confidence ?? null,
        size: 66,
        meta: { align: "right" },
        cell: (info) => {
          const value = info.getValue<number | null>();
          const text = value == null || !Number.isFinite(value) ? "—" : value.toFixed(1);
          return <NumText>{text}</NumText>;
        },
      },
      {
        id: "pos",
        header: "Pos %",
        accessorFn: (row) => row.best?.range_pos ?? null,
        size: 64,
        meta: { align: "right" },
        cell: (info) => {
          const value = info.getValue<number | null>();
          const text = value == null || !Number.isFinite(value) ? "—" : `${Math.round(value)}%`;
          return <NumText>{text}</NumText>;
        },
      },
      {
        id: "patterns",
        header: "Patterns",
        accessorFn: (row) => row.hit_count,
        meta: { align: "left" },
        cell: (info) => {
          const ordered = sortHits(info.row.original.hits);
          const shown = ordered.slice(0, MAX_CHIPS);
          const extra = ordered.length - shown.length;
          return (
            <Box sx={{ display: "flex", alignItems: "center", gap: "4px", overflow: "hidden" }}>
              {shown.map((hit, index) => (
                <PatternChip
                  key={`${hit.id ?? `${hit.pattern_id}-${hit.timeframe}`}-${index}`}
                  hit={hit}
                  onSelect={onSelect}
                />
              ))}
              {extra > 0 ? (
                <Text c="dimmed" sx={{ fontSize: 10, lineHeight: 1, flexShrink: 0 }}>
                  {`+${extra}`}
                </Text>
              ) : null}
            </Box>
          );
        },
      },
    ];
  }, [orderedTimeframes, onSelect, onShowMembers, onSymbolPreview, onSymbolPreviewEnd, onSymbolOpen]);

  return (
    <TanStackTable<PatternMatrixRow>
      data={visibleRows}
      columns={columns}
      dataTestId="patterns-symbol-matrix"
      loading={loading}
      emptyMessage={emptyMessage}
      enableSorting
      stickyHeader
      rowWindowSize={80}
      onRowClick={(row) => {
        if (row.best) onSelect(row.best);
      }}
      getRowStyle={(row) =>
        activeSymbol && row.symbol === activeSymbol
          ? {
              background: "var(--mui-palette-action-selected)",
              boxShadow: "inset 3px 0 0 var(--mui-palette-primary-main)",
            }
          : undefined
      }
      getRowAttributes={(row) => ({
        "data-active": activeSymbol && row.symbol === activeSymbol ? "true" : undefined,
      })}
      getRowTestId={(row) => `patterns-matrix-row-${row.symbol}`}
      onSortedRowsChange={onRowsChange}
    />
  );
}
