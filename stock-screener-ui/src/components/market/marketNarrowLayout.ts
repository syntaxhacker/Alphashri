import { createSignal, onCleanup, onMount } from "solid-js";
import type { TableColumnDef as ColumnDef } from "../common/TanStackTable";

/** Below this width the Market table leads with its four readable metrics. */
export const MARKET_NARROW_BREAKPOINT = 900;
export const MARKET_NARROW_QUERY = `(max-width: ${MARKET_NARROW_BREAKPOINT - 1}px)`;

/**
 * Reading order at narrow widths: identity, price, change, then sector. The
 * other Market columns stay in the table and scroll sideways behind SECTOR.
 */
export const MARKET_PRIMARY_IDS = ["symbol", "close", "day_change", "sector"] as const;
export type MarketPrimaryId = (typeof MARKET_PRIMARY_IDS)[number];

const isPrimary = (id: string): id is MarketPrimaryId =>
  (MARKET_PRIMARY_IDS as readonly string[]).includes(id);

/** Short but complete headers; the long form ("DAY %") needs a wider cell. */
const NARROW_LABELS: Readonly<Partial<Record<MarketPrimaryId, string>>> = {
  symbol: "SYMBOL",
  close: "LTP",
  day_change: "CHG%",
  sector: "SECTOR",
};

/** Fixed sizes keep the four leading columns inside a 390px results panel. */
const NARROW_WIDTHS: Readonly<Record<MarketPrimaryId, number>> = {
  symbol: 126,
  close: 80,
  day_change: 64,
  sector: 84,
};

export const MARKET_NARROW_PRIMARY_WIDTH = MARKET_PRIMARY_IDS.reduce(
  (sum, id) => sum + NARROW_WIDTHS[id],
  0,
);

export function useMarketNarrow() {
  const initial = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MARKET_NARROW_QUERY).matches;
  const [narrow, setNarrow] = createSignal(initial());

  onMount(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(MARKET_NARROW_QUERY);
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener?.("change", sync);
    onCleanup(() => query.removeEventListener?.("change", sync));
  });

  return narrow;
}

/** Primary metrics first in reading order; every other column keeps its place. */
export function narrowMarketColumns<T>(columns: ColumnDef<T>[], narrow = true): ColumnDef<T>[] {
  if (!narrow) return columns;
  const byId = new Map(columns.map((col) => [String(col.id), col]));
  const primary = MARKET_PRIMARY_IDS.map((id) => byId.get(id)).filter(
    (col): col is ColumnDef<T> => col !== undefined,
  );
  return [...primary, ...columns.filter((col) => !isPrimary(String(col.id)))];
}

/** Apply short headers and primary widths without mutating the shared defs. */
export function applyMarketNarrowLayout<T>(columns: ColumnDef<T>[], narrow = true): ColumnDef<T>[] {
  if (!narrow) return columns;
  return columns.map((col) => {
    const id = String(col.id);
    if (!isPrimary(id)) return col;
    return {
      ...col,
      header: NARROW_LABELS[id] ?? col.header,
      size: NARROW_WIDTHS[id],
    };
  });
}
