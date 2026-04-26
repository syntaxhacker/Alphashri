import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/paperTrading", () => ({
  setPositions: vi.fn(),
  setPortfolio: vi.fn(),
  setLoading: vi.fn(),
  setError: vi.fn(),
  setupAutoRefresh: vi.fn(),
  stopAutoRefresh: vi.fn(),
  setBotStatus: vi.fn(),
  setBotSnapshot: vi.fn(),
}));

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

vi.mock("./paperTrading", () => ({
  fetchTrades: vi.fn(),
  refreshLiveData: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import {
  setupAutoRefresh,
  stopAutoRefresh,
  setBotStatus,
  setPortfolio,
  setPositions,
  setBotSnapshot,
  setLoading,
  setError,
} from "../state/paperTrading";
import { fetchTrades as mockFetchTrades, refreshLiveData } from "./paperTrading";
import {
  fetchPaperBotStatus,
  startPaperBot,
  stopPaperBot,
  initLiveAutoRefresh,
  stopLiveAutoRefresh,
  fetchBotSummaries,
  listBots,
  getBot,
  startBot,
  stopBot,
  fetchBotPortfolio,
  fetchBotPositions,
  fetchBotScanItems,
  fetchBotStrategyPerformance,
  normalizeBotPortfolio,
  refreshBotLiveData,
} from "./botControlApi";

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
    const positions = [{ symbol: "TATASTEEL" }, { symbol: "INFY" }];

    const result = normalizeBotPortfolio(portfolio, positions, 1000);

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
    expect(result.daily_pnl).toBe(3000);
    expect(result.daily_pnl_pct).toBe(2.0);
    expect(result.daily_trades).toBe(3);
    expect(result.open_positions).toBe(5);
    expect(result.max_daily_loss_pct).toBe(0);
    expect(result.daily_loss_limit_exceeded).toBe(false);
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

describe("fetchPaperBotStatus", () => {
  it("fetches and returns bot status on success", async () => {
    const mockStatus = { running: true, pid: 12345, log_file: "/var/log/bot.log" };
    mockedFetch.mockResolvedValue({
      json: async () => mockStatus,
    } as Response);

    const result = await fetchPaperBotStatus();

    expect(result).toEqual(mockStatus);
    expect(mockedFetch).toHaveBeenCalledWith("http://localhost:8765/api/paper/bot/status");
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchPaperBotStatus();

    expect(result).toBeNull();
  });
});

describe("startPaperBot", () => {
  it("starts bot and returns true on success", async () => {
    const mockResponse = { running: true, pid: 12345, log_file: "/var/log/bot.log" };
    mockedFetch.mockResolvedValue({
      json: async () => mockResponse,
    } as Response);

    const result = await startPaperBot();

    expect(result).toBe(true);
    expect(mockedFetch).toHaveBeenCalledWith("http://localhost:8765/api/paper/bot/start", {
      method: "POST",
    });
  });

  it("returns false on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Failed to start"));

    const result = await startPaperBot();

    expect(result).toBe(false);
  });
});

describe("stopPaperBot", () => {
  it("stops bot and returns true on success", async () => {
    const mockResponse = { running: false, pid: null, log_file: null };
    mockedFetch.mockResolvedValue({
      json: async () => mockResponse,
    } as Response);

    const result = await stopPaperBot();

    expect(result).toBe(true);
    expect(mockedFetch).toHaveBeenCalledWith("http://localhost:8765/api/paper/bot/stop", {
      method: "POST",
    });
  });

  it("returns false on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Failed to stop"));

    const result = await stopPaperBot();

    expect(result).toBe(false);
  });
});

describe("initLiveAutoRefresh & stopLiveAutoRefresh", () => {
  it("initLiveAutoRefresh calls setupAutoRefresh with correct interval", () => {
    initLiveAutoRefresh();

    expect(setupAutoRefresh).toHaveBeenCalledWith(refreshLiveData, 20000);
  });

  it("stopLiveAutoRefresh calls stopAutoRefresh", () => {
    stopLiveAutoRefresh();

    expect(stopAutoRefresh).toHaveBeenCalled();
  });
});

