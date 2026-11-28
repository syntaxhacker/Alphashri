/**
 * Market → Vis "Sector × period".
 *
 * Chart form: the D3 gallery "Heatmap" — one row per sector, one column per
 * return window, cell hue = the signed median of that cohort. Reference:
 * https://observablehq.com/@d3/gallery (Heatmap). The square-root fill curve
 * follows ThemeBoard's zero-centred P&L ramp so a small move stays visible
 * beside a large one; the number itself stays linear.
 */
import { For, Show, createMemo } from "solid-js";
import { Box, Text, ToolbarRow, useMediaQuery } from "@/ui";
import { alpha, VIZ_BG, VIZ_GRID, VIZ_MUTED, VIZ_PANEL, VIZ_SCALE_PNL, VIZ_TEXT } from "@/ui/palette";
import { compositeOver, contrastRatio, pickTextColor } from "@/utils/contrast";
import type { MarketRow } from "@/types/marketScreener";
import type { VisRenderProps } from "./MarketMapView";

const NEUTRAL_STOP = 4;
const EXTENT_FLOOR = 0.5;
const MIN_CONTRAST = 4.5;
/** "Communications" is the longest single sector word at the 390px label budget. */
export const SECTOR_LABEL_MAX_CHARS = 14;

export const SECTOR_PERIODS = [
  { id: "1D", label: "1D", field: "change" },
  { id: "1W", label: "1W", field: "perfW" },
  { id: "1M", label: "1M", field: "perf1m" },
] as const;
export type SectorPeriodId = (typeof SECTOR_PERIODS)[number]["id"];

export interface SectorPeriodCell {
  period: SectorPeriodId;
  /** Null when the cohort has no finite reading for this window. */
  median: number | null;
  /** Names actually used in the median, not the sector's full membership. */
  n: number;
}

export interface SectorPeriodRow {
  sector: string;
  /** Full sector membership, including rows with no usable reading. */
  n: number;
  cells: SectorPeriodCell[];
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Median of the finite readings only; a missing quote is not a zero. */
export function medianFinite(values: readonly (number | null | undefined)[]): number | null {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function computeSectorPeriods(rows: readonly MarketRow[] | null | undefined): SectorPeriodRow[] {
  const groups = new Map<string, MarketRow[]>();
  for (const row of rows ?? []) {
    const sector = typeof row?.sector === "string" ? row.sector.trim() : "";
    if (!sector) continue;
    const group = groups.get(sector) ?? [];
    group.push(row);
    groups.set(sector, group);
  }

  const result: SectorPeriodRow[] = [];
  for (const [sector, group] of groups) {
    result.push({
      sector,
      n: group.length,
      cells: SECTOR_PERIODS.map((period) => {
        const values = group.map((row) => row[period.field]);
        return {
          period: period.id,
          median: medianFinite(values),
          n: values.filter(finite).length,
        };
      }),
    });
  }

  // 1D median desc, then name so the order is stable across refreshes.
  const day = (row: SectorPeriodRow) => row.cells[0]?.median ?? null;
  return result.sort((a, b) => {
    const av = day(a);
    const bv = day(b);
    if (av === null) return bv === null ? a.sector.localeCompare(b.sector) : 1;
    if (bv === null) return -1;
    return bv - av || a.sector.localeCompare(b.sector);
  });
}

/** Each column has its own zero-centred domain; a small sector is still legible. */
export function periodExtents(rows: readonly SectorPeriodRow[]): Record<SectorPeriodId, number> {
  const extents: Record<SectorPeriodId, number> = { "1D": EXTENT_FLOOR, "1W": EXTENT_FLOOR, "1M": EXTENT_FLOOR };
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.median !== null) {
        extents[cell.period] = Math.max(extents[cell.period], Math.abs(cell.median));
      }
    }
  }
  return extents;
}

