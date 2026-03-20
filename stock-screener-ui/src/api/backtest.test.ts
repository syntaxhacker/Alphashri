import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/backtest", () => ({
  setStrategies: vi.fn(),
  setStrategiesLoading: vi.fn(),
  setVariations: vi.fn(),
  setResults: vi.fn(),
  setRunning: vi.fn(),
  setProgress: vi.fn(),
  setError: vi.fn(),
  setChartData: vi.fn(),
  setChartLoading: vi.fn(),
  setCostBreakdown: vi.fn(),
  getBacktestState: vi.fn(() => ({
    selectedStrategy: "orb_breakout",
    selectedVariation: 1,
    selectedSymbols: ["TATASTEEL", "INFY"],
    params: { or_minutes: 45 },
    days: 30,
    includeCosts: true,
  })),
}));

vi.mock("./chartBuilder", () => ({
  buildChartData: vi.fn(() => ({
    candles: [],
    orb_zones: [],
    pivot_levels: [],
    trades: [],
  })),
}));

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { calculateTotals, runBacktest, fetchVariations, fetchCosts } from "./backtest";

const mockedFetch = vi.mocked(fetchWithAuth);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("calculateTotals", () => {
  it("computes totals from multiple results", () => {
    const results = [
      { trades: 10, wins: 6, gross_pnl: 5000, total_costs: 500 },
      { trades: 20, wins: 12, gross_pnl: 8000, total_costs: 800 },
    ] as any[];

    const totals = calculateTotals(results);

    expect(totals.trades).toBe(30);
    expect(totals.gross_pnl).toBe(13000);
    expect(totals.total_costs).toBe(1300);
    expect(totals.net_pnl).toBe(11700);
    expect(totals.win_rate).toBe(60);
  });

  it("handles empty results array", () => {
    const totals = calculateTotals([]);

    expect(totals.trades).toBe(0);
    expect(totals.gross_pnl).toBe(0);
    expect(totals.total_costs).toBe(0);
    expect(totals.net_pnl).toBe(0);
    expect(totals.win_rate).toBe(0);
  });

  it("handles results with zero trades", () => {
    const results = [{ trades: 0, wins: 0, gross_pnl: 0, total_costs: 0 }] as any[];

    const totals = calculateTotals(results);

    expect(totals.win_rate).toBe(0);
  });

  it("handles missing fields with defaults", () => {
    const results = [{}] as any[];

    const totals = calculateTotals(results);

    expect(totals.trades).toBe(0);
    expect(totals.gross_pnl).toBe(0);
    expect(totals.total_costs).toBe(0);
    expect(totals.net_pnl).toBe(0);
    expect(totals.win_rate).toBe(0);
  });

  it("calculates win rate correctly", () => {
    const results = [{ trades: 100, wins: 65, gross_pnl: 0, total_costs: 0 }] as any[];

    const totals = calculateTotals(results);

    expect(totals.win_rate).toBe(65);
  });
});

describe("runBacktest", () => {
  it("sends correct POST body with state params", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({ results: [{ trades: 10, wins: 5, gross_pnl: 1000, total_costs: 100 }] }),
    } as Response);

    await runBacktest(true);

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/backtest/run?include_chart_data=true"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"strategy":"orb_breakout"'),
      }),
    );

    const body = JSON.parse((mockedFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.symbols).toEqual(["TATASTEEL", "INFY"]);
    expect(body.params).toEqual({ or_minutes: 45 });
    expect(body.days).toBe(30);
    expect(body.include_costs).toBe(true);
    expect(body.save_to_history).toBe(true);
  });

  it("defaults saveToHistory to false", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({ results: [] }),
    } as Response);

    await runBacktest();

    const body = JSON.parse((mockedFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.save_to_history).toBe(false);
  });

  it("returns null when response contains error", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({ error: "Invalid strategy" }),
    } as Response);

    const result = await runBacktest();

    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await runBacktest();

    expect(result).toBeNull();
  });

  it("returns data when response has no results", async () => {
    const data = { message: "queued" };
    mockedFetch.mockResolvedValue({
      json: async () => data,
    } as Response);

    const result = await runBacktest();

    expect(result).toEqual(data);
  });
});

describe("fetchVariations", () => {
  it("returns array when response is array", async () => {
    const variations = [{ id: 1, name: "Default" }];
    mockedFetch.mockResolvedValue({
      json: async () => variations,
    } as Response);

    const result = await fetchVariations();

    expect(result).toEqual(variations);
  });

  it("returns empty array for non-array response", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({ error: "Not found" }),
    } as Response);

    const result = await fetchVariations();

    expect(result).toEqual([]);
  });

  it("returns empty array on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchVariations();

    expect(result).toEqual([]);
  });
});

describe("fetchCosts", () => {
  it("returns costs when present", async () => {
    const costs = { brokerage: 100, stt: 50 };
    mockedFetch.mockResolvedValue({
      json: async () => ({ costs }),
    } as Response);

    const result = await fetchCosts();

    expect(result).toEqual(costs);
  });

  it("returns null when costs not present", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({}),
    } as Response);

    const result = await fetchCosts();

    expect(result).toBeNull();
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchCosts();

    expect(result).toBeNull();
  });
});
