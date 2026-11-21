/**
 * Structural guard for a decoded JSON object. Arrays are not records: a saved
 * layout or wire envelope is an object bag, and treating `[]` as one silently
 * accepts the wrong shape.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
