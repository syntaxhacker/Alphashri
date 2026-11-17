/**
 * Wire-boundary parsers shared by the API clients. Upstream JSON is untrusted:
 * an absent, blank or non-finite value means "unknown", not zero. One contract
 * here stops each client from growing its own subtly different definition.
 */

/** Finite numbers and numeric strings only; everything else is `null`, never `0`. */
export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Non-blank strings only; the original text is kept so callers can trim/case-fold. */
export function finiteText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
