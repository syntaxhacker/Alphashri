import { For, Show, createMemo, createSignal } from "solid-js";
import { Box, SegmentedControl, Text, ToolbarRow } from "@/ui";
import { VIZ_BG, VIZ_GRID, VIZ_MUTED, VIZ_PANEL, VIZ_SCALE_PNL, VIZ_TEXT } from "@/ui/palette";
import type { MarketRow } from "@/types/marketScreener";
import type { VisRenderProps } from "./MarketMapView";

/**
 * Market → Vis "52W breadth": a horizontal bar chart (the D3 gallery "Bar
 * chart" form) drawn with ECharts-style CSS bars. One bar per sector, ranked
 * by the share of names sitting near a 52-week extreme. Colour comes from the
 * ECharts-style diverging P&L ramp in the palette — never a literal hue.
 */

export type BreadthMode = "high" | "low";

export const SECTOR_52W_BREADTH_OPTIONS = [
  { value: "high", label: "Near high", hint: "near high ≤5% of the 52-week high" },
  { value: "low", label: "Near low", hint: "near low ≤10% of the 52-week low" },
] as const;

const NEAR_HIGH_CUTOFF = -5;
const NEAR_LOW_CUTOFF = 10;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export interface SectorBreadthRow {
  sector: string;
  /** Names with a finite `to52wHighPct` — the denominator for both shares. */
  n: number;
  /** Share of the cohort within 5% of its 52-week high, in percent. */
  nearHighPct: number;
  /** Share of the cohort within 10% of its 52-week low, in percent. */
  nearLowPct: number;
  medianChange: number;
}

export function computeSectorBreadth(rows: MarketRow[]): SectorBreadthRow[] {
  const groups = new Map<string, MarketRow[]>();
  for (const row of rows ?? []) {
    const sector = typeof row?.sector === "string" ? row.sector.trim() : "";
    if (!sector) continue;
    const group = groups.get(sector) ?? [];
    group.push(row);
    groups.set(sector, group);
  }

  const breadth: SectorBreadthRow[] = [];
  for (const [sector, group] of groups) {
    // The cohort is names with a usable high reading; a sector with none has
    // no breadth to plot and must not contribute a 0/0 → NaN bar.
    const cohort = group.filter((row) => isFiniteNumber(row.to52wHighPct));
    if (cohort.length === 0) continue;
    const n = cohort.length;
    const nearHigh = cohort.filter((row) => (row.to52wHighPct as number) >= NEAR_HIGH_CUTOFF).length;
    const nearLow = cohort.filter(
      (row) => isFiniteNumber(row.from52wLowPct) && (row.from52wLowPct as number) <= NEAR_LOW_CUTOFF,
    ).length;
    const changes = group.filter((row) => isFiniteNumber(row.change)).map((row) => row.change as number);
    breadth.push({
      sector,
      n,
      nearHighPct: (nearHigh / n) * 100,
      nearLowPct: (nearLow / n) * 100,
      medianChange: median(changes),
    });
  }
  return breadth.sort((a, b) => b.nearHighPct - a.nearHighPct || a.sector.localeCompare(b.sector));
}

