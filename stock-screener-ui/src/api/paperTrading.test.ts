import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/paperTrading", () => ({
  setPositions: vi.fn(),
  setPortfolio: vi.fn(),
  setTrades: vi.fn(),
  setDailySummary: vi.fn(),
  setSymbolPerformance: vi.fn(),
  setChartData: vi.fn(),
  setChartLoading: vi.fn(),
  setChartFromDate: vi.fn(),
  setError: vi.fn(),
  setLoading: vi.fn(),
  setBotStatus: vi.fn(),
  setBotSnapshot: vi.fn(),
  setupAutoRefresh: vi.fn(),
  stopAutoRefresh: vi.fn(),
  setStrategyConfig: vi.fn(),
  setConfigLoading: vi.fn(),
  setConfigError: vi.fn(),
  setAnalyticsLoading: vi.fn(),
  setAnalyticsData: vi.fn(),
  setActivityLoading: vi.fn(),
  setActivityEvents: vi.fn(),
  setAggregatedLoading: vi.fn(),
  setAggregatedData: vi.fn(),
}));

vi.mock("../state/auth", () => ({
  apiFetch: vi.fn(),
}));

vi.mock("../state/holidays", () => ({
  isMarketClosedToday: vi.fn().mockReturnValue(false),
}));

import { apiFetch } from "../state/auth";
import { describeNormalizeBotPortfolio, mockError } from "./apiTestMocks";
import {
  normalizeBotPortfolio,
  fetchPositions,
  fetchTrades,
  fetchSymbolPerformance,
  fetchDailyReport,
  healthCheck,
  closePaperPosition,
  deleteTrade,
  closeAllPositions,
  updateTradeNotes,
  fetchPaperChart,

  fetchPortfolio,
  refreshLiveData,
  refreshHistoryData,
  fetchStrategyConfig,
  updateStrategyConfig,
  resetStrategyConfig,
  fetchAnalytics,
  fetchActivityFeed,
  fetchAggregatedDashboard,
} from "./paperTrading";

const mockedFetch = vi.mocked(apiFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describeNormalizeBotPortfolio(normalizeBotPortfolio);

describe("fetchPositions", () => {
  it("extracts positions array from response", async () => {
    mockedFetch.mockResolvedValue(({ positions: [{ symbol: "TATASTEEL" }] }));

    const result = await fetchPositions();

    expect(result).toEqual([{ symbol: "TATASTEEL" }]);
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining("/api/paper/positions"));
  });

  it("returns empty array when response has no positions key", async () => {
    mockedFetch.mockResolvedValue(({}));

    const result = await fetchPositions();

    expect(result).toEqual([]);
  });

  it("returns empty array on error", async () => {
    mockError(mockedFetch);

    const result = await fetchPositions();

    expect(result).toEqual([]);
  });
});

describe("fetchTrades", () => {
  it("builds URL with all params", async () => {
    mockedFetch.mockResolvedValue(({ trades: [], total_trades: 0 }));

    await fetchTrades(50, "bot-1", "2024-01-01", "2024-01-31", 60);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("limit=50");
    expect(calledUrl).toContain("bot_id=bot-1");
    expect(calledUrl).toContain("from_date=2024-01-01");
    expect(calledUrl).toContain("to_date=2024-01-31");
    expect(calledUrl).toContain("days_back=60");
  });

  it("omits optional params when not provided", async () => {
    mockedFetch.mockResolvedValue(({ trades: [], total_trades: 0 }));

    await fetchTrades();

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("limit=100");
    expect(calledUrl).toContain("days_back=30");
    expect(calledUrl).not.toContain("bot_id");
    expect(calledUrl).not.toContain("from_date");
    expect(calledUrl).not.toContain("to_date");
  });

  it("returns trades array from response", async () => {
    const trades = [
      { id: 1, pnl: 500 },
      { id: 2, pnl: -200 },
    ];
    mockedFetch.mockResolvedValue(({ trades, total_trades: 2 }));

    const result = await fetchTrades();

    expect(result).toEqual(trades);
  });

  it("returns empty array when response has no trades key", async () => {
    mockedFetch.mockResolvedValue(({ total_trades: 0 }));

    const result = await fetchTrades();

    expect(result).toEqual([]);
  });

  it("returns empty array on error", async () => {
    mockError(mockedFetch);

    const result = await fetchTrades();

    expect(result).toEqual([]);
  });
});

