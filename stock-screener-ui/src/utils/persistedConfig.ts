/**
 * Pure parsers shared by the persisted-config (saved-config) adapters.
 *
 * A saved config is untrusted wire data: fields can be missing, the wrong type,
 * or stale. These helpers degrade a bad field to a safe value instead of letting
 * one retired id or non-string poison the whole payload. List helpers impose no
 * length cap, so a user's saved list round-trips exactly as it was written.
 */

/** Cheap structural guard for a decoded JSON object (arrays are not records). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True only for a string with at least one non-whitespace character. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Keep well-formed strings in first-seen order, dropping non-strings, blank
 * strings and duplicates. Values are kept verbatim (not trimmed) so a saved
 * list round-trips unchanged; trimming is used only to detect blank entries.
 */
export function parseStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (!isNonEmptyString(item)) continue;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}
