import type { ChartMarket } from "@/utils/chart/time";
import type { MarketUniverse } from "@/types/marketScreener";

/**
 * The value markets a market-screener universe can be mapped to. No GLOBAL in
 * v1 — reuses the canonical chart market union so `"india" | "usa"` has one
 * owner. It stays a subset of the value-scan `ValueMarket` wire enum, so a
 * mapped value is always assignable to the API.
 */
export type MappedValueMarket = ChartMarket;

/**
 * Single owner of the universe -> value-market mapping. Keyed by the full
 * `MarketUniverse` union so adding a universe forces an explicit decision here
 * instead of silently falling through to `null`.
 */
const UNIVERSE_TO_VALUE_MARKET: Readonly<Record<MarketUniverse, MappedValueMarket | null>> = {
  all_equity: "india",
  nifty500: "india",
  nifty200: "india",
  nifty100: "india",
  nifty50: "india",
  banknifty: "india",
  sensex: "india",
  nse_fo: "india",
  us: "usa",
};

/**
 * Maps a Market universe to the value tab's market. `null` means the universe
 * has no value-market counterpart in v1 (e.g. a future global universe).
 */
export function marketUniverseToValueMarket(universe: MarketUniverse): MappedValueMarket | null {
  return UNIVERSE_TO_VALUE_MARKET[universe] ?? null;
}