describe("fetchSymbolPerformance", () => {
  it("converts object values to array", async () => {
    const data = {
      TATASTEEL: { symbol: "TATASTEEL", pnl: 1000 },
      INFY: { symbol: "INFY", pnl: -500 },
    };
    mockedFetch.mockResolvedValue(data);

    const result = await fetchSymbolPerformance();

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        { symbol: "TATASTEEL", pnl: 1000 },
        { symbol: "INFY", pnl: -500 },
      ]),
    );
  });

  it("returns empty array for empty response object", async () => {
    mockedFetch.mockResolvedValue(({}));

    const result = await fetchSymbolPerformance();

    expect(result).toEqual([]);
  });

  it("returns empty array on error", async () => {
    mockError(mockedFetch);

    const result = await fetchSymbolPerformance();

    expect(result).toEqual([]);
  });
});

describe("fetchDailyReport", () => {
  it("includes date param when provided", async () => {
    mockedFetch.mockResolvedValue(({ date: "2024-01-01", pnl: 500 }));

    await fetchDailyReport("2024-01-01");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("date=2024-01-01");
  });

  it("omits date param when not provided", async () => {
    mockedFetch.mockResolvedValue(({ date: "2024-01-01", pnl: 500 }));

    await fetchDailyReport();

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("date=");
  });

  it("returns null on error", async () => {
    mockError(mockedFetch);

    const result = await fetchDailyReport();

    expect(result).toBeNull();
  });
});

describe("closeAllPositions", () => {
  it("sends POST to close-all with prices body", async () => {
    mockedFetch.mockResolvedValue(({ message: "All positions closed" }));

    const prices = { TATASTEEL: 150, INFY: 1800 };
    const result = await closeAllPositions("bot-1", prices);

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/bots/bot-1/close-all"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ prices }),
      }),
    );
    expect(result.success).toBe(true);
    expect(result.message).toBe("All positions closed");
  });

  it("throws on non-ok response", async () => {
    mockedFetch.mockRejectedValue(new Error("API 400: " + JSON.stringify({ detail: "Bot not found" })));

    await expect(closeAllPositions("bad-bot", {})).rejects.toThrow("Bot not found");
  });
});

describe("updateTradeNotes", () => {
  it("sends PATCH with notes and reason", async () => {
    const tradeData = { id: "trade-1", notes: "Updated notes", reason: "SL hit" };
    mockedFetch.mockResolvedValue(tradeData);

    const result = await updateTradeNotes("trade-1", "Updated notes", "SL hit");

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/paper/trades/trade-1"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ notes: "Updated notes", reason: "SL hit" }),
      }),
    );
    expect(result).toEqual(tradeData);
  });

  it("throws on non-ok response", async () => {
    mockedFetch.mockRejectedValue(new Error("API 400: " + JSON.stringify({ detail: "Trade not found" })));

    await expect(updateTradeNotes("bad-id", "notes", "reason")).rejects.toThrow("Trade not found");
  });
});

