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
