import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api/holidays_api", () => ({
  fetchHolidays: vi.fn(),
  fetchHolidayCheck: vi.fn(),
}));

import { fetchHolidays, fetchHolidayCheck } from "../api/holidays_api";
import {
  getHolidayState,
  loadHolidays,
  isTradingHoliday,
  isClearingHoliday,
  isMarketOpenNow,
  calendarWeekday,
  checkDate,
  resetHolidays,
} from "./holidays";

const mockedFetchHolidays = vi.mocked(fetchHolidays);
const mockedFetchHolidayCheck = vi.mocked(fetchHolidayCheck);

beforeEach(() => {
  vi.clearAllMocks();
  resetHolidays();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadHolidays", () => {
  it("loads holidays and indexes them", async () => {
    mockedFetchHolidays.mockResolvedValue([
      { date: "2026-01-26", description: "Republic Day", type: "trading" },
      { date: "2026-02-19", description: "CSMJ", type: "clearing" },
    ]);

    await loadHolidays(2026);

    expect(mockedFetchHolidays).toHaveBeenCalledWith(2026);
    const state = getHolidayState();
    expect(state.loaded).toBe(true);
    expect(state.holidays).toHaveLength(2);
    expect(state.tradingDates.has("2026-01-26")).toBe(true);
    expect(state.clearingDates.has("2026-02-19")).toBe(true);
  });

  it("does not reload if already loading", async () => {
    mockedFetchHolidays.mockImplementation(() => new Promise((r) => setTimeout(r, 1000)));

    const p1 = loadHolidays();
    const p2 = loadHolidays();
    await Promise.all([p1, p2]);

    expect(mockedFetchHolidays).toHaveBeenCalledTimes(1);
  });

  it("handles fetch error gracefully", async () => {
    mockedFetchHolidays.mockRejectedValue(new Error("Network error"));

    await loadHolidays();

    const state = getHolidayState();
    expect(state.loaded).toBe(false);
    expect(state.loading).toBe(false);
  });
});

describe("isTradingHoliday", () => {
  it("returns true for trading holiday", async () => {
    mockedFetchHolidays.mockResolvedValue([
      { date: "2026-01-26", description: "Republic Day", type: "trading" },
    ]);

    await loadHolidays();

    expect(isTradingHoliday("2026-01-26")).toBe(true);
    expect(isTradingHoliday("2026-01-20")).toBe(false);
  });
});

describe("calendarWeekday — timezone independence", () => {
  // 2026-11-16 is a Monday, 2026-11-21 a Saturday, 2026-11-22 a Sunday.
  const cases: [string, number, string][] = [
    ["2026-11-16", 1, "Monday"],
    ["2026-11-20", 5, "Friday"],
    ["2026-11-21", 6, "Saturday"],
    ["2026-11-22", 0, "Sunday"],
  ];

  for (const tz of ["America/New_York", "Asia/Kolkata"]) {
    for (const [dateStr, weekday, label] of cases) {
      it(`reads ${dateStr} as ${label} in ${tz}`, () => {
        vi.stubEnv("TZ", tz);
        expect(calendarWeekday(dateStr)).toBe(weekday);
      });
    }
  }

  it("rejects a malformed date instead of guessing", () => {
    expect(Number.isNaN(calendarWeekday("not-a-date"))).toBe(true);
  });
});