describe("fetchPaperChart", () => {
  it("builds URL with symbol with no optional params", async () => {
    const chartData = { candles: [] };
    mockedFetch.mockResolvedValue(chartData);

    const result = await fetchPaperChart("TATASTEEL");

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/paper/chart/TATASTEEL"),
    );
    expect(result).toEqual(chartData);
  });

  it("includes date, timeframe, and strategyId params", async () => {
    mockedFetch.mockResolvedValue(({ candles: [] }));

    await fetchPaperChart("TATASTEEL", "2024-01-15", "1h", 2);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("date=2024-01-15");
    expect(calledUrl).toContain("timeframe=1h");
    expect(calledUrl).toContain("strategy_id=2");
  });

  it("includes from_date when provided", async () => {
    mockedFetch.mockResolvedValue(({ candles: [] }));

    await fetchPaperChart("TATASTEEL", undefined, undefined, null, "2024-01-01");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("from_date=2024-01-01");
  });

  it("returns null when data has error field", async () => {
    mockedFetch.mockResolvedValue(({ error: "No data" }));

    const result = await fetchPaperChart("BAD");

    expect(result).toBeNull();
  });

  it("returns null on fetch error", async () => {
    mockError(mockedFetch);

    const result = await fetchPaperChart("TATASTEEL");

    expect(result).toBeNull();
  });
});

describe("fetchPortfolio", () => {
  it("fetches and returns portfolio data", async () => {
    const portfolio = { total_value: 100000, cash: 50000 };
    mockedFetch.mockResolvedValue(portfolio);

    const result = await fetchPortfolio();

    expect(result).toEqual(portfolio);
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/paper/portfolio"),
    );
  });

  it("returns null on error", async () => {
    mockError(mockedFetch);

    const result = await fetchPortfolio();

    expect(result).toBeNull();
  });
});

describe("healthCheck", () => {
  it("returns true when status is healthy", async () => {
    mockedFetch.mockResolvedValue(({ status: "healthy" }));

    const result = await healthCheck();

    expect(result).toBe(true);
  });

  it("returns false when status is not healthy", async () => {
    mockedFetch.mockResolvedValue(({ status: "unhealthy" }));

    const result = await healthCheck();

    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    mockError(mockedFetch);

    const result = await healthCheck();

    expect(result).toBe(false);
  });
});

describe("closePaperPosition", () => {
  it("sends correct POST body with uppercased symbol", async () => {
    mockedFetch.mockResolvedValue(({ pnl: 500 }));

    const result = await closePaperPosition("tatamotors", 1500, "MANUAL");

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/paper/close"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"symbol":"TATAMOTORS"'),
      }),
    );
    expect(result.success).toBe(true);
    expect(result.pnl).toBe(500);
  });

  it("uses default reason when not provided", async () => {
    mockedFetch.mockResolvedValue(({ pnl: 0 }));

    await closePaperPosition("TATASTEEL", 100);

    const body = JSON.parse((mockedFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.reason).toBe("MANUAL");
  });

  it("throws on non-ok response", async () => {
    mockedFetch.mockRejectedValue(new Error("API 400: " + JSON.stringify({ detail: "Position not found" })));

    await expect(closePaperPosition("BAD", 0)).rejects.toThrow("Position not found");
  });
});

describe("deleteTrade", () => {
  it("includes tradeId in URL", async () => {
    mockedFetch.mockResolvedValue(({ message: "Trade deleted" }));

    await deleteTrade("trade-123");

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/paper/trades/trade-123"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("throws on non-ok response with detail", async () => {
    mockedFetch.mockRejectedValue(new Error("API 400: " + JSON.stringify({ detail: "Trade not found" })));

    await expect(deleteTrade("bad-id")).rejects.toThrow("Trade not found");
  });

  it("throws generic error when no detail provided", async () => {
    mockedFetch.mockRejectedValue(new Error("API 400: " + JSON.stringify({})));

    await expect(deleteTrade("bad-id")).rejects.toThrow("API 400");
  });
});

