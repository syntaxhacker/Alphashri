/**
 * Market → Vis "Relative volume".
 *
 * Chart form: the D3 gallery "Lollipop chart" — a horizontal track from zero
 * to the name's relative volume with a dot at the value, ordered high → low.
 * A reference line marks 2×; the P&L ramp (VIZ_SCALE_PNL) colours the dot and
 * track, while the signed day change uses semantic ink that clears the text
 * contrast floor. Reference:
 * https://observablehq.com/@d3/gallery (Lollipop chart).
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { Box, Chip, Text, ToolbarRow } from "@/ui";
import {
  alpha,
  VIZ_BG,
  VIZ_DOWN,
  VIZ_GRID,
  VIZ_MUTED,
  VIZ_PANEL,
  VIZ_SCALE_PNL,
  VIZ_TEXT,
  VIZ_UP,
} from "@/ui/palette";
import type { MarketRow } from "@/types/marketScreener";
import type { VisRenderProps } from "./MarketMapView";

const EMPTY: MarketRow[] = [];

/** Top-N only: a full universe of lollipops is unreadable. */
export const REL_VOL_LIMIT = 50;
export const REL_VOL_THRESHOLD = 2;
const NEUTRAL_STOP = 4;

export const REL_VOL_FILTERS = [
  { id: "all", label: "All", threshold: null },
  { id: "gte2", label: "≥2×", threshold: 2 },
  { id: "gte3", label: "≥3×", threshold: 3 },
] as const;
export type RelVolFilter = (typeof REL_VOL_FILTERS)[number]["id"];

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Loosely typed rows can carry nulls/non-numbers; only a finite rel-vol qualifies. */
export function hasRelVol(row: MarketRow): boolean {
  return !!row && finite(row.relativeVolume);
}

/** Descending relative volume; symbol breaks ties so the order is stable. */
export function sortRelVolRows(rows: MarketRow[]): MarketRow[] {
  return [...rows].sort(
    (a, b) => (b.relativeVolume ?? 0) - (a.relativeVolume ?? 0) || a.symbol.localeCompare(b.symbol),
  );
}

/** Eligible rows (finite rel-vol), top 50 highest first. */
export function selectRelVolRows(rows: MarketRow[], limit = REL_VOL_LIMIT): MarketRow[] {
  return sortRelVolRows((rows ?? []).filter(hasRelVol)).slice(0, limit);
}

export function filterRelVolRows(rows: MarketRow[], filter: string): MarketRow[] {
  const threshold = REL_VOL_FILTERS.find((option) => option.id === filter)?.threshold ?? null;
  if (threshold === null) return rows;
  return rows.filter((row) => hasRelVol(row) && (row.relativeVolume ?? 0) >= threshold);
}

/** One decimal plus the × unit, e.g. `3.4×`. */
export function formatRelVol(value: number | null): string {
  return finite(value) ? `${value.toFixed(1)}×` : "n/a";
}

