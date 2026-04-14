import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { fetchHolidays, fetchHolidayCheck, fetchTradingDates } from "./holidays_api";

const mockedFetch = vi.mocked(fetchWithAuth);

function getCalledUrl() {
  return mockedFetch.mock.calls[0][0] as string;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchHolidays", () => {
  it("fetches all holidays without params", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        holidays: [{ date: "2026-01-26", description: "Republic Day", type: "trading" }],
      }),
    } as Response);

    const result = await fetchHolidays();

    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-01-26");
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const calledUrl = getCalledUrl();
    expect(calledUrl).toContain("/api/holidays");
    expect(calledUrl).not.toContain("year=");
    expect(calledUrl).not.toContain("type=");
  });

  it("fetches holidays filtered by year", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ holidays: [] }),
    } as Response);

    await fetchHolidays(2026);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(getCalledUrl()).toContain("/api/holidays?year=2026");
  });

  it("fetches holidays filtered by type", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ holidays: [] }),
    } as Response);

    await fetchHolidays(undefined, "trading");

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(getCalledUrl()).toContain("/api/holidays?type=trading");
  });

  it("fetches holidays filtered by date range", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ holidays: [] }),
    } as Response);

    await fetchHolidays(undefined, undefined, "2026-01-01", "2026-03-31");

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const calledUrl = getCalledUrl();
    expect(calledUrl).toContain("/api/holidays?from_date=2026-01-01");
    expect(calledUrl).toContain("to_date=2026-03-31");
  });
});

describe("fetchHolidayCheck", () => {
  it("returns holiday info for trading holiday", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        date: "2026-01-26",
        is_holiday: true,
        type: "trading",
        description: "Republic Day",
      }),
    } as Response);

    const result = await fetchHolidayCheck("2026-01-26");

    expect(result.is_holiday).toBe(true);
    expect(result.type).toBe("trading");
    expect(getCalledUrl()).toContain("/api/holidays/check?date=2026-01-26");
  });

  it("returns non-holiday for normal day", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ date: "2026-01-20", is_holiday: false, type: null, description: null }),
    } as Response);

    const result = await fetchHolidayCheck("2026-01-20");

    expect(result.is_holiday).toBe(false);
    expect(result.type).toBeNull();
  });
});

describe("fetchTradingDates", () => {
  it("returns list of trading dates", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ trading_dates: ["2026-01-20", "2026-01-21", "2026-01-22"], total: 3 }),
    } as Response);

    const result = await fetchTradingDates("2026-01-19", "2026-01-25");

    expect(result).toHaveLength(3);
    expect(result).toContain("2026-01-20");
    expect(getCalledUrl()).toContain("/api/holidays/trading-dates");
  });
});