describe("refreshLiveData", () => {
  it("fetches portfolio, positions, and bot status in parallel", async () => {
    mockedFetch
      .mockResolvedValueOnce({ total_value: 100000 })
      .mockResolvedValueOnce({ positions: [{ symbol: "TATASTEEL" }] })
      .mockResolvedValueOnce({ running: true, pid: 12345 });

    const { setPortfolio, setPositions, setBotStatus, setBotSnapshot, setLoading, setError } =
      await import("../state/paperTrading");

    await refreshLiveData();

    expect(setLoading).toHaveBeenCalledWith(true);
    expect(setPortfolio).toHaveBeenCalled();
    expect(setPositions).toHaveBeenCalled();
    expect(setBotStatus).toHaveBeenCalled();
    expect(setBotSnapshot).not.toHaveBeenCalled();
    expect(setLoading).toHaveBeenCalledWith(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it("handles API errors gracefully (each sub-function catches its own error)", async () => {
    mockError(mockedFetch, "API failed");

    const { setError, setLoading } = await import("../state/paperTrading");

    await refreshLiveData();

    // Each sub-function (fetchPortfolio, fetchPositions, etc.) catches its own error
    // so Promise.all resolves without throwing, and setError is not called
    expect(setError).not.toHaveBeenCalled();
    expect(setLoading).toHaveBeenCalledWith(false);
  });
});

describe("refreshHistoryData", () => {
  it("fetches trades and updates loading state", async () => {
    mockedFetch
      .mockResolvedValueOnce({ trades: [], total_trades: 0 });

    const { setLoading, setError } = await import("../state/paperTrading");

    await refreshHistoryData();

    expect(setLoading).toHaveBeenCalledWith(true);
    expect(setLoading).toHaveBeenCalledWith(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it("passes botId, fromDate, toDate to fetchTrades", async () => {
    mockedFetch
      .mockResolvedValueOnce({ trades: [], total_trades: 0 });

    await refreshHistoryData("bot-1", "2024-01-01", "2024-01-31");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("bot_id=bot-1");
    expect(calledUrl).toContain("from_date=2024-01-01");
    expect(calledUrl).toContain("to_date=2024-01-31");
  });

  it("handles API errors gracefully", async () => {
    mockError(mockedFetch, "History error");

    const { setError } = await import("../state/paperTrading");

    await refreshHistoryData();

    // Each sub-function catches its own error, so setError is not called
    expect(setError).not.toHaveBeenCalled();
  });
});

describe("fetchStrategyConfig", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedFetch.mockResolvedValue(({ config: { sl_pct: 1.0, tp_pct: 1.5 } }));
  });

  it("fetches config without strategy_id", async () => {
    mockedFetch.mockResolvedValue(({ config: { sl_pct: 1.0, tp_pct: 1.5 } }));

    const result = await fetchStrategyConfig();

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/paper/config"),
    );
    expect(result).toEqual({ sl_pct: 1.0, tp_pct: 1.5 });
  });

  it("includes strategy_id when provided", async () => {
    mockedFetch.mockResolvedValue(({ config: { sl_pct: 2.0 } }));

    await fetchStrategyConfig(5);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("strategy_id=5");
  });

  it("returns null on error", async () => {
    mockError(mockedFetch);

    const result = await fetchStrategyConfig();

    expect(result).toBeNull();
  });

  it("returns null when response has no config key", async () => {
    mockedFetch.mockResolvedValue(({}));

    const result = await fetchStrategyConfig();

    expect(result).toBeNull();
  });
});

describe("updateStrategyConfig", () => {
  it("sends PUT with config body", async () => {
    mockedFetch.mockResolvedValue(({ config: { sl_pct: 2.0 } }));

    const result = await updateStrategyConfig({ sl_pct: 2.0 });

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/paper/config"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ sl_pct: 2.0 }),
      }),
    );
    expect(result).toBe(true);
  });

  it("returns false on error", async () => {
    mockError(mockedFetch, "Update failed");

    const result = await updateStrategyConfig({ sl_pct: 2.0 });

    expect(result).toBe(false);
  });
});

describe("resetStrategyConfig", () => {
  it("sends POST to reset endpoint", async () => {
    mockedFetch.mockResolvedValue(({ config: { sl_pct: 1.0 } }));

    const result = await resetStrategyConfig();

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/paper/config/reset"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toBe(true);
  });

  it("returns false on error", async () => {
    mockError(mockedFetch, "Reset failed");

    const result = await resetStrategyConfig();

    expect(result).toBe(false);
  });
});

