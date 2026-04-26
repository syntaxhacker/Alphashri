import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

vi.mock("./config", () => ({
  API_BASE: "http://localhost:8765",
}));

import { fetchWithAuth } from "../state/auth";
import { fetchSectorPerformance } from "./sector";
import type { SectorResponse } from "../types/sector";

const mockedFetch = vi.mocked(fetchWithAuth);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchSectorPerformance", () => {
  it("fetches sector data for default market (india)", async () => {
    const mockData: SectorResponse = {
      sectors: [
        { name: "IT", change: 2.5, advance: 20, decline: 10 },
        { name: "Banking", change: -1.2, advance: 15, decline: 25 },
      ],
      updated_at: "2024-01-01T10:00:00Z",
    };

    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    const result = await fetchSectorPerformance();

    expect(result).toEqual(mockData);
    expect(mockedFetch).toHaveBeenCalledWith(
      "http://localhost:8765/api/sector?market=india",
      expect.any(Object),
    );
  });

  it("fetches sector data for specific market", async () => {
    const mockData: SectorResponse = {
      sectors: [],
      updated_at: "2024-01-01T10:00:00Z",
    };

    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    await fetchSectorPerformance("us");

    expect(mockedFetch).toHaveBeenCalledWith(
      "http://localhost:8765/api/sector?market=us",
      expect.any(Object),
    );
  });

  it("passes AbortSignal when provided", async () => {
    const mockSignal = new AbortController().signal;
    const mockData: SectorResponse = {
      sectors: [],
      updated_at: "2024-01-01T10:00:00Z",
    };

    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    await fetchSectorPerformance("india", mockSignal);

    const callArgs = mockedFetch.mock.calls[0];
    expect(callArgs[1]).toHaveProperty("signal", mockSignal);
  });

  it("throws with error detail on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Market not supported" }),
    } as Response);

    await expect(fetchSectorPerformance()).rejects.toThrow("Market not supported");
  });

  it("throws generic error when no detail in response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as Response);

    await expect(fetchSectorPerformance()).rejects.toThrow("Failed to fetch sector performance");
  });

  it("throws on network error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    await expect(fetchSectorPerformance()).rejects.toThrow("Network error");
  });

  it("handles empty sectors array", async () => {
    const mockData: SectorResponse = {
      sectors: [],
      updated_at: "2024-01-01T10:00:00Z",
    };

    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    const result = await fetchSectorPerformance();

    expect(result.sectors).toEqual([]);
  });
});
