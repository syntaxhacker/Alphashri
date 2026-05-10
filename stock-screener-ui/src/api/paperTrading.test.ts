import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/paperTrading", () => ({
  setPositions: vi.fn(),
  setPortfolio: vi.fn(),
  setTrades: vi.fn(),
  setDailySummary: vi.fn(),
  setPerformanceSummary: vi.fn(),
  setSymbolPerformance: vi.fn(),
  setChartData: vi.fn(),
  setChartLoading: vi.fn(),
  setError: vi.fn(),
  setLoading: vi.fn(),
  setBotStatus: vi.fn(),
  setBotSnapshot: vi.fn(),
  setupAutoRefresh: vi.fn(),
  stopAutoRefresh: vi.fn(),
  setStrategyConfig: vi.fn(),
  setConfigLoading: vi.fn(),
  setConfigError: vi.fn(),
}));

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
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
  fetchPaperBotSnapshot,
  fetchPortfolio,
  refreshLiveData,
  refreshHistoryData,
  fetchStrategyConfig,
  updateStrategyConfig,
  resetStrategyConfig,
} from "./paperTrading";

const mockedFetch = vi.mocked(fetchWithAuth);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeBotPortfolio", () => {
  it("normalizes a full portfolio object", () => {
    const portfolio = {
      initial_capital: 100000,
      cash: 50000,
      margin_used: 30000,
      position_value: 70000,
      unrealized_pnl: 2000,
      realized_pnl: 5000,
      total_value: 120000,
      total_pnl: 7000,
      total_pnl_pct: 7.0,
      total_positions: 5,
      trades: 20,
      daily_pnl_pct: 2.0,
      daily_trades: 3,
      open_positions: 5,
    };

    const result = normalizeBotPortfolio(portfolio, [], 1000);

    expect(result.initial_capital).toBe(100000);
    expect(result.cash).toBe(50000);
    expect(result.margin_used).toBe(30000);
    expect(result.position_value).toBe(70000);
    expect(result.unrealized_pnl).toBe(2000);
    expect(result.realized_pnl).toBe(5000);
    expect(result.total_value).toBe(120000);
    expect(result.total_pnl).toBe(7000);
    expect(result.total_pnl_pct).toBe(7.0);
    expect(result.positions).toBe(5);
    expect(result.trades).toBe(20);
    expect(result.daily_pnl).toBe(3000); // 1000 realized + 2000 unrealized
    expect(result.daily_pnl_pct).toBe(2.0);
    expect(result.daily_trades).toBe(3);
    expect(result.open_positions).toBe(5);
  });

  it("handles null portfolio with defaults", () => {
    const result = normalizeBotPortfolio(null, [], 0);

    expect(result.initial_capital).toBe(0);
    expect(result.cash).toBe(0);
    expect(result.margin_used).toBe(0);
    expect(result.position_value).toBe(0);
    expect(result.unrealized_pnl).toBe(0);
    expect(result.realized_pnl).toBe(0);
    expect(result.total_value).toBe(0);
    expect(result.total_pnl).toBe(0);
    expect(result.total_pnl_pct).toBe(0);
    expect(result.positions).toBe(0);
    expect(result.trades).toBe(0);
    expect(result.daily_pnl).toBe(0);
    expect(result.daily_pnl_pct).toBe(0);
    expect(result.daily_trades).toBe(0);
    expect(result.open_positions).toBe(0);
  });

  it("uses positions.length as fallback for total_positions", () => {
    const portfolio = { initial_capital: 100000 };
    const positions = [{ symbol: "TATASTEEL" }, { symbol: "INFY" }];

    const result = normalizeBotPortfolio(portfolio, positions, 0);

    expect(result.positions).toBe(2);
  });

  it("uses capital_used as fallback for margin_used", () => {
    const portfolio = { capital_used: 25000 };

    const result = normalizeBotPortfolio(portfolio, [], 0);

    expect(result.margin_used).toBe(25000);
  });

  it("uses total_trades as fallback for trades", () => {
    const portfolio = { total_trades: 42 };

    const result = normalizeBotPortfolio(portfolio, [], 0);

    expect(result.trades).toBe(42);
  });

  it("computes daily_pnl_pct from initial_capital when not provided", () => {
    const portfolio = { initial_capital: 100000 };

    const result = normalizeBotPortfolio(portfolio, [], 500);

    expect(result.daily_pnl).toBe(500);
    expect(result.daily_pnl_pct).toBeCloseTo(0.5, 2);
  });

  it("returns 0 daily_pnl_pct when initial_capital is 0", () => {
    const portfolio = { initial_capital: 0 };

    const result = normalizeBotPortfolio(portfolio, [], 500);

    expect(result.daily_pnl_pct).toBe(0);
  });

  it("converts string values to numbers", () => {
    const portfolio = {
      initial_capital: "100000",
      unrealized_pnl: "2000",
      cash: "50000",
    };

    const result = normalizeBotPortfolio(portfolio, [], 0);

    expect(result.initial_capital).toBe(100000);
    expect(result.unrealized_pnl).toBe(2000);
    expect(result.cash).toBe(50000);
  });
});