describe("fetchBotSummaries", () => {
  it("returns bot summaries array on success", async () => {
    const summaries = [
      { bot_id: "1", name: "Bot1" },
      { bot_id: "2", name: "Bot2" },
    ];
    mockedFetch.mockResolvedValue({
      json: async () => summaries,
    } as Response);

    const result = await fetchBotSummaries();

    expect(result).toEqual(summaries);
    expect(mockedFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots/summary");
  });

  it("returns empty array on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchBotSummaries();

    expect(result).toEqual([]);
  });
});

describe("listBots", () => {
  it("returns bots array on success", async () => {
    const bots = [{ bot_id: "1" }, { bot_id: "2" }];
    mockedFetch.mockResolvedValue({
      json: async () => bots,
    } as Response);

    const result = await listBots();

    expect(result).toEqual(bots);
    expect(mockedFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots");
  });

  it("returns empty array on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await listBots();

    expect(result).toEqual([]);
  });
});

describe("getBot", () => {
  it("returns bot details on success", async () => {
    const bot = { bot_id: "1", name: "Test Bot" };
    mockedFetch.mockResolvedValue({
      json: async () => bot,
    } as Response);

    const result = await getBot("1");

    expect(result).toEqual(bot);
    expect(mockedFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots/1");
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Not found"));

    const result = await getBot("999");

    expect(result).toBeNull();
  });
});

describe("startBot", () => {
  it("starts bot and returns success with data", async () => {
    const response = {
      success: true,
      pid: 12345,
      log_file: "/var/log/bot.log",
      message: "Started",
    };
    mockedFetch.mockResolvedValue({
      json: async () => ({ pid: 12345, log_file: "/var/log/bot.log", message: "Started" }),
    } as Response);

    const result = await startBot("bot-123");

    expect(result).toEqual(response);
    expect(mockedFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots/bot-123/start", {
      method: "POST",
    });
  });

  it("returns failure on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Failed to start"));

    const result = await startBot("bot-123");

    expect(result.success).toBe(false);
    expect(result.message).toContain("Failed to start");
  });
});

describe("stopBot", () => {
  it("stops bot and returns success", async () => {
    const response = { success: true, message: "Stopped" };
    mockedFetch.mockResolvedValue({
      json: async () => ({ message: "Stopped" }),
    } as Response);

    const result = await stopBot("bot-123");

    expect(result).toEqual(response);
    expect(mockedFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots/bot-123/stop", {
      method: "POST",
    });
  });

  it("returns failure on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Failed to stop"));

    const result = await stopBot("bot-123");

    expect(result.success).toBe(false);
  });
});

describe("fetchBotPortfolio", () => {
  it("returns portfolio data on success", async () => {
    const portfolio = {
      bot_id: "1",
      portfolio: { total_value: 100000 },
      positions: [],
      strategies: {},
    };
    mockedFetch.mockResolvedValue({
      json: async () => portfolio,
    } as Response);

    const result = await fetchBotPortfolio("1");

    expect(result).toEqual(portfolio);
    expect(mockedFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots/1/portfolio");
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchBotPortfolio("1");

    expect(result).toBeNull();
  });
});

describe("fetchBotPositions", () => {
  it("fetches all positions without filter", async () => {
    const response = { positions: [{ symbol: "TATASTEEL" }], count: 1 };
    mockedFetch.mockResolvedValue({
      json: async () => response,
    } as Response);

    const result = await fetchBotPositions("bot-1");

    expect(result).toEqual(response.positions);
    expect(mockedFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots/bot-1/positions");
  });

  it("adds strategy_id query param when provided", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({ positions: [], count: 0 }),
    } as Response);

    await fetchBotPositions("bot-1", "strategy-1");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("strategy_id=strategy-1");
  });

  it("returns empty array on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchBotPositions("bot-1");

    expect(result).toEqual([]);
  });
});

