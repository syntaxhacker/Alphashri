/**
 * Unified chart time utilities.
 *
 * Replaces duplicate implementations in:
 * - TradingViewChart.toTime / zoomToTimeRange
 * - patternTVData.toTVTime (via parseEngineTimestamp)
 * - formatTimeLabel (former chartTimeUtils shim)
 * - ui-helpers.parseTimeToHHMM
 * - NiftyDepthMap.candleEpochMs (marked as remaining, will migrate later)
 *
 * All parsers default to the existing IST behaviour so India charts are
 * byte-identical. A caller may pass an explicit IANA time zone (e.g. the US
 * session's `America/New_York`) for naive strings; explicit UTC offsets on the
 * input are always honoured as the true instant regardless of that argument.
 */

import { TZ_IST } from "@/config/constants";

const MS_PER_SEC = 1000;
/** IST is a fixed +05:30 offset (no DST), so epoch → IST is a plain shift. */
const IST_OFFSET = "+05:30";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** IANA zone used for US cash-session timestamps (DST-aware, unlike +05:30). */
export const TZ_US = "America/New_York" as const;

export type ChartMarket = "india" | "usa";

/** One descriptor per market — no scattered `if (market === ...)` branches. */
export const MARKET_TIME_ZONE: Readonly<Record<ChartMarket, string>> = {
  india: TZ_IST,
  usa: TZ_US,
};

const HAS_OFFSET_RE = /[zZ]$|[+-]\d{2}:?\d{2}$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const NAIVE_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

const isIst = (timeZone: string): boolean => timeZone === TZ_IST;

interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const zonePartsFormatters = new Map<string, Intl.DateTimeFormat>();

function zonePartsFormatter(timeZone: string): Intl.DateTimeFormat | null {
  let fmt = zonePartsFormatters.get(timeZone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return null;
    }
    zonePartsFormatters.set(timeZone, fmt);
  }
  return fmt;
}

/** Calendar/time parts of an instant in a named zone. Falls back to IST. */
function partsInZone(ms: number, timeZone: string): ZoneParts {
  const fmt = zonePartsFormatter(timeZone) ?? zonePartsFormatter(TZ_IST)!;
  const parts = fmt.formatToParts(new Date(ms));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const hour = get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: hour === 24 ? 0 : hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset (ms east of UTC) of a named zone at an instant — DST-aware. */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const wholeSecond = ms - (ms % MS_PER_SEC);
  const { year, month, day, hour, minute, second } = partsInZone(ms, timeZone);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return wallAsUtc - wholeSecond;
}

/**
 * Resolve a naive wall-clock string in a named zone to epoch milliseconds.
 * Two passes are enough to converge on the right DST offset for every real
 * market hour; a nonexistent spring-forward wall time lands on a deterministic
 * nearby instant instead of throwing.
 */
function zonedNaiveToEpochMs(naive: string, timeZone: string): number {
  const match = NAIVE_RE.exec(naive);
  if (!match) return NaN;
  const [, y, mo, d, h, mi, s = "00", frac = ""] = match;
  const wallAsUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
    Number((frac + "000").slice(0, 3)),
  );
  if (Number.isNaN(wallAsUtc)) return NaN;
  let epoch = wallAsUtc;
  for (let pass = 0; pass < 2; pass++) {
    epoch = wallAsUtc - zoneOffsetMs(epoch, timeZone);
  }
  return epoch;
}

/**
 * Parse a timestamp string as IST and return epoch seconds.
 *
 * Accepts:
 * - "YYYY-MM-DD HH:MM" (space separator, no offset) → pinned to IST
 * - "YYYY-MM-DDTHH:MM" (T separator, no offset) → pinned to IST
 * - "YYYY-MM-DD HH:MM:SS" / "YYYY-MM-DDTHH:MM:SS" → pinned to IST
 * - Same with an explicit "+05:30", "-05:00" or "Z" offset → parsed as-is
 * - Date-only "YYYY-MM-DD" → midnight in the requested zone
 *
 * A bare timestamp (no offset) is pinned to `timeZone`, which defaults to IST
 * (Asia/Kolkata) — never the host timezone. Pass `TZ_US` for a US session; a
 * US candle that already carries an explicit offset is unaffected by this.
 *
 * Returns epoch **seconds** (matching lightweight-charts `UTCTimestamp`).
 */
export function toEpochSeconds(time: string, timeZone: string = TZ_IST): number {
  const trimmed = time.trim();
  if (!trimmed) return NaN;

  // Explicit offset (Z or ±HH:MM) → the true instant, independent of `timeZone`.
  if (HAS_OFFSET_RE.test(trimmed)) {
    const ms = Date.parse(trimmed);
    return Number.isNaN(ms) ? NaN : ms / MS_PER_SEC;
  }

  // Date only → midnight in the requested zone.
  if (DATE_ONLY_RE.test(trimmed)) {
    const ms = isIst(timeZone)
      ? Date.parse(`${trimmed}T00:00:00${IST_OFFSET}`)
      : zonedNaiveToEpochMs(`${trimmed}T00:00:00`, timeZone);
    return Number.isNaN(ms) ? NaN : ms / MS_PER_SEC;
  }

  // Naive datetime (space or T separator) → pin to the requested zone.
  const iso = trimmed.replace(" ", "T");
  const ms = isIst(timeZone)
    ? Date.parse(`${iso}${IST_OFFSET}`)
    : zonedNaiveToEpochMs(iso, timeZone);
  return Number.isNaN(ms) ? NaN : ms / MS_PER_SEC;
}

