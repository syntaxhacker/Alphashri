/**
 * Header data-freshness read for the Nifty report.
 *
 * The report/tape/burst payloads all carry their own clock, but they move at
 * different cadences: the report frame updates on demand, the tape appends one
 * row per minute, bursts land sporadically. The desk only needs one question
 * answered — "is what I am looking at current?" — so this module reduces all
 * of them to a single age, and treats the TAPE as the authority:
 *
 *   tape older than 2 minutes while the market is open  →  STALE
 *
 * Everything is pure so the component can tick the clock without touching the
 * report and the rule is unit-testable on its own.
 */

export const DATA_STALE_AFTER_MS = 2 * 60_000;
/** IST is UTC+05:30, no DST. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface DataFreshnessReportLike {
  fetchedAt?: string | null;
  market?: {
    is_open?: boolean | null;
    session_date?: string | null;
    as_of?: string | null;
  } | null;
}

export interface DataFreshnessTapeLike {
  date?: string | null;
  rows?: Array<{ t?: string | null }> | null;
}

export interface DataFreshnessInput {
  nowMs: number;
  /** NSE cash session is open. A closed market is never "stale". */
  marketOpen: boolean;
  /** Session date used to date the tape's bare `HH:MM` timestamps. */
  sessionDate?: string | null;
  report?: DataFreshnessReportLike | null;
  tape?: DataFreshnessTapeLike | null;
  bursts?: Array<{ t?: string | null }> | null;
}

export interface DataFreshness {
  /** Age of the newest tape row; `null` when the tape has no readable row. */
  tapeAgeMs: number | null;
  /** Age of the newest of report/tape/burst; `null` when nothing is readable. */
  ageMs: number | null;
  /** Tape is older than the threshold while the market is open. */
  stale: boolean;
  /**
   * Header text: `DATA 42s` / `STALE` / `DATA —`. Shows the tape age when a
   * tape is readable (the tape is the freshness authority), else the newest
   * readable timestamp.
   */
  label: string;
  /** Tooltip: what the age was measured from. */
  detail: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Parse a report/tape timestamp to epoch ms. Handles full ISO (with or without
 * an offset), a space-separated timestamp, and bare `HH:MM[:SS]` tape clocks
 * dated by `sessionDate`. Values without an offset are treated as IST.
 */
export function parseIstTimestampMs(
  value: string | null | undefined,
  sessionDate?: string | null,
): number | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const s = raw.replace(" ", "T");

  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
    const parsed = Date.parse(hasZone ? s : `${s}+05:30`);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const bare = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (bare && sessionDate) {
    const date = sessionDate.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const hh = pad2(Number(bare[1]));
    const mm = bare[2];
    const ss = bare[3] ?? "00";
    const parsed = Date.parse(`${date}T${hh}:${mm}:${ss}+05:30`);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/** Compact human age: `42s`, `3m`, `1h 4m`. */
export function formatFreshnessAge(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function newest(values: Array<number | null>): number | null {
  let out: number | null = null;
  for (const v of values) {
    if (v === null) continue;
    if (out === null || v > out) out = v;
  }
  return out;
}

/** Reduce a report + tape + bursts to one header freshness read. */
export function dataFreshness(input: DataFreshnessInput): DataFreshness {
  const sessionDate =
    input.sessionDate ??
    input.report?.market?.session_date ??
    input.tape?.date ??
    null;

  const reportTs =
    parseIstTimestampMs(input.report?.market?.as_of, sessionDate) ??
    parseIstTimestampMs(input.report?.fetchedAt, sessionDate);

  let tapeTs: number | null = null;
  for (const row of input.tape?.rows ?? []) {
    const ts = parseIstTimestampMs(row?.t, sessionDate);
    if (ts !== null && (tapeTs === null || ts > tapeTs)) tapeTs = ts;
  }

  let burstTs: number | null = null;
  for (const b of input.bursts ?? []) {
    const ts = parseIstTimestampMs(b?.t, sessionDate);
    if (ts !== null && (burstTs === null || ts > burstTs)) burstTs = ts;
  }

  const last = newest([reportTs, tapeTs, burstTs]);
  const ageMs = last === null ? null : Math.max(0, input.nowMs - last);
  const tapeAgeMs = tapeTs === null ? null : Math.max(0, input.nowMs - tapeTs);

  // Only the TAPE's age can declare the desk stale — a freshly fetched report
  // stamped "now" must not hide a tape that stopped three minutes ago.
  const stale =
    input.marketOpen && tapeAgeMs !== null && tapeAgeMs > DATA_STALE_AFTER_MS;

  // The badge answers "is the tape current?", so it shows the TAPE's age when
  // the tape is readable. A freshly fetched report is not evidence that the
  // feed is moving — only a recent tape row is.
  const labelAgeMs = tapeAgeMs ?? ageMs;
  const label = stale
    ? "STALE"
    : labelAgeMs === null
      ? "DATA —"
      : `DATA ${formatFreshnessAge(labelAgeMs)}`;

  const parts = [
    tapeAgeMs !== null ? `tape ${formatFreshnessAge(tapeAgeMs)} old` : "tape unavailable",
    reportTs !== null
      ? `report ${formatFreshnessAge(Math.max(0, input.nowMs - reportTs))} old`
      : null,
    burstTs !== null
      ? `last event ${formatFreshnessAge(Math.max(0, input.nowMs - burstTs))} old`
      : null,
    !input.marketOpen ? "market closed" : stale ? "tape is behind" : "live",
  ].filter((p): p is string => typeof p === "string");

  return { tapeAgeMs, ageMs, stale, label, detail: parts.join(" · ") };
}

/** Epoch ms → the IST session date (`YYYY-MM-DD`) a timestamp belongs to. */
export function istSessionDate(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}
