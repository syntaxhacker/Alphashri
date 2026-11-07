import { isIndianIndex } from "./tvSymbols";

export type IndexGroup = "all" | "big" | "others";

const BIG_INDEX_IDS = new Set([
  "NIFTY",
  "BANKNIFTY",
  "FINNIFTY",
  "MIDCPNIFTY",
  "NIFTYNXT50",
  "NIFTY100",
  "NIFTY200",
  "NIFTY500",
  "SENSEX",
  "BANKEX",
]);

const NON_MEMBER_INDEX_IDS = new Set(["INDIAVIX"]);

export function hasIndexMembers(symbol: string): boolean {
  const key = String(symbol ?? "").trim().toUpperCase();
  return isIndianIndex(key) && !NON_MEMBER_INDEX_IDS.has(key);
}

export function indexGroupOf(symbol: string): "big" | "others" {
  return BIG_INDEX_IDS.has(String(symbol ?? "").trim().toUpperCase()) ? "big" : "others";
}

export function filterByIndexGroup<T extends { symbol: string }>(
  rows: T[],
  group: IndexGroup,
): T[] {
  if (group === "all") return rows;
  return rows.filter((row) => indexGroupOf(row.symbol) === group);
}
