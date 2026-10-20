import { describe, expect, test } from "vitest";
import { MARKET_CLOSE_MIN, MARKET_OPEN_MIN, isMarketOpenIst, istClock } from "./marketClock";

// 2026-10-21 is a Wednesday. IST is UTC+5:30.
const at = (iso: string) => new Date(iso);

describe("isMarketOpenIst", () => {
  test("opens at 09:15 and closes at 15:30 IST", () => {
    expect(isMarketOpenIst(at("2026-10-21T03:44:00Z"))).toBe(false); // 09:14
    expect(isMarketOpenIst(at("2026-10-21T03:45:00Z"))).toBe(true); //  09:15
    expect(isMarketOpenIst(at("2026-10-21T09:59:00Z"))).toBe(true); //  15:29
    expect(isMarketOpenIst(at("2026-10-21T10:00:00Z"))).toBe(false); // 15:30
  });

  test("is closed on weekends", () => {
    expect(isMarketOpenIst(at("2026-10-24T06:00:00Z"))).toBe(false); // Saturday 11:30
    expect(isMarketOpenIst(at("2026-10-25T06:00:00Z"))).toBe(false); // Sunday
  });

  test("is open on a weekday midday", () => {
    expect(isMarketOpenIst(at("2026-10-21T06:00:00Z"))).toBe(true); // 11:30 IST
  });
});

describe("istClock", () => {
  test("reports the IST weekday and minute of day", () => {
    expect(istClock(at("2026-10-21T03:45:00Z"))).toEqual({ weekday: "Wed", minutes: 555 });
    expect(istClock(at("2026-10-21T10:00:00Z"))).toEqual({ weekday: "Wed", minutes: 930 });
  });

  test("constants match the session", () => {
    expect(MARKET_OPEN_MIN).toBe(555);
    expect(MARKET_CLOSE_MIN).toBe(930);
  });
});
