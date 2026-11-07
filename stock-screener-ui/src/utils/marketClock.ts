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
export const SESSION_START_MIN = 9 * 60 + 15;
/** 15:30 IST — cash-market session close (15:15–15:30 is the closing auction). */
export const MARKET_CLOSE_MIN = 15 * 60 + 30;
/** 15:29 IST — last recorded minute for cash replay (15:30 is closing auction). */
export const SESSION_END_MIN = MARKET_CLOSE_MIN - 1;
/** Replay session length in minutes: 09:15 → 15:29 inclusive = 375 minutes. */
export const SESSION_MINUTES = SESSION_END_MIN - SESSION_START_MIN + 1;

/** 15:40 IST — equity derivatives (index + stock F&O) session close. */
export const DERIVATIVES_CLOSE_MIN = 15 * 60 + 40;
/** Derivatives session length in minutes: 09:15 → 15:40 = 6h25 = 385 minutes. */
export const DERIVATIVES_SESSION_MINUTES = DERIVATIVES_CLOSE_MIN - SESSION_START_MIN;

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
  return minutes >= SESSION_START_MIN && minutes < MARKET_CLOSE_MIN;
}

/** True on Mon–Fri between 09:15 and 15:40 IST (holidays excluded). */
export function isDerivativesOpenIst(now: Date = new Date()): boolean {
  const { weekday, minutes } = istClock(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return minutes >= SESSION_START_MIN && minutes < DERIVATIVES_CLOSE_MIN;
}
