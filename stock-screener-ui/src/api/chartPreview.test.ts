import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./config", () => ({
  API_ENDPOINTS: { CHART_PREVIEW: "http://localhost:8765/api/chart/preview" },
}));

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { fetchChartPreview, clearPreviewCache } from "./chartPreview";
import type { ChartPreviewData } from "./chartPreview";

const mockedFetch = vi.mocked(fetchWithAuth);

const mockData: ChartPreviewData = {
  symbol: "TATASTEEL",
  candles: [
    {
      time: "2024-01-01T09:15",
      date: "2024-01-01",
      time_str: "09:15",
      open: 100,
      high: 105,
      low: 99,
      close: 103,
      volume: 1000,
    },
  ],
  orb_zones: [
    { date: "2024-01-01", date_raw: "2024-01-01", or_high: 105, or_low: 99, or_end_time: "09:45" },
  ],
  pivot_levels: [{ date: "2024-01-01", date_raw: "2024-01-01", pp: 102, r1: 106, s1: 98 }],
  timeframe: 15,
  total_candles: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  clearPreviewCache();
});

describe("fetchChartPreview", () => {
  it("returns null for empty symbol", async () => {
    const result = await fetchChartPreview("");

    expect(result).toBeNull();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("makes API call for whitespace-only symbol (not validated by fetchChartPreview)", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    await fetchChartPreview("   ");

    expect(mockedFetch).toHaveBeenCalled();
  });

  it("builds URL with symbol, tf, days, or_minutes params", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    await fetchChartPreview("TATASTEEL", 15, 5, 30);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/TATASTEEL?");
    expect(calledUrl).toContain("tf=15");
    expect(calledUrl).toContain("days=5");
    expect(calledUrl).toContain("or_minutes=30");
  });

  it("uses default params when not specified", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    await fetchChartPreview("INFY");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("tf=15");
    expect(calledUrl).toContain("days=1");
    expect(calledUrl).toContain("or_minutes=45");
  });

  it("returns data on successful fetch", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    const result = await fetchChartPreview("TATASTEEL");

    expect(result).toEqual(mockData);
  });

  it("returns null when response is not ok", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const result = await fetchChartPreview("TATASTEEL");

    expect(result).toBeNull();
  });

  it("returns data with error field instead of null", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...mockData, error: "Symbol not found" }),
    } as Response);

    const result = await fetchChartPreview("BADSIGN");

    expect(result).toBeTruthy();
    expect(result?.error).toBe("Symbol not found");
  });

  it("returns null on network error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchChartPreview("TATASTEEL");

    expect(result).toBeNull();
  });
});

describe("chartPreview cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches successful response and returns cached data on subsequent call", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    const result1 = await fetchChartPreview("TATASTEEL");
    const result2 = await fetchChartPreview("TATASTEEL");

    expect(result1).toEqual(mockData);
    expect(result2).toEqual(mockData);
    expect(mockedFetch).toHaveBeenCalledOnce();
  });

  it("does not return stale cache after TTL expires", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    await fetchChartPreview("TATASTEEL");

    vi.advanceTimersByTime(60_001);

    await fetchChartPreview("TATASTEEL");

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("returns fresh cache within TTL", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    await fetchChartPreview("TATASTEEL");

    vi.advanceTimersByTime(30_000);

    await fetchChartPreview("TATASTEEL");

    expect(mockedFetch).toHaveBeenCalledOnce();
  });

  it("uses different cache keys for different symbols", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...mockData, symbol: "INFY" }),
    } as Response);

    await fetchChartPreview("TATASTEEL");
    await fetchChartPreview("INFY");

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("uses different cache keys for different timeframes", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    await fetchChartPreview("TATASTEEL", 15);
    await fetchChartPreview("TATASTEEL", 30);

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("uses different cache keys for different days", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    await fetchChartPreview("TATASTEEL", 15, 1);
    await fetchChartPreview("TATASTEEL", 15, 5);

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("does not cache null results", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await fetchChartPreview("BAD");

    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    await fetchChartPreview("BAD");

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("does not cache results with error field", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...mockData, error: "err" }),
    } as Response);

    await fetchChartPreview("BAD");

    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    await fetchChartPreview("BAD");

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });
});

describe("clearPreviewCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears all cache entries when called without symbol", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    await fetchChartPreview("TATASTEEL");
    await fetchChartPreview("INFY");

    clearPreviewCache();

    await fetchChartPreview("TATASTEEL");
    await fetchChartPreview("INFY");

    expect(mockedFetch).toHaveBeenCalledTimes(4);
  });

  it("clears only entries for a specific symbol", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    await fetchChartPreview("TATASTEEL", 15);
    await fetchChartPreview("TATASTEEL", 30);
    await fetchChartPreview("INFY", 15);

    clearPreviewCache("TATASTEEL");

    await fetchChartPreview("TATASTEEL", 15);
    await fetchChartPreview("TATASTEEL", 30);
    await fetchChartPreview("INFY", 15);

    expect(mockedFetch).toHaveBeenCalledTimes(5);
  });
});
