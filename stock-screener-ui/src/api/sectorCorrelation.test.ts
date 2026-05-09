import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { fetchSectorCorrelation } from "./sectorCorrelation";

const mockedFetch = vi.mocked(fetchWithAuth);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchSectorCorrelation", () => {
  it("fetches with market and lookback_days", async () => {
    const mockData = {
      sectors: [
        { sector: "IT", correlation: 0.8 },
        { sector: "Banks", correlation: 0.6 },
      ],
    };
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    const result = await fetchSectorCorrelation({ market: "india", lookback_days: 30 });

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("market=india"),
    );
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("lookback_days=30"),
    );
    expect(result).toEqual(mockData);
  });

  it("throws on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: "API error" }),
    } as Response);

    await expect(
      fetchSectorCorrelation({ market: "india", lookback_days: 30 }),
    ).rejects.toThrow("API error");
  });

  it("throws with default message when no detail", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    await expect(
      fetchSectorCorrelation({ market: "america", lookback_days: 60 }),
    ).rejects.toThrow("Failed to fetch sector correlation data");
  });
});
