import { createSignal, onCleanup, onMount } from "solid-js";
import type { ColumnDef } from "./columns";

/** Below this width results get the whole row: no GROUPS rail beside the table. */
export const SCREENER_NARROW_BREAKPOINT = 900;
export const SCREENER_NARROW_QUERY = `(max-width: ${SCREENER_NARROW_BREAKPOINT - 1}px)`;

/**
 * Primary metrics in reading order: identity, then change and price (the two
 * numbers a row cannot be read without), then sector and volume if they fit.
 * At 390 all four fit inside the 356px results panel.
 */
const PRIMARY_METRICS: ReadonlyArray<{ keys: readonly string[]; min: number }> = [
  { keys: ["day_change", "chg", "change", "change_pct"], min: 58 },
  { keys: ["upstox_price", "ltp", "last_price", "tv_price", "price", "close"], min: 62 },
  { keys: ["sector"], min: 70 },
  { keys: ["volume_m", "turnover", "volume", "relative_volume", "volume_surge"], min: 52 },
];

const NARROW_SELECTION_WIDTH = 24;
const NARROW_SYMBOL_WIDTH = 80;

/** Short headers keep every primary metric readable in a ~60px narrow cell. */
const NARROW_LABELS: Readonly<Record<string, string>> = {
  day_change: "CHG%",
  chg: "CHG%",
  change: "CHG%",
  change_pct: "CHG%",
  sector: "SECTOR",
  volume_m: "VOL",
  volume: "VOL",
  turnover: "T/O",
  relative_volume: "REL VOL",
  volume_surge: "VOL x",
  upstox_price: "LTP",
  ltp: "LTP",
  last_price: "LTP",
  close: "LTP",
  tv_price: "PRICE",
  price: "LTP",
};

export function narrowLabel(col: ColumnDef): string {
  return NARROW_LABELS[col.key] ?? col.label;
}

/** Minimum width for a header label at the table's monospace micro type. */
function labelWidth(label: string): number {
  return Math.min(130, Math.ceil(label.length * 7.6) + 24);
}

/** Currency/percent cells need room for the value, not just the header text. */
const WIDE_MIN: Readonly<Record<string, number>> = {
  selection: 28,
  symbol: 88,
  score: 64,
  touched_52w: 76,
  tv_price: 96,
  upstox_price: 96,
  last_price: 96,
  ltp: 96,
  close: 96,
  price: 96,
  day_change: 96,
  change: 96,
  to_52w_high: 96,
  recent_return_5d: 88,
  perf_w: 76,
  volume_m: 88,
  volume: 88,
  turnover: 88,
  rsi: 60,
  adx: 60,
  sector: 110,
};

export function useScreenerNarrow() {
  const initial = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(SCREENER_NARROW_QUERY).matches;
  const [narrow, setNarrow] = createSignal(initial());

  onMount(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(SCREENER_NARROW_QUERY);
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener?.("change", sync);
    onCleanup(() => query.removeEventListener?.("change", sync));
  });

  return narrow;
}

/** Symbol first, then the primary metrics the profile actually declares. */
export function narrowMetricColumns(columns: ColumnDef[]): ColumnDef[] {
  const byKey = new Map(columns.map((col) => [col.key, col]));
  const symbol = byKey.get("symbol");
  const metrics: ColumnDef[] = [];
  for (const metric of PRIMARY_METRICS) {
    const found = metric.keys.map((key) => byKey.get(key)).find((col): col is ColumnDef => !!col);
    if (found && found !== symbol) metrics.push(found);
  }
  return symbol ? [symbol, ...metrics] : metrics;
}

/**
 * Explicit column widths in px. Fixed sizing keeps the last column (sector)
 * inside the panel instead of letting auto layout spill it past the right edge,
 * and keeps the narrow table inside one viewport with no sideways hunting.
 */
export function screenerColumnWidths(
  columns: ColumnDef[],
  available: number,
  narrow: boolean,
): Map<string, number> {
  const widths = new Map<string, number>();
  if (narrow) {
    widths.set("selection", NARROW_SELECTION_WIDTH);
    let budget = Math.max(available, 0) - NARROW_SELECTION_WIDTH - NARROW_SYMBOL_WIDTH;
    for (const col of columns) {
      if (col.key === "symbol") continue;
      const min = PRIMARY_METRICS.find((m) => m.keys.includes(col.key))?.min ?? 56;
      if (budget >= min) {
        widths.set(col.key, min);
        budget -= min;
      }
    }
    // Spend the leftover on the identity column rather than leaving a gap.
    widths.set("symbol", NARROW_SYMBOL_WIDTH + Math.max(0, Math.floor(budget)));
    return widths;
  }

  const mins = columns.map((col) => Math.max(labelWidth(col.label), WIDE_MIN[col.key] ?? 64));
  const total = mins.reduce((sum, width) => sum + width, 0) + 28;
  const extra = Math.max(0, available - total);
  const weights = columns.map((col, index) => mins[index] * (col.key === "sector" ? 1.4 : 1));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  columns.forEach((col, index) => {
    widths.set(col.key, mins[index] + Math.floor((extra * weights[index]) / weightTotal));
  });
  widths.set("selection", 28);
  return widths;
}
