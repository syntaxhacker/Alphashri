import { describe, it, expect, vi, beforeEach } from "vitest";

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
  checkDate,
  resetHolidays,
} from "./holidays";

const mockedFetchHolidays = vi.mocked(fetchHolidays);
const mockedFetchHolidayCheck = vi.mocked(fetchHolidayCheck);

beforeEach(() => {
  vi.clearAllMocks();
  resetHolidays();
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
