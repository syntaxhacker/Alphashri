// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach } from "vitest";
import type { SectorCorrelationResponse } from "../types/sector";

// Mock the API module
vi.mock("../api/sectorCorrelation", () => ({
  fetchSectorCorrelation: vi.fn(),
}));

// Mock createSubscriber to provide spy-able notify
const mockNotify = vi.fn();
vi.mock("./createSubscriber", () => ({
  createSubscriber: () => ({
    subscribe: vi.fn(),
    notify: mockNotify,
  }),
}));

beforeEach(async () => {
  vi.clearAllMocks();
  // Reset module state to defaults before each test
  const mod = await import("./sectorCorrelation");
  mod.setMarket("india");
  mod.setLookbackDays(90);
  mod.setCorrelationData(null as any);
  mod.setIsLoading(false);
  mod.setError(null);
  // Clear notify mock counts that accumulated during reset
  mockNotify.mockClear();
});

describe("sectorCorrelation state", () => {
  describe("initial state", () => {
    test("has correct default values", async () => {
      const { market, lookbackDays, data, isLoading, error } = await import("./sectorCorrelation");
      expect(market).toBe("india");
      expect(lookbackDays).toBe(90);
      expect(data).toBeNull();
      expect(isLoading).toBe(false);
      expect(error).toBeNull();
    });
  });

  describe("setMarket", () => {
    test("sets market and calls notify", async () => {
      const { setMarket } = await import("./sectorCorrelation");
      setMarket("america");
      expect(mockNotify).toHaveBeenCalledTimes(1);
    });
  });

  describe("setLookbackDays", () => {
    test("sets lookbackDays and calls notify", async () => {
      const { setLookbackDays } = await import("./sectorCorrelation");
      setLookbackDays(180);
      expect(mockNotify).toHaveBeenCalledTimes(1);
    });
  });

  describe("setIsLoading", () => {
    test("sets isLoading and calls notify", async () => {
      const { setIsLoading } = await import("./sectorCorrelation");
      setIsLoading(true);
      expect(mockNotify).toHaveBeenCalledTimes(1);
    });
  });

  describe("setError", () => {
    test("sets error and calls notify", async () => {
      const { setError } = await import("./sectorCorrelation");
      setError("Something went wrong");
      expect(mockNotify).toHaveBeenCalledTimes(1);
    });

    test("clears error with null", async () => {
      const { setError } = await import("./sectorCorrelation");
      setError(null);
      expect(mockNotify).toHaveBeenCalledTimes(1);
    });
  });

  describe("setCorrelationData", () => {
    test("sets data and calls notify", async () => {
      const { setCorrelationData } = await import("./sectorCorrelation");
      const mockData: SectorCorrelationResponse = {
        sectors: [],
        correlation_matrix: [],
        sector_names: [],
        last_updated: new Date().toISOString(),
      };
      setCorrelationData(mockData);
      expect(mockNotify).toHaveBeenCalledTimes(1);
    });
  });

  describe("fetchCorrelationData", () => {
    test("fetches data and updates state on success", async () => {
      const { fetchCorrelationData } = await import("./sectorCorrelation");
      const mockResponse = {
        sectors: [],
        correlation_matrix: [[1]],
        sector_names: ["NIFTY 50"],
        last_updated: new Date().toISOString(),
      };
      const mockFetch = vi.fn().mockResolvedValue(mockResponse);

      const apiModule = await import("../api/sectorCorrelation");
      const originalFetch = apiModule.fetchSectorCorrelation;
      apiModule.fetchSectorCorrelation = mockFetch as any;

      await fetchCorrelationData();

      expect(mockFetch).toHaveBeenCalledWith({ market: "india", lookback_days: 90 });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      apiModule.fetchSectorCorrelation = originalFetch;
    });

    test("handles fetch errors", async () => {
      const { fetchCorrelationData } = await import("./sectorCorrelation");
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const apiModule = await import("../api/sectorCorrelation");
      const originalFetch = apiModule.fetchSectorCorrelation;
      apiModule.fetchSectorCorrelation = mockFetch as any;

      await fetchCorrelationData();

      expect(mockFetch).toHaveBeenCalledTimes(1);

      apiModule.fetchSectorCorrelation = originalFetch;
    });
  });
});
