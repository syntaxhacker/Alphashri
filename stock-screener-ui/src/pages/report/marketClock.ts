/**
 * NSE session clock (IST).
 *
 * Holidays are deliberately *not* modelled here: the replay-dates endpoint
 * only lists days that actually recorded snapshots, so a holiday resolves to
 * the last real session. This helper answers the simpler question — "is the
 * exchange open right now?" — which decides whether the report should open on
 * Live or on the newest recorded day.
 */

/** 09:15 IST — continuous trading starts. */
export const MARKET_OPEN_MIN = 9 * 60 + 15;
/** 15:30 IST — session close (15:15–15:30 is the closing auction). */
export const MARKET_CLOSE_MIN = 15 * 60 + 30;

/** IST weekday + minute-of-day for `now`. */
export function istClock(now: Date = new Date()): { weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(pick("hour")) % 24;
  const minute = Number(pick("minute"));
  return {
    weekday: pick("weekday"),
    minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
  };
}

/** True on Mon–Fri between 09:15 and 15:30 IST (holidays excluded). */
export function isMarketOpenIst(now: Date = new Date()): boolean {
  const { weekday, minutes } = istClock(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return minutes >= MARKET_OPEN_MIN && minutes < MARKET_CLOSE_MIN;
}