/** Signed change, no -0.00%. */
export function formatChange(value: number | null): string {
  if (!finite(value)) return "—";
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`;
}

/** Loss red → neutral → gain green on the shared P&L ramp, zero pinned to centre. */
export function relVolColor(change: number | null, extent: number): string {
  if (!finite(change)) return VIZ_SCALE_PNL[NEUTRAL_STOP];
  const span = finite(extent) && extent > 0 ? extent : 1;
  const t = Math.max(-1, Math.min(1, change / span));
  const index = Math.round(((t + 1) / 2) * (VIZ_SCALE_PNL.length - 1));
  return VIZ_SCALE_PNL[index];
}

/** The ramp's mid-stops are below 4.5:1, so text uses full-strength semantic ink. */
export function relVolTextColor(change: number | null): string {
  if (!finite(change) || change === 0) return VIZ_TEXT;
  return change > 0 ? VIZ_UP : VIZ_DOWN;
}

/** Track position as a percent of the visible maximum, clamped to the rail. */
export function relVolPct(value: number | null, max: number): number {
  if (!finite(value)) return 0;
  const peak = finite(max) && max > 0 ? max : 1;
  return Math.min(100, Math.max(0, (value / peak) * 100));
}

export function RelVolView(props: VisRenderProps) {
  const [filter, setFilter] = createSignal<string>("all");
  const rows = createMemo(() => props.rows ?? EMPTY);
  const selected = createMemo(() => selectRelVolRows(rows()));
  const filtered = createMemo(() => filterRelVolRows(selected(), filter()));
  const visible = createMemo(() => filtered().slice(0, REL_VOL_LIMIT));
  const maxRelVol = createMemo(() => Math.max(0, ...visible().map((row) => row.relativeVolume ?? 0)));
  const thresholdValue = createMemo(() =>
    Math.min(100, Math.max(0, (REL_VOL_THRESHOLD / (maxRelVol() || 1)) * 100)),
  );
  const thresholdPct = createMemo(() => `${thresholdValue().toFixed(3)}%`);
  /** A centred label would lose half its width at either rail edge. */
  const thresholdLabelPct = createMemo(() =>
    `${Math.min(94, Math.max(6, thresholdValue())).toFixed(3)}%`,
  );
  const extent = createMemo(() => {
    let max = 0.5;
    for (const row of visible()) {
      if (finite(row.change)) max = Math.max(max, Math.abs(row.change));
    }
    return max;
  });
  const colorOf = (row: MarketRow) => relVolColor(row.change, extent());
  const pctOf = (row: MarketRow) => `${relVolPct(row.relativeVolume, maxRelVol()).toFixed(3)}%`;
  const tooltip = (row: MarketRow) =>
    `${row.symbol} · ${row.name} · rel vol ${formatRelVol(row.relativeVolume)} · ` +
    `change ${formatChange(row.change)} · value ${row.valueTraded ?? "n/a"} · volume ${row.volume ?? "n/a"}`;

  return (
    <Box
      className="flex-1 min-w-0 min-h-0 flex flex-col"
      style={{ "background-color": VIZ_BG, color: VIZ_TEXT }}
      data-testid="relvol-view"
    >
      <ToolbarRow
        gap={8}
        wrap={false}
        clip
        className="px-2 h-10 flex-shrink-0"
        style={{ "border-bottom": `1px solid ${VIZ_GRID}` }}
        data-testid="relvol-toolbar"
      >
        <Text size="xs" fw={600} c={VIZ_TEXT} className="whitespace-nowrap">
          Relative volume
        </Text>
        <For each={REL_VOL_FILTERS}>
          {(option) => (
            <Chip
              size="xs"
              checked={filter() === option.id}
              onChange={() => setFilter(option.id)}
              label={option.label}
              data-testid={`relvol-filter-${option.id}`}
            />
          )}
        </For>
        <Box className="flex-1 min-w-0" />
        <Text size="xs" c={VIZ_MUTED} className="whitespace-nowrap font-mono tabular-nums" data-testid="relvol-count">
          showing {visible().length} of {filtered().length}
        </Text>
      </ToolbarRow>

      <Show
        when={filtered().length > 0}
        fallback={
          <Box
            className="flex-1 min-w-0 min-h-0 flex items-center justify-center p-4"
            data-testid="relvol-empty"
          >
            <Text size="sm" c={VIZ_MUTED}>
              No relative-volume data in the current filter.
            </Text>
          </Box>
        }
      >
        <ToolbarRow
          gap={8}
          className="px-2 h-7 flex-shrink-0"
          style={{ "border-bottom": `1px solid ${VIZ_GRID}` }}
          data-testid="relvol-head"
        >
          <Text size="xs" c={VIZ_MUTED} className="w-24 flex-shrink-0">
            Symbol
          </Text>
          <Box className="relative flex-1 min-w-0 h-4">
            <Text
              size="xs"
              c={VIZ_MUTED}
              className="absolute -translate-x-1/2 whitespace-nowrap font-mono tabular-nums"
              style={{ left: thresholdLabelPct() }}
              data-threshold-label-pct={thresholdLabelPct()}
              data-testid="relvol-threshold-label"
            >
              {REL_VOL_THRESHOLD}×
            </Text>
          </Box>
          <Text size="xs" c={VIZ_MUTED} className="w-14 flex-shrink-0 text-right">
            Rel vol
          </Text>
          <Text size="xs" c={VIZ_MUTED} className="w-16 flex-shrink-0 text-right">
            1D
          </Text>
        </ToolbarRow>

        <Box className="flex-1 min-h-0 overflow-auto p-2" data-testid="relvol-list">
          <For each={visible()}>
            {(row) => (
              <button
                type="button"
                data-testid={`relvol-row-${row.symbol}`}
                data-symbol={row.symbol}
                title={tooltip(row)}
                onClick={() => props.onSymbolClick?.(row.symbol)}
                className="flex w-full items-center gap-2 rounded-fin border px-2 py-1 text-left cursor-pointer hover:brightness-110 focus-visible:outline-none focus-visible:ring-1"
                style={{ "border-color": VIZ_GRID, "background-color": VIZ_BG }}
              >
                <Text span size="xs" fw={600} c={VIZ_TEXT} class="w-24 flex-shrink-0 truncate" title={row.name}>
                  {row.symbol}
                </Text>
                <Box
                  className="relative flex-1 min-w-0 h-4"
                  style={{ "background-color": alpha(VIZ_GRID, 0.55) }}
                >
                  <Box
                    className="absolute inset-y-0 w-px"
                    data-testid="relvol-threshold"
                    data-threshold-pct={thresholdPct()}
                    style={{ left: thresholdPct(), "background-color": VIZ_MUTED }}
                  />
                  <Box
                    className="absolute top-1/2 h-1 -translate-y-1/2 rounded-fin"
                    data-testid="relvol-track"
                    data-track-pct={pctOf(row)}
                    style={{
                      left: "0",
                      width: pctOf(row),
                      "background-color": alpha(colorOf(row), 0.35),
                    }}
                  />
                  <Box
                    className="absolute top-1/2 size-2 -translate-y-1/2 rounded-full"
                    data-testid="relvol-dot"
                    data-dot-pct={pctOf(row)}
                    data-dot-color={colorOf(row)}
                    style={{ left: pctOf(row), "background-color": colorOf(row) }}
                  />
                </Box>
                <Text
                  span
                  size="xs"
                  c={VIZ_TEXT}
                  class="w-14 flex-shrink-0 text-right font-mono tabular-nums"
                  data-testid="relvol-value"
                >
                  {formatRelVol(row.relativeVolume)}
                </Text>
                <Text
                  span
                  size="xs"
                  c={relVolTextColor(row.change)}
                  class="w-16 flex-shrink-0 text-right font-mono tabular-nums"
                  data-testid="relvol-change"
                >
                  {formatChange(row.change)}
                </Text>
              </button>
            )}
          </For>
        </Box>
      </Show>

      <ToolbarRow
        gap={8}
        wrap
        className="min-h-8 flex-shrink-0 border-t px-2 py-1"
        style={{ "border-color": VIZ_GRID, "background-color": VIZ_PANEL }}
        data-testid="relvol-legend"
      >
        <Box className="flex items-center gap-2 min-w-0" data-testid="relvol-legend-scale-group">
          <Box
            className="h-2 w-24 rounded-fin"
            style={{ background: `linear-gradient(to right, ${VIZ_SCALE_PNL.join(",")})` }}
            data-testid="relvol-scale"
          />
          <Text size="xs" c={VIZ_MUTED} className="whitespace-nowrap">
            loss ← change → gain
          </Text>
        </Box>
        <Text
          size="xs"
          c={VIZ_MUTED}
          className="whitespace-nowrap basis-full sm:basis-auto sm:ml-auto"
          data-testid="relvol-legend-reference"
        >
          reference line at 2×
        </Text>
      </ToolbarRow>
    </Box>
  );
}