/** VIZ_SCALE_PNL stop for a √-scaled, zero-centred median. */
export function sectorPeriodColor(median: number | null, extent: number): string {
  if (!finite(median)) return VIZ_SCALE_PNL[NEUTRAL_STOP]!;
  const span = finite(extent) && extent > 0 ? extent : EXTENT_FLOOR;
  const curved = Math.sign(median) * span * Math.sqrt(Math.min(Math.abs(median) / span, 1));
  const t = Math.max(-1, Math.min(1, curved / span));
  const raw = Math.round(((t + 1) / 2) * (VIZ_SCALE_PNL.length - 1));
  const index = Math.max(0, Math.min(VIZ_SCALE_PNL.length - 1, raw));
  return VIZ_SCALE_PNL[index]!;
}

/** Pick the readable ink; scrim only when neither anchor clears 4.5:1 on the fill. */
export function cellLabelInk(fill: string): { ink: string; scrim: string | null } {
  const direct = pickTextColor(fill, VIZ_TEXT, VIZ_BG);
  if (contrastRatio(direct, fill) >= MIN_CONTRAST) return { ink: direct, scrim: null };
  const scrim = compositeOver(VIZ_BG, fill, 0.62);
  return { ink: pickTextColor(scrim, VIZ_TEXT, VIZ_BG), scrim };
}

