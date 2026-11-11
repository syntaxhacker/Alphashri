/**
 * Unified chart time utilities.
 *
 * Replaces duplicate implementations in:
 * - TradingViewChart.toTime / zoomToTimeRange
 * - patternTVData.toTVTime (via parseEngineTimestamp)
 * - chartTimeUtils.formatTimeLabel
 * - ui-helpers.parseTimeToHHMM
 * - NiftyDepthMap.candleEpochMs (marked as remaining, will migrate later)
 */

const IST_OFFSET = "+05:30";
const MS_PER_SEC = 1000;
/** IST is a fixed +05:30 offset (no DST), so epoch → IST is a plain shift. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Parse a timestamp string as IST and return epoch seconds.
 *
 * Accepts:
 * - "YYYY-MM-DD HH:MM" (space separator, no offset) → pinned to IST
 * - "YYYY-MM-DDTHH:MM" (T separator, no offset) → pinned to IST
 * - "YYYY-MM-DD HH:MM:SS" / "YYYY-MM-DDTHH:MM:SS" → pinned to IST
 * - Same with explicit "+05:30" or "Z" offset → parsed as-is
 * - Date-only "YYYY-MM-DD" → midnight IST
 *
 * A bare timestamp (no offset) is always interpreted as IST (Asia/Kolkata),
 * not the host timezone or UTC.
 *
 * Returns epoch **seconds** (matching lightweight-charts `UTCTimestamp`).
 */
export function toEpochSeconds(time: string): number {
  const trimmed = time.trim();
  if (!trimmed) return NaN;

  // Already has timezone offset (Z or ±HH:MM) → parse directly
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const ms = Date.parse(trimmed);
    return Number.isNaN(ms) ? NaN : ms / MS_PER_SEC;
  }

  // Date only → midnight IST
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const ms = Date.parse(`${trimmed}T00:00:00${IST_OFFSET}`);
    return Number.isNaN(ms) ? NaN : ms / MS_PER_SEC;
  }

  // Naive datetime (space or T separator) → pin to IST
  const iso = trimmed.replace(" ", "T");
  const ms = Date.parse(`${iso}${IST_OFFSET}`);
  return Number.isNaN(ms) ? NaN : ms / MS_PER_SEC;
}

/**
 * Parse a timestamp string or numeric value and return epoch milliseconds.
 *
 * Accepts:
 * - Numeric epoch seconds (< 1e12) → multiplied by 1000
 * - Numeric epoch milliseconds (≥ 1e12) → passed through
 * - String with explicit offset (Z or ±HH:MM) → parsed as-is
 * - String without offset, length 19 ("YYYY-MM-DDTHH:MM:SS") → pinned to IST
 * - String without offset, other formats → parsed as-is (best effort)
 * - Empty, whitespace, "NaT", NaN → NaN
 *
 * Returns epoch **milliseconds** (standard JS `Date.getTime()`).
 */
export function toEpochMs(time: string | number): number {
  if (typeof time === "number") {
    if (!Number.isFinite(time)) return NaN;
    return time < 1e12 ? time * MS_PER_SEC : time;
  }
  if (typeof time !== "string" || time.trim().length === 0) return NaN;

  const s = time.trim();
  if (/^nat$/i.test(s)) return NaN;

  const hasTz = /Z|[+-]\d{2}:?\d{2}$/.test(s);
  // Length 19 = "YYYY-MM-DDTHH:MM:SS" (no timezone)
  const iso = !hasTz && s.length === 19 ? `${s}${IST_OFFSET}` : s;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? NaN : ms;
}

/**
 * Format a time value for chart axis labels (HH:MM).
 *
 * Accepts:
 * - Epoch milliseconds (number)
 * - Epoch seconds (number, < 1e12) — auto-detected and scaled
 * - ISO string with "T" separator → extracts HH:MM
 * - Space-separated datetime string → extracts HH:MM
 * - Already "HH:MM" or "HH:MM:SS" → returns HH:MM
 * - Other strings → returned as-is (best effort)
 * - null/undefined → empty string
 *
 * Epochs are rendered in IST (the exchange timezone), never in the host
 * timezone — a CI runner in UTC must produce the same label as a laptop in
 * IST.
 *
 * The `kind` parameter is reserved for future "FULL" format (date + time).
 * Currently only "HM" (default) is implemented.
 */
export function formatChartTimeLabel(
  epochMsOrString: string | number | null | undefined,
  kind: "HM" | "FULL" = "HM",
): string {
  if (epochMsOrString == null) return "";
  if (typeof epochMsOrString === "number") {
    if (!Number.isFinite(epochMsOrString)) return "";
    const ms = epochMsOrString < 1e12 ? epochMsOrString * MS_PER_SEC : epochMsOrString;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return "";
    const ist = new Date(ms + IST_OFFSET_MS);
    const hh = String(ist.getUTCHours()).padStart(2, "0");
    const mm = String(ist.getUTCMinutes()).padStart(2, "0");
    return kind === "FULL"
      ? `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")} ${hh}:${mm}`
      : `${hh}:${mm}`;
  }

  const s = String(epochMsOrString).trim();
  if (!s) return "";

  // ISO with T separator
  if (s.includes("T")) {
    const timePart = s.split("T")[1]?.substring(0, 5);
    return timePart ?? s;
  }

  // Space-separated datetime
  if (s.includes(" ")) {
    const timePart = s.split(" ")[1]?.substring(0, 5);
    return timePart ?? s;
  }

  // Already time-like (HH:MM or HH:MM:SS)
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
    return s.substring(0, 5);
  }

  // Fallback: return as-is
  return s;
}

/** Re-export aliases for backward compatibility with existing imports. */
export { toEpochSeconds as toTVTime };
export { toEpochMs as candleEpochMs };
export { formatChartTimeLabel as formatTimeLabel };
export { formatChartTimeLabel as parseTimeToHHMM };