describe("fetchAnalytics", () => {
  it("calls apiFetch with correct URL and days_back param", async () => {
    mockedFetch.mockResolvedValue(({ total_pnl: 5000 }));

    await fetchAnalytics(30);

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/paper/analytics?days_back=30"),
    );
  });

  it("calls setAnalyticsLoading(true) before fetch", async () => {
    mockedFetch.mockResolvedValue(({ total_pnl: 5000 }));

    const { setAnalyticsLoading } = await import("../state/paperTrading");

    await fetchAnalytics();

    expect(setAnalyticsLoading).toHaveBeenCalledWith(true);
  });

  it("calls setAnalyticsData on success", async () => {
    const data = { total_pnl: 5000, win_rate: 0.6 };
    mockedFetch.mockResolvedValue(data);

    const { setAnalyticsData } = await import("../state/paperTrading");

    await fetchAnalytics();

    expect(setAnalyticsData).toHaveBeenCalledWith(data);
  });

  it("returns data on success", async () => {
    const data = { total_pnl: 5000, win_rate: 0.6 };
    mockedFetch.mockResolvedValue(data);

    const result = await fetchAnalytics();

    expect(result).toEqual(data);
  });

  it("returns null and clears loading on error", async () => {
    mockError(mockedFetch);

    const { setAnalyticsLoading } = await import("../state/paperTrading");

    const result = await fetchAnalytics();

    expect(result).toBeNull();
    expect(setAnalyticsLoading).toHaveBeenCalledWith(false);
  });
});

describe("fetchActivityFeed", () => {
  it("calls apiFetch without since param", async () => {
    mockedFetch.mockResolvedValue(({ events: [] }));

    await fetchActivityFeed();

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/paper/activity/feed"),
    );
    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("since=");
  });

  it("calls apiFetch with since param", async () => {
    mockedFetch.mockResolvedValue(({ events: [] }));

    await fetchActivityFeed("2024-01-01T00:00:00Z");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(decodeURIComponent(calledUrl)).toContain("since=2024-01-01T00:00:00Z");
  });

  it("calls setActivityEvents with events array", async () => {
    const events = [{ type: "trade" as const, symbol: "TATASTEEL", pnl: 500, quantity: 10, price: 100 }];
    mockedFetch.mockResolvedValue(({ events }));

    const { setActivityEvents } = await import("../state/paperTrading");

    await fetchActivityFeed();

    expect(setActivityEvents).toHaveBeenCalledWith(events);
  });

  it("returns events array on success", async () => {
    const events = [{ type: "trade" as const, symbol: "TATASTEEL", pnl: 500, quantity: 10, price: 100 }];
    mockedFetch.mockResolvedValue(({ events }));

    const result = await fetchActivityFeed();

    expect(result).toEqual(events);
  });

  it("returns empty array on error", async () => {
    mockError(mockedFetch);

    const result = await fetchActivityFeed();

    expect(result).toEqual([]);
  });
});

describe("fetchAggregatedDashboard", () => {
  it("calls apiFetch with correct URL", async () => {
    mockedFetch.mockResolvedValue(({ total_value: 100000 }));

    await fetchAggregatedDashboard();

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/paper/aggregated"),
    );
  });

  it("calls setAggregatedData on success", async () => {
    const data = { total_value: 100000, cash: 50000 };
    mockedFetch.mockResolvedValue(data);

    const { setAggregatedData } = await import("../state/paperTrading");

    await fetchAggregatedDashboard();

    expect(setAggregatedData).toHaveBeenCalledWith(data);
  });

  it("returns data on success", async () => {
    const data = { total_value: 100000, cash: 50000 };
    mockedFetch.mockResolvedValue(data);

    const result = await fetchAggregatedDashboard();

    expect(result).toEqual(data);
  });

  it("returns null on error", async () => {
    mockError(mockedFetch);

    const result = await fetchAggregatedDashboard();

    expect(result).toBeNull();
  });
});
