import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./config", () => ({
  API_ENDPOINTS: { CHART_PREVIEW: "http://localhost:8765/api/chart/preview" },
}));

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { fetchChartPreview, clearPreviewCache } from "./chartPreview";
import { makePreviewData, mockError, mockFetchError, mockFetchOk } from "./apiTestMocks";

const mockedFetch = vi.mocked(fetchWithAuth);

const mockData = makePreviewData();

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
    mockFetchOk(mockedFetch, mockData);

    await fetchChartPreview("   ");

    expect(mockedFetch).toHaveBeenCalled();
  });

  it("builds URL with symbol, tf, days, or_minutes params", async () => {
    mockFetchOk(mockedFetch, mockData);

    await fetchChartPreview("TATASTEEL", 15, 5, 30);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/TATASTEEL?");
    expect(calledUrl).toContain("tf=15");
    expect(calledUrl).toContain("days=5");
    expect(calledUrl).toContain("or_minutes=30");
  });

  it("uses default params when not specified", async () => {
    mockFetchOk(mockedFetch, mockData);

    await fetchChartPreview("INFY");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("tf=15");
    expect(calledUrl).toContain("days=1");
    expect(calledUrl).toContain("or_minutes=45");
  });

  it("returns data on successful fetch", async () => {
    mockFetchOk(mockedFetch, mockData);

    const result = await fetchChartPreview("TATASTEEL");

    expect(result).toEqual(mockData);
  });

  it("returns null when response is not ok", async () => {
    mockFetchError(mockedFetch, 500, {});

    const result = await fetchChartPreview("TATASTEEL");

    expect(result).toBeNull();
  });

  it("returns data with error field instead of null", async () => {
    mockFetchOk(mockedFetch, { ...mockData, error: "Symbol not found" });

    const result = await fetchChartPreview("BADSIGN");

    expect(result).toBeTruthy();
    expect(result?.error).toBe("Symbol not found");
  });

  it("returns null on network error", async () => {
    mockError(mockedFetch, "Network error");

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
    mockFetchOk(mockedFetch, mockData);

    const result1 = await fetchChartPreview("TATASTEEL");
    const result2 = await fetchChartPreview("TATASTEEL");

    expect(result1).toEqual(mockData);
    expect(result2).toEqual(mockData);
    expect(mockedFetch).toHaveBeenCalledOnce();
  });

  it("does not return stale cache after TTL expires", async () => {
    mockFetchOk(mockedFetch, mockData);

    await fetchChartPreview("TATASTEEL");

    vi.advanceTimersByTime(60_001);

    await fetchChartPreview("TATASTEEL");

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("returns fresh cache within TTL", async () => {
    mockFetchOk(mockedFetch, mockData);

    await fetchChartPreview("TATASTEEL");

    vi.advanceTimersByTime(30_000);

    await fetchChartPreview("TATASTEEL");

    expect(mockedFetch).toHaveBeenCalledOnce();
  });

  it("uses different cache keys for different symbols", async () => {
    mockFetchOk(mockedFetch, { ...mockData, symbol: "INFY" });

    await fetchChartPreview("TATASTEEL");
    await fetchChartPreview("INFY");

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("uses different cache keys for different timeframes", async () => {
    mockFetchOk(mockedFetch, mockData);

    await fetchChartPreview("TATASTEEL", 15);
    await fetchChartPreview("TATASTEEL", 30);

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("uses different cache keys for different days", async () => {
    mockFetchOk(mockedFetch, mockData);

    await fetchChartPreview("TATASTEEL", 15, 1);
    await fetchChartPreview("TATASTEEL", 15, 5);

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("does not cache null results", async () => {
    mockFetchError(mockedFetch, 500, {});

    await fetchChartPreview("BAD");

    mockFetchOk(mockedFetch, mockData);

    await fetchChartPreview("BAD");

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("does not cache results with error field", async () => {
    mockFetchOk(mockedFetch, { ...mockData, error: "err" });

    await fetchChartPreview("BAD");

    mockFetchOk(mockedFetch, mockData);

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
    mockFetchOk(mockedFetch, mockData);

    await fetchChartPreview("TATASTEEL");
    await fetchChartPreview("INFY");

    clearPreviewCache();

    await fetchChartPreview("TATASTEEL");
    await fetchChartPreview("INFY");

    expect(mockedFetch).toHaveBeenCalledTimes(4);
  });

  it("clears only entries for a specific symbol", async () => {
    mockFetchOk(mockedFetch, mockData);

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
