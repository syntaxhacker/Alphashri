/**
 * Parse a pasted symbol list into a clean, de-duplicated array.
 *
 * Accepts commas, semicolons, pipes, spaces, tabs and newlines as separators,
 * uppercases, trims and drops empties. Order is preserved (first occurrence).
 */
export function parseSymbolList(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\s,;|]+/)) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}
