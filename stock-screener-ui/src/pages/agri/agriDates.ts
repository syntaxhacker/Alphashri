import { sessionDateKey } from "@/utils/chart/time";

/**
 * Session date `days` before the IST "today" behind `nowMs`.
 *
 * `new Date(ms).toISOString().slice(0, 10)` is the UTC calendar date: between
 * 00:00 and 05:30 IST it is yesterday, so the relative-price lookups landed a
 * day early. Resolve the IST session first, then do plain date arithmetic on
 * the date-only key (UTC-midnight anchored, so no further zone drift).
 */
export function agriDateDaysAgo(days: number, nowMs: number = Date.now()): string {
  const today = sessionDateKey(new Date(nowMs).toISOString());
  if (!today) return "";
  const base = new Date(`${today}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - days);
  return base.toISOString().slice(0, 10);
}

/**
 * Start of a range anchored to the latest collected session, not wall-clock
 * today — a stale collection still yields a meaningful window. `days === null`
 * is MAX (the full history).
 */
export function agriRangeStart(asOf: string | null | undefined, days: number | null): string {
  if (!asOf || days == null || !Number.isFinite(days)) return asOf ?? "";
  const date = asOf.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return asOf;
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - days);
  return base.toISOString().slice(0, 10);
}

/** Display an ISO session date without letting the local zone shift the day. */
export function formatAgriSessionDate(date: string | null | undefined): string {
  if (!date) return "—";
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return date;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}