describe("fetchPositions", () => {
  it("extracts positions array from response", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({ positions: [{ symbol: "TATASTEEL" }] }),
    } as Response);

    const result = await fetchPositions();

    expect(result).toEqual([{ symbol: "TATASTEEL" }]);
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining("/api/paper/positions"));
  });

  it("returns empty array when response has no positions key", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({}),
    } as Response);

    const result = await fetchPositions();

    expect(result).toEqual([]);
  });

  it("returns empty array on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchPositions();

    expect(result).toEqual([]);
  });
});

describe("fetchTrades", () => {
  it("builds URL with all params", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({ trades: [], total_trades: 0 }),
    } as Response);

    await fetchTrades(50, "bot-1", "2024-01-01", "2024-01-31", 60);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("limit=50");
    expect(calledUrl).toContain("bot_id=bot-1");
    expect(calledUrl).toContain("from_date=2024-01-01");
    expect(calledUrl).toContain("to_date=2024-01-31");
    expect(calledUrl).toContain("days_back=60");
  });

  it("omits optional params when not provided", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({ trades: [], total_trades: 0 }),
    } as Response);

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
    mockedFetch.mockResolvedValue({
      json: async () => ({ trades, total_trades: 2 }),
    } as Response);

    const result = await fetchTrades();

    expect(result).toEqual(trades);
  });

  it("returns empty array when response has no trades key", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({ total_trades: 0 }),
    } as Response);

    const result = await fetchTrades();

    expect(result).toEqual([]);
  });

  it("returns empty array on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

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
    mockedFetch.mockResolvedValue({
      json: async () => data,
    } as Response);

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
    mockedFetch.mockResolvedValue({
      json: async () => ({}),
    } as Response);

    const result = await fetchSymbolPerformance();

    expect(result).toEqual([]);
  });

  it("returns empty array on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchSymbolPerformance();

    expect(result).toEqual([]);
  });
});

describe("fetchDailyReport", () => {
  it("includes date param when provided", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({ date: "2024-01-01", pnl: 500 }),
    } as Response);

    await fetchDailyReport("2024-01-01");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("date=2024-01-01");
  });

  it("omits date param when not provided", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({ date: "2024-01-01", pnl: 500 }),
    } as Response);

    await fetchDailyReport();

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("date=");
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchDailyReport();

    expect(result).toBeNull();
  });
});

describe("healthCheck", () => {
  it("returns true when status is healthy", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({ status: "healthy" }),
    } as Response);

    const result = await healthCheck();

    expect(result).toBe(true);
  });

  it("returns false when status is not healthy", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({ status: "unhealthy" }),
    } as Response);

    const result = await healthCheck();

    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await healthCheck();

    expect(result).toBe(false);
  });
});

describe("closePaperPosition", () => {
  it("sends correct POST body with uppercased symbol", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ pnl: 500 }),
    } as Response);

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
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ pnl: 0 }),
    } as Response);

    await closePaperPosition("TATASTEEL", 100);

    const body = JSON.parse((mockedFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.reason).toBe("MANUAL");
  });

  it("throws on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: "Position not found" }),
    } as Response);

    await expect(closePaperPosition("BAD", 0)).rejects.toThrow("Position not found");
  });
});

