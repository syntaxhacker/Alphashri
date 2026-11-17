import { describe, expect, test } from "vitest";
import {
  SESSION_START_MIN,
  MARKET_CLOSE_MIN,
  DERIVATIVES_CLOSE_MIN,
  DERIVATIVES_SESSION_MINUTES,
  US_SESSION_START_MIN,
  US_MARKET_CLOSE_MIN,
  isMarketOpenIst,
  isDerivativesOpenIst,
  isUsMarketOpen,
  istClock,
  etClock,
} from "./marketClock";

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

describe("isDerivativesOpenIst", () => {
  test("opens at 09:15 and closes at 15:40 IST", () => {
    expect(isDerivativesOpenIst(at("2026-10-21T03:44:00Z"))).toBe(false); // 09:14
    expect(isDerivativesOpenIst(at("2026-10-21T03:45:00Z"))).toBe(true); //  09:15
    expect(isDerivativesOpenIst(at("2026-10-21T10:09:00Z"))).toBe(true); //  15:39
    expect(isDerivativesOpenIst(at("2026-10-21T10:10:00Z"))).toBe(false); // 15:40
  });
});

describe("istClock", () => {
  test("reports the IST weekday and minute of day", () => {
    expect(istClock(at("2026-10-21T03:45:00Z"))).toEqual({ weekday: "Wed", minutes: 555 });
    expect(istClock(at("2026-10-21T10:00:00Z"))).toEqual({ weekday: "Wed", minutes: 930 });
    expect(istClock(at("2026-10-21T10:10:00Z"))).toEqual({ weekday: "Wed", minutes: 940 });
  });

  test("constants match the sessions", () => {
    expect(SESSION_START_MIN).toBe(555);
    expect(MARKET_CLOSE_MIN).toBe(930);
    expect(DERIVATIVES_CLOSE_MIN).toBe(940);
    expect(DERIVATIVES_SESSION_MINUTES).toBe(385);
  });
});

describe("isUsMarketOpen", () => {
  test("opens at 09:30 and closes at 16:00 ET", () => {
    // 2026-11-02 is a Monday in EST (UTC-5) — DST ended 2026-11-01.
    expect(isUsMarketOpen(at("2026-11-02T14:29:00Z"))).toBe(false); // 09:29 EST
    expect(isUsMarketOpen(at("2026-11-02T14:30:00Z"))).toBe(true); //  09:30 EST
    expect(isUsMarketOpen(at("2026-11-02T20:59:00Z"))).toBe(true); //  15:59 EST
    expect(isUsMarketOpen(at("2026-11-02T21:00:00Z"))).toBe(false); // 16:00 EST
  });

  test("is closed on weekends", () => {
    expect(isUsMarketOpen(at("2026-10-24T15:00:00Z"))).toBe(false); // Saturday 11:00 EDT
    expect(isUsMarketOpen(at("2026-10-25T15:00:00Z"))).toBe(false); // Sunday (EDT→EST day)
  });

  test("follows DST: the same UTC instant is judged in EDT during summer", () => {
    // 2026-07-15 is a Wednesday in EDT (UTC-4). A fixed -5 assumption would
    // read 13:30Z as 08:30 and call the session closed.
    expect(etClock(at("2026-07-15T13:30:00Z"))).toEqual({ weekday: "Wed", minutes: 570 });
    expect(isUsMarketOpen(at("2026-07-15T13:29:00Z"))).toBe(false); // 09:29 EDT
    expect(isUsMarketOpen(at("2026-07-15T13:30:00Z"))).toBe(true); //  09:30 EDT
    expect(isUsMarketOpen(at("2026-07-15T19:59:00Z"))).toBe(true); //  15:59 EDT
    expect(isUsMarketOpen(at("2026-07-15T20:00:00Z"))).toBe(false); // 16:00 EDT
  });

  test("constants match the US session", () => {
    expect(US_SESSION_START_MIN).toBe(570);
    expect(US_MARKET_CLOSE_MIN).toBe(960);
  });
});
