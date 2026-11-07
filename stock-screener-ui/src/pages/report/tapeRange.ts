/**
 * Timeframe aggregation for the expanded report panes — pure, no React.
 *
 * The tape is one row per minute. Expanding a chart and switching to 5m/15m
 * must *aggregate* the same rows, not resample a rendered SVG:
 *  - volume fields are cumulative, so taking the LAST row of each bucket and
 *    diffing consecutive buckets gives the bucket's total (a true sum);
 *  - the cumulative flow line uses the bucket's last value (the bucket close);
 *  - the gamma regime uses that last value too.
 */

export type TapeRange = 1 | 5 | 15;

export const TAPE_RANGES: TapeRange[] = [1, 5, 15];

/** Minutes-since-midnight for an ISO stamp (T or space) or a bare HH:MM(:SS). */
export function tapeMinute(t: string): number | null {
  return hhmmToMinutes(t, { iso: true });
}

/* ------------------------------------------------------------------ */
/* Shared tape clock helpers (audit M2)                                 */
/*                                                                      */
/* The report modules each grew a private copy of the same three        */
/* idioms — a chronological filter+sort, a clock→minute parser and a    */
/* minute→HH:MM formatter. They live here so the parse and the label    */
/* cannot drift apart between the tape, the flow strip and the bursts.  */
/* ------------------------------------------------------------------ */

/**
 * Chronological tape order: drop rows without a usable timestamp, then
 * stable-sort ascending by `t` (string compare — ISO stamps and bare
 * `HH:MM`/`HH:MM:SS` both order correctly within one format). Always
 * returns a fresh array, so callers may sort it again in place.
 */
export function ascTapeByTime<T extends { t: string }>(
  rows: readonly T[] | null | undefined,
): T[] {
  return (rows ?? [])
    .filter((r) => r && typeof r.t === "string" && r.t.length > 0)
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}

/** Parse options for {@link hhmmToMinutes}. */
export interface HhmmParseOpts {
  /**
   * Also accept a full ISO stamp: the date is peeled off at the first `T`,
   * or at the first space when there is no `T` (`2026-10-26T11:30:00+05:30`,
   * `2026-10-26 11:30`). Bare `HH:MM`/`HH:MM:SS` parse either way.
   */
  iso?: boolean;
}

/**
 * Minutes-since-midnight for a tape timestamp. Accepts bare `HH:MM` and
 * `HH:MM:SS` (1–2 digit hours, 2-digit minutes); with `iso` a full stamp
 * is peeled to its clock first. Hours > 23 (`24:00` — no caller relies on
 * it) and minutes > 59 are rejected, as is anything unparseable → `null`.
 */
export function hhmmToMinutes(t: string, opts?: HhmmParseOpts): number | null {
  if (!t) return null;
  let clock = t;
  if (opts?.iso) {
    const tAt = t.indexOf("T");
    if (tAt >= 0) clock = t.slice(tAt + 1);
    else {
      const spAt = t.indexOf(" ");
      if (spAt >= 0) clock = t.slice(spAt + 1);
    }
  }
  const m = /^(\d{1,2}):(\d{2})/.exec(clock);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Format options for {@link minutesToHhmm}. */
export interface HhmmFormatOpts {
  /** Modulo 1440 first, so minute 1440 formats as `"00:00"` (day wrap). */
  wrap?: boolean;
}

/**
 * Minute of day → zero-padded `HH:MM`. No wrap by default — a minute of
 * 1440 formats as `"24:00"`, exactly like the copy this replaces (every
 * existing caller stays inside 0–1439); pass `wrap` to fold the day.
 */
export function minutesToHhmm(min: number, opts?: HhmmFormatOpts): string {
  const total = opts?.wrap ? ((min % 1440) + 1440) % 1440 : min;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Keep the last row of each `minutes`-wide wall-clock bucket. Rows with an
 * unparseable time are dropped rather than silently pinned to bucket 0.
 */
export function resampleTape<T extends { t: string }>(rows: T[], minutes: TapeRange): T[] {
  if (!rows || rows.length === 0) return [];
  if (minutes <= 1) return rows;
  const byBucket = new Map<number, T>();
  for (const row of rows) {
    const m = tapeMinute(row.t);
    if (m === null) continue;
    byBucket.set(Math.floor(m / minutes), row);
  }
  return [...byBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row);
}

/** Label for a range button ("1m" / "5m" / "15m"). */
export function rangeLabel(range: TapeRange): string {
  return `${range}m`;
}