/** Green half of the P&L ramp for "near high", red half for "near low". */
export function breadthBarColor(mode: BreadthMode, ratio: number): string {
  const t = isFiniteNumber(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  const step = Math.round(t * 3);
  return mode === "high" ? VIZ_SCALE_PNL[5 + step]! : VIZ_SCALE_PNL[3 - step]!;
}

const pctText = (value: number): string => `${value.toFixed(1)}%`;
const changeText = (value: number): string => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const rowKey = (sector: string): string => sector.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function Sector52BreadthView(props: VisRenderProps) {
  const [mode, setMode] = createSignal<BreadthMode>("high");
  const breadth = createMemo(() => computeSectorBreadth(props.rows));
  const extent = createMemo(() =>
    Math.max(
      1,
      ...breadth().map((row) => (mode() === "high" ? row.nearHighPct : row.nearLowPct)),
    ),
  );

  return (
    <Box
      className="flex-1 min-w-0 min-h-0 flex flex-col"
      style={{ "background-color": VIZ_BG, color: VIZ_TEXT }}
      data-testid="sector-52w-breadth-view"
    >
      <ToolbarRow
        gap={8}
        wrap={false}
        className="h-10 flex-shrink-0 border-b px-2"
        style={{ "border-color": VIZ_GRID }}
        data-testid="sector-52w-breadth-toolbar"
      >
        <SegmentedControl
          size="xs"
          value={mode()}
          data={SECTOR_52W_BREADTH_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          onChange={(value) => {
            if (value === "high" || value === "low") setMode(value);
          }}
          aria-label={`52-week breadth measure — ${SECTOR_52W_BREADTH_OPTIONS.map((option) => option.hint).join("; ")}`}
          data-testid="sector-52w-breadth-toggle"
        />
        <Box className="flex-1 min-w-0" />
        <Text span size="xs" c={VIZ_MUTED} data-testid="sector-52w-breadth-count">
          {breadth().length} sectors
        </Text>
      </ToolbarRow>

      <Show
        when={breadth().length > 0}
        fallback={
          <Box
            className="flex-1 min-w-0 min-h-0 flex items-center justify-center p-4"
            data-testid="sector-52w-breadth-empty"
          >
            <Text span size="sm" c={VIZ_MUTED}>
              No 52-week breadth data.
            </Text>
          </Box>
        }
      >
        <Box
          className="flex-1 min-w-0 min-h-0 flex flex-col overflow-auto gap-1 p-2"
          style={{ "background-color": VIZ_PANEL }}
          data-testid="sector-52w-breadth"
        >
          <For each={breadth()}>
            {(row) => {
              const key = () => rowKey(row.sector);
              const value = () => (mode() === "high" ? row.nearHighPct : row.nearLowPct);
              const ratio = () => value() / extent();
              const title = () =>
                `${row.sector} · n ${row.n} · near high ${pctText(row.nearHighPct)} · ` +
                `near low ${pctText(row.nearLowPct)} · median ${changeText(row.medianChange)}`;
              return (
                <Box
                  title={title()}
                  className="flex w-full items-center gap-2 rounded-fin border px-2 py-1"
                  style={{ "border-color": VIZ_GRID, "background-color": VIZ_BG }}
                  data-testid={`sector-52w-row-${key()}`}
                >
                  <Text
                    span
                    size="xs"
                    fw={600}
                    c={VIZ_TEXT}
                    title={row.sector}
                    className="w-[96px] sm:w-[140px] flex-shrink-0 truncate leading-tight"
                  >
                    {row.sector}
                  </Text>
                  <Box className="relative flex-1 min-w-0 min-w-[48px] h-4" style={{ "min-width": "48px" }}>
                    <Box
                      className="absolute inset-y-1 rounded-fin"
                      style={{
                        left: "0%",
                        width: `${(ratio() * 100).toFixed(3)}%`,
                        "background-color": breadthBarColor(mode(), ratio()),
                      }}
                      data-testid={`sector-52w-bar-${key()}`}
                    />
                  </Box>
                  <Text
                    span
                    size="xs"
                    c={VIZ_TEXT}
                    className="w-12 flex-shrink-0 text-right font-mono tabular-nums"
                    data-testid={`sector-52w-pct-${key()}`}
                  >
                    {pctText(value())}
                  </Text>
                  <Text
                    span
                    size="xs"
                    c={VIZ_MUTED}
                    title={title()}
                    className="hidden sm:inline-flex flex-shrink-0 font-mono tabular-nums"
                    data-testid={`sector-52w-detail-${key()}`}
                  >
                    {row.n} · near-low {pctText(row.nearLowPct)}
                  </Text>
                </Box>
              );
            }}
          </For>
        </Box>
      </Show>
    </Box>
  );
}
