import { describe, expect, test } from "vitest";
import {
  effectiveSessionDate,
  isOnSession,
  selectBaseCandles,
  sessionDateOf,
} from "./niftyChartData";
import type { NiftyReport } from "@/types/niftyReport";
import { mockReport as baseMockReport } from "./reportTestFixtures";

const SESSION = "2026-10-12";
const PREV_SESSION = "2026-10-09";

function mockReport(overrides?: Record<string, unknown>): NiftyReport {
  return baseMockReport(SESSION, overrides);
}

describe("sessionDateOf", () => {
  test("returns the report's own date when present", () => {
    expect(sessionDateOf(mockReport({ date: SESSION }))).toBe(SESSION);
  });

  test("falls back to market.session_date when date is empty", () => {
    const report = mockReport({
      date: "",
      market: { is_open: true, session_date: SESSION, as_of: null },
    });
    expect(sessionDateOf(report)).toBe(SESSION);
  });

  test("prefers date over market.session_date", () => {
    const report = mockReport({
      date: SESSION,
      market: { is_open: true, session_date: PREV_SESSION, as_of: null },
    });
    expect(sessionDateOf(report)).toBe(SESSION);
  });

  test("returns '' when neither date nor market.session_date is present", () => {
    expect(sessionDateOf(mockReport({ date: "" }))).toBe("");
    expect(
      sessionDateOf(mockReport({ date: "", market: { is_open: null, session_date: null, as_of: null } })),
    ).toBe("");
  });
});

describe("isOnSession", () => {
  test("accepts a timestamp whose date prefix matches the session", () => {
    expect(isOnSession(`${SESSION}T09:15:00`, SESSION)).toBe(true);
  });

  test("rejects a timestamp from another session", () => {
    expect(isOnSession(`${PREV_SESSION}T09:15:00`, SESSION)).toBe(false);
  });

  test("accepts everything when no session is pinned", () => {
    expect(isOnSession(`${PREV_SESSION}T09:15:00`, "")).toBe(true);
    expect(isOnSession("garbage", "")).toBe(true);
  });
});

describe("effectiveSessionDate", () => {
  const candle = (time: string) => ({
    time,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 0,
  });

  test("keeps the pinned session when it has rows", () => {
    expect(
      effectiveSessionDate({
        date: undefined,
        market: { session_date: "2026-11-19" },
        intraday: [],
        candles: [candle("2026-11-19T09:15:00+05:30")],
      } as unknown as NiftyReport),
    ).toBe("2026-11-19");
  });

  test("falls back to the data's newest session when the pinned one has none", () => {
    // Pre-market: the exchange gate says today, the cold fetch still holds
    // yesterday's bars. Pinning today filtered the whole series away and the
    // chart rendered two tape spots instead of a session.
    expect(
      effectiveSessionDate({
        date: undefined,
        market: { session_date: "2026-11-19" },
        intraday: [],
        candles: [
          candle("2026-11-18T09:15:00+05:30"),
          candle("2026-11-18T15:15:00+05:30"),
        ],
      } as unknown as NiftyReport),
    ).toBe("2026-11-18");
  });

  test("never mixes two sessions: a stale series keeps its own single date", () => {
    const candles = [
      candle("2026-11-17T15:15:00+05:30"),
      candle("2026-11-18T15:15:00+05:30"),
    ];
    const session = effectiveSessionDate({
      date: undefined,
      market: { session_date: "2026-11-19" },
      intraday: [],
      candles,
    } as unknown as NiftyReport);
    expect(session).toBe("2026-11-18");
    expect(
      selectBaseCandles({ intraday: [], candles }, [], session),
    ).toHaveLength(1);
  });

  test("an explicit report.date always wins over the newest data session", () => {
    // Replay / EOD / previous-day views pin `report.date` deliberately; a
    // fallback that "helpfully" jumped to the newest candles would silently
    // break the replay playhead and the two-day-chart guard.
    const report = {
      date: "2026-10-12",
      market: { session_date: "2026-10-12" },
      intraday: [],
      candles: [candle("2026-10-11T15:00:00+05:30")],
    } as unknown as NiftyReport;
    expect(effectiveSessionDate(report)).toBe("2026-10-12");
    // The previous-session rows are dropped, not adopted.
    expect(
      selectBaseCandles({ intraday: [], candles: report.candles }, [], "2026-10-12"),
    ).toHaveLength(0);
  });

  test("returns the pinned date untouched when there is no pinned session", () => {
    expect(
      effectiveSessionDate({
        date: undefined,
        market: {},
        intraday: [],
        candles: [candle("2026-11-18T09:15:00+05:30")],
      } as unknown as NiftyReport),
    ).toBe("");
  });

  test("matches sessionDateOf when there is no candle data at all", () => {
    const report = {
      date: undefined,
      market: { session_date: "2026-11-19" },
      intraday: [],
      candles: [],
    } as unknown as NiftyReport;
    expect(effectiveSessionDate(report)).toBe(sessionDateOf(report));
  });
});