const pctText = (value: number | null): string => {
  if (value === null) return "—";
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`;
};

const rowKey = (sector: string): string => sector.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const rowTitle = (row: SectorPeriodRow): string =>
  `${row.sector} · n ${row.n} · ` +
  row.cells.map((cell) => `${cell.period} median ${pctText(cell.median)} (n ${cell.n})`).join(" · ");

/**
 * Wrap at spaces only. A word wider than the budget stays whole on its own line:
 * the label column is sized to the longest real sector word, so no ellipsis is
 * needed — and the row title always carries the full name regardless.
 */
export function sectorLabelLines(name: string, maxCharsPerLine: number): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0]!;
  for (const word of words.slice(1)) {
    if (current.length + 1 + word.length <= maxCharsPerLine) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

export function SectorPeriodView(props: VisRenderProps) {
  const sectors = createMemo(() => computeSectorPeriods(props.rows));
  const extents = createMemo(() => periodExtents(sectors()));
  const wide = useMediaQuery("(min-width: 640px)", true);

  return (
    <Box
      className="flex-1 min-w-0 min-h-0 flex flex-col"
      style={{ "background-color": VIZ_BG, color: VIZ_TEXT }}
      data-testid="sector-period-view"
    >
      <ToolbarRow
        gap={8}
        wrap={false}
        clip
        className="h-10 flex-shrink-0 border-b px-2"
        style={{ "border-color": VIZ_GRID }}
        data-testid="sector-period-toolbar"
      >
        <Text span size="xs" fw={600} c={VIZ_TEXT} className="whitespace-nowrap">
          Sector × period
        </Text>
        <Box className="flex-1 min-w-0" />
        <Text span size="xs" c={VIZ_MUTED} className="whitespace-nowrap" data-testid="sector-period-count">
          {sectors().length} sectors · {props.rows?.length ?? 0} stocks
        </Text>
      </ToolbarRow>

      <Show
        when={sectors().length > 0}
        fallback={
          <Box
            className="flex-1 min-w-0 min-h-0 flex items-center justify-center p-4"
            data-testid="sector-period-empty"
          >
            <Text span size="sm" c={VIZ_MUTED}>
              No sector period data.
            </Text>
          </Box>
        }
      >
        <Box
          className="grid flex-1 min-w-0 min-h-0 content-start gap-1 overflow-auto p-2"
          style={{
            "background-color": VIZ_PANEL,
            "grid-template-columns": "minmax(120px, 1.2fr) repeat(3, minmax(64px, 1fr))",
          }}
          data-testid="sector-period-grid"
        >
          <Text span size="xs" c={VIZ_MUTED} className="min-w-0 px-2">
            Sector
          </Text>
          <For each={SECTOR_PERIODS}>
            {(period) => (
              <Text
                span
                size="xs"
                c={VIZ_MUTED}
                className="min-w-0 text-center font-mono tabular-nums"
                data-testid={`sector-period-head-${period.id}`}
              >
                {period.label}
              </Text>
            )}
          </For>

          <For each={sectors()}>
            {(row) => {
              const key = () => rowKey(row.sector);
              return (
                <>
                  <Box
                    className="flex min-w-0 flex-wrap items-center gap-1 px-2"
                    title={rowTitle(row)}
                    data-testid={`sector-period-row-${key()}`}
                  >
                    <Text
                      span
                      size="xs"
                      fw={600}
                      c={VIZ_TEXT}
                      className="min-w-[104px] break-normal whitespace-normal leading-tight"
                      data-testid={`sector-period-label-${key()}`}
                    >
                      <For each={sectorLabelLines(row.sector, SECTOR_LABEL_MAX_CHARS)}>
                        {(line) => <span className="block">{line}</span>}
                      </For>
                    </Text>
                    <Text
                      span
                      size="xs"
                      c={VIZ_MUTED}
                      className="flex-shrink-0 font-mono tabular-nums"
                      data-testid={`sector-period-n-${key()}`}
                    >
                      n {row.n}
                    </Text>
                  </Box>
                  <For each={row.cells}>
                    {(cell) => {
                      const fill = () => sectorPeriodColor(cell.median, extents()[cell.period]);
                      const label = () => cellLabelInk(fill());
                      return (
                        <Box
                          className="flex h-9 min-w-0 items-center justify-center rounded-fin border"
                          title={`${row.sector} · ${cell.period} median ${pctText(cell.median)} (n ${cell.n})`}
                          role="img"
                          aria-label={`${row.sector} ${cell.period} median ${pctText(cell.median)} of ${cell.n}`}
                          data-testid={`sector-period-cell-${key()}-${cell.period}`}
                          data-median={cell.median === null ? "n/a" : cell.median.toFixed(4)}
                          data-n={cell.n}
                          data-fill={fill()}
                          style={{ "background-color": fill(), "border-color": alpha(VIZ_BG, 0.8) }}
                        >
                          <Box
                            className="max-w-full rounded-fin"
                            style={{
                              "background-color": label().scrim ?? "transparent",
                              padding: "1px 3px",
                            }}
                          >
                            <Text
                              span
                              size="xs"
                              fw={600}
                              className="font-mono tabular-nums whitespace-nowrap"
                              style={{ color: label().ink }}
                              data-testid={`sector-period-value-${key()}-${cell.period}`}
                            >
                              {pctText(cell.median)}
                            </Text>
                          </Box>
                        </Box>
                      );
                    }}
                  </For>
                </>
              );
            }}
          </For>
        </Box>
      </Show>

      <Show
        when={wide()}
        fallback={
          <Box
            className="flex flex-shrink-0 flex-col gap-1 border-t px-2 py-1"
            style={{ "border-color": VIZ_GRID }}
            data-testid="sector-period-legend"
          >
            <Box className="flex items-center gap-2">
              <Box
                className="h-2 w-24 flex-shrink-0 rounded-fin"
                style={{ background: `linear-gradient(to right, ${VIZ_SCALE_PNL.join(", ")})` }}
                data-testid="sector-period-legend-ramp"
              />
              <Text span size="xs" c={VIZ_MUTED} className="whitespace-nowrap" data-testid="sector-period-legend-text">
                loss ← 0 → gain
              </Text>
            </Box>
            <Text span size="xs" c={VIZ_MUTED} data-testid="sector-period-legend-note">
              median by sector · n = quoted names
            </Text>
          </Box>
        }
      >
        <ToolbarRow
          gap={8}
          wrap={false}
          className="h-8 flex-shrink-0 border-t px-2"
          style={{ "border-color": VIZ_GRID }}
          data-testid="sector-period-legend"
        >
          <Box
            className="h-2 w-24 flex-shrink-0 rounded-fin"
            style={{ background: `linear-gradient(to right, ${VIZ_SCALE_PNL.join(", ")})` }}
            data-testid="sector-period-legend-ramp"
          />
          <Text span size="xs" c={VIZ_MUTED} className="whitespace-nowrap" data-testid="sector-period-legend-text">
            loss ← 0 → gain
          </Text>
          <Box className="flex-1 min-w-0" />
          <Text span size="xs" c={VIZ_MUTED} className="whitespace-nowrap" data-testid="sector-period-legend-note">
            median by sector · n = quoted names
          </Text>
        </ToolbarRow>
      </Show>
    </Box>
  );
}