describe("fetchBotScanItems", () => {
  it("fetches scan items without filter", async () => {
    const response = { scan_items: [{ symbol: "INFY" }] };
    mockedFetch.mockResolvedValue({
      json: async () => response,
    } as Response);

    const result = await fetchBotScanItems("bot-1");

    expect(result).toEqual(response.scan_items);
    expect(mockedFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots/bot-1/scan");
  });

  it("adds strategy_id query param when provided", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({ scan_items: [] }),
    } as Response);

    await fetchBotScanItems("bot-1", "strategy-1");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("strategy_id=strategy-1");
  });

  it("returns empty array on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchBotScanItems("bot-1");

    expect(result).toEqual([]);
  });
});

describe("fetchBotStrategyPerformance", () => {
  it("fetches performance with default includeTest=true", async () => {
    const perf = { bot_id: "1", strategies: [{ id: "orb", pnl: 1000 }] };
    mockedFetch.mockResolvedValue({
      json: async () => perf,
    } as Response);

    const result = await fetchBotStrategyPerformance("bot-1");

    expect(result).toEqual(perf);
    expect(mockedFetch).toHaveBeenCalledWith(
      "http://localhost:8765/api/bots/bot-1/strategy-performance",
    );
  });

  it("omits include_test param when true", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({}),
    } as Response);

    await fetchBotStrategyPerformance("bot-1", true);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("include_test");
  });

  it("adds include_test=false when false", async () => {
    mockedFetch.mockResolvedValue({
      json: async () => ({}),
    } as Response);

    await fetchBotStrategyPerformance("bot-1", false);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("include_test=false");
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchBotStrategyPerformance("bot-1");

    expect(result).toBeNull();
  });
});

describe("refreshBotLiveData", () => {
  it("refreshes all bot data and updates state", async () => {
    mockedFetch
      .mockResolvedValueOnce({
        json: async () => ({ running: true, pid: 12345, log_file: "test.log" }),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          portfolio: { total_value: 100000, initial_capital: 100000 },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ positions: [{ symbol: "TATASTEEL", side: "BUY" }] }),
      })
      .mockResolvedValueOnce({ json: async () => ({ scan_items: [{ symbol: "INFY" }] }) });

    mockFetchTrades.mockResolvedValue([
      { exit_time: new Date().toISOString(), net_pnl: 500, pnl: 500 },
    ]);

    await refreshBotLiveData("bot-1");

    expect(setBotStatus).toHaveBeenCalledWith(true, 12345, null);
    expect(setPortfolio).toHaveBeenCalled();
    expect(setPositions).toHaveBeenCalledWith([
      expect.objectContaining({ symbol: "TATASTEEL", side: "BUY" }),
    ]);
    expect(setBotSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        timestamp: expect.any(String),
        open_positions: ["TATASTEEL"],
        scan_items: [{ symbol: "INFY" }],
      }),
    );
  });

  it("does not throw when individual APIs return null/empty", async () => {
    mockedFetch
      .mockResolvedValueOnce({ json: async () => ({ running: false }) })
      .mockResolvedValueOnce({
        json: async () => null,
      })
      .mockResolvedValueOnce({ json: async () => ({ positions: [] }) })
      .mockResolvedValueOnce({ json: async () => ({ scan_items: [] }) });

    mockFetchTrades.mockResolvedValue([]);

    await expect(refreshBotLiveData("bot-1")).resolves.not.toThrow();

    // State should still be set appropriately
    expect(setBotStatus).toHaveBeenCalledWith(false, null, null);
    expect(setPortfolio).not.toHaveBeenCalled(); // because portfolioData is null
    expect(setLoading).toHaveBeenCalledWith(false);
  });
});
