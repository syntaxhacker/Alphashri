export type MinimalScreenerData = {
  provider: string;
  mode: string;
  screener: string;
  approaching?: Array<{ symbol: string }>;
  touched?: Array<{ symbol: string }>;
};

export function detectAddedSymbols(
  prev: MinimalScreenerData | null,
  next: MinimalScreenerData | null,
): { addedPrimary: string[]; addedSecondary: string[] } {
  if (!prev || !next) return { addedPrimary: [], addedSecondary: [] };
  if (
    prev.provider !== next.provider ||
    prev.mode !== next.mode ||
    prev.screener !== next.screener
  ) {
    return { addedPrimary: [], addedSecondary: [] };
  }

  const prevPrimary = new Set((prev.approaching || []).map((s) => s.symbol));
  const nextPrimary = (next.approaching || []).map((s) => s.symbol);
  const addedPrimary = nextPrimary.filter((s) => !prevPrimary.has(s));

  const prevSecondary = new Set((prev.touched || []).map((s) => s.symbol));
  const nextSecondary = (next.touched || []).map((s) => s.symbol);
  const addedSecondary = nextSecondary.filter((s) => !prevSecondary.has(s));

  return { addedPrimary, addedSecondary };
}

export function buildProfileFilterQueryParams(values: Record<string, string | number> | null | undefined): string {
  if (!values) return "";
  const entries = Object.entries(values);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => `pf_${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

export function getTradingList(stocks: Array<{ symbol: string }> | null | undefined): string {
  if (!stocks || stocks.length === 0) return "";
  const unique = Array.from(new Set(stocks.map((s) => s.symbol).filter(Boolean)));
  return unique.join(",");
}
