/**
 * API rows can omit bot limits. Render a dash instead of the JS coercions
 * `String(undefined)` / `(undefined * 100).toFixed(0)` produced on the list.
 */
function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatBotMaxPositions(value: number | null | undefined): string {
  return finite(value) ? String(value) : "—";
}

/** `max_total_capital_pct` is a fraction (0.5 → 50%). */
export function formatBotCapitalPct(value: number | null | undefined): string {
  return finite(value) ? `${(value * 100).toFixed(0)}%` : "—";
}