describe("deleteTrade", () => {
  it("includes tradeId in URL", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ message: "Trade deleted" }),
    } as Response);

    await deleteTrade("trade-123");

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/paper/trades/trade-123"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("throws on non-ok response with detail", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Trade not found" }),
    } as Response);

    await expect(deleteTrade("bad-id")).rejects.toThrow("Trade not found");
  });

  it("throws generic error when no detail provided", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as Response);

    await expect(deleteTrade("bad-id")).rejects.toThrow("Failed to delete trade");
  });
});

describe("closeAllPositions", () => {
  it("sends POST to /api/bots/{botId}/close-all", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ message: "All positions closed" }),
    } as Response);

    const result = await closeAllPositions("bot-1", { TATASTEEL: 1500 });

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/bots/bot-1/close-all"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"prices"'),
      }),
    );
    expect(result.success).toBe(true);
  });

  it("throws on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Bot not found" }),
    } as Response);

    await expect(closeAllPositions("bad-bot", {})).rejects.toThrow("Bot not found");
  });
});

describe("updateTradeNotes", () => {
  it("sends PATCH with notes and reason", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "trade-1", notes: "Updated", reason: "SL" }),
    } as Response);

    const result = await updateTradeNotes("trade-1", "Updated notes", "SL hit");

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/paper/trades/trade-1"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"notes":"Updated notes"'),
      }),
    );
    expect(result.notes).toBe("Updated");
  });

  it("throws on non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Trade not found" }),
    } as Response);

    await expect(updateTradeNotes("bad-id", "", "")).rejects.toThrow("Trade not found");
  });
});

describe("fetchPaperChart", () => {
  it("builds URL with symbol and optional params", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ symbol: "RELIANCE", candles: [] }),
    } as Response);

    await fetchPaperChart("RELIANCE", "2024-01-01", "5", 1);

    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).toContain("/api/paper/chart/RELIANCE");
  });

  it("handles data.error gracefully", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ error: "No data" }),
    } as Response);

    const result = await fetchPaperChart("RELIANCE");
    expect(result).toBeNull();
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchPaperChart("RELIANCE");
    expect(result).toBeNull();
  });
});

describe("fetchPaperBotSnapshot", () => {
  it("fetches bot snapshot", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ positions: [], status: "running" }),
    } as Response);

    const result = await fetchPaperBotSnapshot();
    expect(result).toEqual({ positions: [], status: "running" });
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("fail"));
    const result = await fetchPaperBotSnapshot();
    expect(result).toBeNull();
  });
});

describe("fetchPortfolio", () => {
  it("fetches portfolio data", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ initial_capital: 100000, cash: 50000 }),
    } as Response);

    const result = await fetchPortfolio();
    expect(result.initial_capital).toBe(100000);
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("fail"));
    const result = await fetchPortfolio();
    expect(result).toBeNull();
  });
});

describe("refreshLiveData", () => {
  it("fetches portfolio, positions, bot status in parallel", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    await refreshLiveData();
    expect(mockedFetch).toHaveBeenCalled();
  });
});

describe("refreshHistoryData", () => {
  it("fetches trades and performance summary in parallel", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    await refreshHistoryData();
    expect(mockedFetch).toHaveBeenCalled();
  });
});

describe("fetchStrategyConfig", () => {
  it("fetches config with optional strategy_id", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ config: { sl_pct: 1.0 } }),
    } as Response);

    const result = await fetchStrategyConfig(1);
    expect(result).toEqual({ sl_pct: 1.0 });
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("fail"));
    const result = await fetchStrategyConfig();
    expect(result).toBeNull();
  });
});

describe("updateStrategyConfig", () => {
  it("sends PUT with config body", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ config: { sl_pct: 2.0 } }),
    } as Response);

    const result = await updateStrategyConfig({ sl_pct: 2.0 });
    expect(result).toBe(true);
  });

  it("returns false on error", async () => {
    mockedFetch.mockRejectedValue(new Error("fail"));
    const result = await updateStrategyConfig({});
    expect(result).toBe(false);
  });
});

describe("resetStrategyConfig", () => {
  it("sends POST to /api/paper/config/reset", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ config: { sl_pct: 0.5 } }),
    } as Response);

    const result = await resetStrategyConfig();
    expect(result).toBe(true);
  });
});