/**
 * Parse a timestamp string or numeric value and return epoch milliseconds.
 *
 * Accepts:
 * - Numeric epoch seconds (< 1e12) → multiplied by 1000
 * - Numeric epoch milliseconds (≥ 1e12) → passed through
 * - String with explicit offset (Z or ±HH:MM) → parsed as-is
 * - Naive "YYYY-MM-DDTHH:MM:SS" → pinned to `timeZone` (default IST)
 * - Empty, whitespace, "NaT", NaN → NaN
 */
export function toEpochMs(time: string | number, timeZone: string = TZ_IST): number {
  if (typeof time === "number") {
    if (!Number.isFinite(time)) return NaN;
    return time < 1e12 ? time * MS_PER_SEC : time;
  }
  if (typeof time !== "string" || time.trim().length === 0) return NaN;

  const s = time.trim();
  if (/^nat$/i.test(s)) return NaN;

  if (HAS_OFFSET_RE.test(s)) {
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? NaN : ms;
  }

  if (NAIVE_RE.test(s)) {
    const ms = isIst(timeZone)
      ? Date.parse(s.replace(" ", "T") + IST_OFFSET)
      : zonedNaiveToEpochMs(s, timeZone);
    return Number.isNaN(ms) ? NaN : ms;
  }

  // Other formats → best effort against the host, as before.
  const ms = new Date(s).getTime();
  return Number.isNaN(ms) ? NaN : ms;
}

const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();

/** `YYYY-MM-DD` session key for an instant, in a named zone. */
function toDateKey(ms: number, timeZone: string): string {
  let fmt = dateKeyFormatters.get(timeZone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ_IST,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
    dateKeyFormatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(new Date(ms));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Session/calendar date (`YYYY-MM-DD`) behind a candle or hit timestamp.
 *
 * - A bare calendar date already *is* a session date → returned unchanged.
 * - An ISO instant (with an explicit offset or naive) is resolved and rendered
 *   in `timeZone`. A `-05:00` ET bar late in the session must key to its ET
 *   date, not the IST date it maps to 9½ hours later.
 */
export function sessionDateKey(
  value: string | null | undefined,
  timeZone: string = TZ_IST,
): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const trimmed = value.trim();
  if (DATE_ONLY_RE.test(trimmed)) return trimmed;

  const ms = HAS_OFFSET_RE.test(trimmed)
    ? Date.parse(trimmed)
    : zonedNaiveToEpochMs(trimmed.replace(" ", "T"), timeZone);
  return Number.isNaN(ms) ? null : toDateKey(ms, timeZone);
}

/**
 * Format a time value for chart axis labels (HH:MM).
 *
 * Accepts epoch ms / epoch seconds / ISO strings / HH:MM strings. Epochs are
 * rendered in `timeZone` (default IST), so a CI runner in UTC produces the
 * same label as a trader's terminal. Named zones are DST-aware.
 *
 * The `kind` parameter is reserved for "FULL" (date + time), also in-zone.
 */
export function formatChartTimeLabel(
  epochMsOrString: string | number | null | undefined,
  kind: "HM" | "FULL" = "HM",
  timeZone: string = TZ_IST,
): string {
  if (epochMsOrString == null) return "";
  if (typeof epochMsOrString === "number") {
    if (!Number.isFinite(epochMsOrString)) return "";
    const ms = epochMsOrString < 1e12 ? epochMsOrString * MS_PER_SEC : epochMsOrString;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return "";
    const ist = new Date(ms + IST_OFFSET_MS);
    const p = isIst(timeZone)
      ? {
          year: ist.getUTCFullYear(),
          month: ist.getUTCMonth() + 1,
          day: ist.getUTCDate(),
          hour: ist.getUTCHours(),
          minute: ist.getUTCMinutes(),
        }
      : partsInZone(ms, timeZone);
    const hh = String(p.hour).padStart(2, "0");
    const mm = String(p.minute).padStart(2, "0");
    return kind === "FULL"
      ? `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")} ${hh}:${mm}`
      : `${hh}:${mm}`;
  }

  const s = String(epochMsOrString).trim();
  if (!s) return "";

  // An explicit offset denotes a real instant — render it in the requested zone.
  if (HAS_OFFSET_RE.test(s) && s.length > 5) {
    const ms = Date.parse(s);
    if (!Number.isNaN(ms)) {
      const p = partsInZone(ms, timeZone);
      const hh = String(p.hour).padStart(2, "0");
      const mm = String(p.minute).padStart(2, "0");
      return kind === "FULL"
        ? `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")} ${hh}:${mm}`
        : `${hh}:${mm}`;
    }
  }

  // ISO / space-separated naive strings already carry the exchange's wall clock.
  if (s.includes("T")) return s.split("T")[1]?.substring(0, 5) ?? s;
  if (s.includes(" ")) return s.split(" ")[1]?.substring(0, 5) ?? s;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.substring(0, 5);
  return s;
}

/** Re-export aliases for backward compatibility with existing imports. */
export { toEpochSeconds as toTVTime };
export { toEpochMs as candleEpochMs };
export { formatChartTimeLabel as formatTimeLabel };
export { formatChartTimeLabel as parseTimeToHHMM };
