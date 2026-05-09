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
import { calculateTotals, runBacktest, fetchStrategies, fetchVariations, fetchCosts, fetchChartData, fetchProgress, fetchResults, fetchBacktestHistory, fetchBacktestDetails, deleteBacktest } from "./backtest";

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

describe("fetchStrategies", () => {
  it("fetches available strategies", async () => {
    const strategies = [{ id: "orb", name: "ORB", description: "", params: [] }];
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ strategies }),
    } as Response);

    const result = await fetchStrategies();
    expect(result).toEqual(strategies);
  });

  it("returns empty array when no strategies key", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const result = await fetchStrategies();
    expect(result).toEqual([]);
  });

  it("returns empty on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));
    const result = await fetchStrategies();
    expect(result).toEqual([]);
  });
});

describe("runBacktest", () => {
  it("sends correct POST body with state params", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
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
      ok: true,
      json: async () => ({ results: [] }),
    } as Response);

    await runBacktest();

    const body = JSON.parse((mockedFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.save_to_history).toBe(false);
  });

  it("returns null when response contains error", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
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

  it("returns null and calls setError on non-2xx response", async () => {
    const { setError } = await import("../state/backtest");
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ detail: "Upstox API credentials not configured" }),
    } as Response);

    const result = await runBacktest();

    expect(result).toBeNull();
    expect(setError).toHaveBeenCalledWith("Upstox API credentials not configured");
  });

  it("returns null with status message when error body has no detail", async () => {
    const { setError } = await import("../state/backtest");
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: "Internal server error" }),
    } as Response);

    const result = await runBacktest();

    expect(result).toBeNull();
    expect(setError).toHaveBeenCalledWith("Request failed (500)");
  });

  it("returns null with status message when json parse fails on error", async () => {
    const { setError } = await import("../state/backtest");
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    const result = await runBacktest();

    expect(result).toBeNull();
    expect(setError).toHaveBeenCalledWith("Request failed (502)");
  });

  it("returns data when response has no results", async () => {
    const data = { message: "queued" };
    mockedFetch.mockResolvedValue({
      ok: true,
      status: 200,
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

describe("runBacktest processes chart_data", () => {
  it("processes chart_data from response", async () => {
    const { setResults, setChartData } = await import("../state/backtest");
    const chartData = {
      TATASTEEL: { pivot_levels: [{ price: 100 }], trades: [] },
    };
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ trades: 10, wins: 5, gross_pnl: 1000, total_costs: 100 }],
        totals: { trades: 10, net_pnl: 900, win_rate: 50 },
        chart_data: chartData,
        candles: { TATASTEEL: [] },
      }),
    } as Response);

    await runBacktest();

    expect(setResults).toHaveBeenCalled();
    expect(setChartData).toHaveBeenCalledWith("TATASTEEL", chartData.TATASTEEL);
  });
});

describe("fetchChartData", () => {
  it("fetches chart for symbol with optional tf", async () => {
    const { setChartData, setChartLoading } = await import("../state/backtest");
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candles: [{ time: "09:15", open: 100 }],
        trades: [],
      }),
    } as Response);

    const result = await fetchChartData("TATASTEEL", 15);

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/backtest/chart/TATASTEEL?tf=15"),
    );
    expect(result).toBeTruthy();
    expect(setChartData).toHaveBeenCalledWith("TATASTEEL", expect.any(Object));
  });

  it("handles missing candles", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ error: "No data" }),
    } as Response);

    const result = await fetchChartData("TATASTEEL");

    expect(result).toBeNull();
  });

  it("returns null on fetch error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchChartData("TATASTEEL");

    expect(result).toBeNull();
  });
});

describe("fetchProgress", () => {
  it("fetches progress for long-running backtests", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ current: 5, total: 10, message: "Processing..." }),
    } as Response);

    const result = await fetchProgress();

    expect(result).toEqual({ current: 5, total: 10, message: "Processing..." });
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchProgress();

    expect(result).toBeNull();
  });
});

describe("fetchResults", () => {
  it("fetches cached results", async () => {
    const mockResults = { results: [{ trades: 10 }], totals: { net_pnl: 500 } };
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResults,
    } as Response);

    const result = await fetchResults();

    expect(result).toEqual(mockResults);
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchResults();

    expect(result).toBeNull();
  });
});

describe("fetchBacktestHistory", () => {
  it("fetches history list", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ history: [{ uuid: "abc", created_at: "2024-01-01" }] }),
    } as Response);

    const result = await fetchBacktestHistory();

    expect(result).toHaveLength(1);
    expect(result[0].uuid).toBe("abc");
  });

  it("returns empty array on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchBacktestHistory();

    expect(result).toEqual([]);
  });
});

describe("fetchBacktestDetails", () => {
  it("fetches single history item", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ uuid: "abc", results: [] }),
    } as Response);

    const result = await fetchBacktestDetails("abc");

    expect(result?.uuid).toBe("abc");
  });

  it("returns null on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const result = await fetchBacktestDetails("abc");

    expect(result).toBeNull();
  });
});

describe("deleteBacktest", () => {
  it("sends DELETE and returns success", async () => {
    mockedFetch.mockResolvedValue({ ok: true } as Response);

    const result = await deleteBacktest("abc");

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/backtest/history/abc"),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(result).toBe(true);
  });

  it("returns false on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await deleteBacktest("abc");

    expect(result).toBe(false);
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