describe("isTradingHoliday — weekend gate is the calendar day, not UTC", () => {
  // Regression: `new Date("2026-11-16").getDay()` is 0 (Sunday) in New York
  // because a bare YYYY-MM-DD parses as UTC midnight, so every Monday there
  // was reported as a holiday and every Saturday as a trading day.
  for (const tz of ["America/New_York", "Asia/Kolkata"]) {
    describe(tz, () => {
      beforeEach(() => vi.stubEnv("TZ", tz));

      it("treats Monday as a trading day", () => {
        expect(isTradingHoliday("2026-11-16")).toBe(false);
      });

      it("treats Friday as a trading day", () => {
        expect(isTradingHoliday("2026-11-20")).toBe(false);
      });

      it("treats Saturday and Sunday as non-trading days", () => {
        expect(isTradingHoliday("2026-11-21")).toBe(true);
        expect(isTradingHoliday("2026-11-22")).toBe(true);
      });
    });
  }

  it("still reports a listed Monday exchange holiday as a holiday", async () => {
    vi.stubEnv("TZ", "America/New_York");
    mockedFetchHolidays.mockResolvedValue([
      { date: "2026-01-26", description: "Republic Day", type: "trading" },
    ]);

    await loadHolidays();

    expect(calendarWeekday("2026-01-26")).toBe(1);
    expect(isTradingHoliday("2026-01-26")).toBe(true);
  });

  it("keeps the IST cash session open on a Monday for a US-timezone client", () => {
    vi.stubEnv("TZ", "America/New_York");
    // 04:15Z == 09:45 IST on Monday 2026-11-16, but still Sunday 23:15 in New York.
    expect(isMarketOpenNow(new Date("2026-11-16T04:15:00Z"))).toBe(true);
  });
});

describe("isMarketOpenNow", () => {
  it("is open only inside the IST cash session on weekdays", () => {
    expect(isMarketOpenNow(new Date("2026-10-21T03:44:00Z"))).toBe(false);
    expect(isMarketOpenNow(new Date("2026-10-21T03:45:00Z"))).toBe(true);
    expect(isMarketOpenNow(new Date("2026-10-21T09:59:00Z"))).toBe(true);
    expect(isMarketOpenNow(new Date("2026-10-21T10:00:00Z"))).toBe(false);
    expect(isMarketOpenNow(new Date("2026-10-24T06:00:00Z"))).toBe(false);
    expect(isMarketOpenNow(new Date("2026-10-25T06:00:00Z"))).toBe(false);
  });
});

describe("isClearingHoliday", () => {
  it("returns true for clearing holiday", async () => {
    mockedFetchHolidays.mockResolvedValue([
      { date: "2026-02-19", description: "CSMJ", type: "clearing" },
    ]);

    await loadHolidays();

    expect(isClearingHoliday("2026-02-19")).toBe(true);
    expect(isClearingHoliday("2026-01-26")).toBe(false);
  });
});

describe("checkDate", () => {
  it("returns from cache for known trading holiday", async () => {
    mockedFetchHolidays.mockResolvedValue([
      { date: "2026-01-26", description: "Republic Day", type: "trading" },
    ]);

    await loadHolidays();

    const result = await checkDate("2026-01-26");

    expect(result.is_holiday).toBe(true);
    expect(result.type).toBe("trading");
    expect(result.description).toBe("Republic Day");
    expect(mockedFetchHolidayCheck).not.toHaveBeenCalled();
  });

  it("returns from cache for known clearing holiday", async () => {
    mockedFetchHolidays.mockResolvedValue([
      { date: "2026-02-19", description: "CSMJ", type: "clearing" },
    ]);

    await loadHolidays();

    const result = await checkDate("2026-02-19");

    expect(result.is_holiday).toBe(true);
    expect(result.type).toBe("clearing");
    expect(mockedFetchHolidayCheck).not.toHaveBeenCalled();
  });

  it("falls back to API for unknown date", async () => {
    mockedFetchHolidays.mockResolvedValue([]);
    mockedFetchHolidayCheck.mockResolvedValue({
      date: "2026-01-20",
      is_holiday: false,
      type: null,
      description: null,
    });

    await loadHolidays();

    const result = await checkDate("2026-01-20");

    expect(result.is_holiday).toBe(false);
    expect(mockedFetchHolidayCheck).toHaveBeenCalledWith("2026-01-20");
  });

  it("handles API error for unknown date", async () => {
    mockedFetchHolidays.mockResolvedValue([]);
    mockedFetchHolidayCheck.mockRejectedValue(new Error("fail"));

    await loadHolidays();

    const result = await checkDate("2026-01-20");

    expect(result.is_holiday).toBe(false);
  });
});
