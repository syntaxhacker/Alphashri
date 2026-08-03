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
  apiFetch: vi.fn(),
}));

vi.mock("./paperTrading", () => ({
  fetchTrades: vi.fn(),
  refreshLiveData: vi.fn(),
}));

import { apiFetch } from "../state/auth";
import {
  setupAutoRefresh,
  stopAutoRefresh,
  setBotStatus,
  setPortfolio,
  setPositions,
  setBotSnapshot,
  setLoading,
} from "../state/paperTrading";
import { fetchTrades as mockFetchTrades, refreshLiveData } from "./paperTrading";
import {
  fetchPaperBotStatus,
  startPaperBot,
  stopPaperBot,
  initLiveAutoRefresh,
  initBotAutoRefresh,
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

const mockedApiFetch = vi.mocked(apiFetch);

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
    mockedApiFetch.mockResolvedValue(mockStatus);

    const result = await fetchPaperBotStatus();

    expect(result).toEqual(mockStatus);
    expect(mockedApiFetch).toHaveBeenCalledWith("http://localhost:8765/api/paper/bot/status");
  });

  it("returns null on error", async () => {
    mockedApiFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchPaperBotStatus();

    expect(result).toBeNull();
  });
});

describe("startPaperBot", () => {
  it("starts bot and returns true on success", async () => {
    const mockResponse = { running: true, pid: 12345, log_file: "/var/log/bot.log" };
    mockedApiFetch.mockResolvedValue(mockResponse);

    const result = await startPaperBot();

    expect(result).toBe(true);
    expect(mockedApiFetch).toHaveBeenCalledWith("http://localhost:8765/api/paper/bot/start", {
      method: "POST",
    });
  });

  it("returns false on error", async () => {
    mockedApiFetch.mockRejectedValue(new Error("Failed to start"));

    const result = await startPaperBot();

    expect(result).toBe(false);
  });
});

describe("stopPaperBot", () => {
  it("stops bot and returns true on success", async () => {
    const mockResponse = { running: false, pid: null, log_file: null };
    mockedApiFetch.mockResolvedValue(mockResponse);

    const result = await stopPaperBot();

    expect(result).toBe(true);
    expect(mockedApiFetch).toHaveBeenCalledWith("http://localhost:8765/api/paper/bot/stop", {
      method: "POST",
    });
  });

  it("returns false on error", async () => {
    mockedApiFetch.mockRejectedValue(new Error("Failed to stop"));

    const result = await stopPaperBot();

    expect(result).toBe(false);
  });
});

describe("initLiveAutoRefresh & stopLiveAutoRefresh", () => {
  it("initLiveAutoRefresh calls setupAutoRefresh with correct interval", () => {
    initLiveAutoRefresh();

    expect(setupAutoRefresh).toHaveBeenCalledWith(refreshLiveData, 20000);
  });

  it("initBotAutoRefresh calls setupAutoRefresh with refreshBotLiveData wrapper and correct interval", () => {
    initBotAutoRefresh("bot-42");

    expect(setupAutoRefresh).toHaveBeenCalledTimes(1);
    expect(setupAutoRefresh).toHaveBeenCalledWith(expect.any(Function), 20000);

    const wrapperFn = (setupAutoRefresh as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(wrapperFn.toString()).toContain("refreshBotLiveData");
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
    mockedApiFetch.mockResolvedValue(summaries);

    const result = await fetchBotSummaries();

    expect(result).toEqual(summaries);
    expect(mockedApiFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots/summary");
  });

  it("returns empty array on error", async () => {
    mockedApiFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchBotSummaries();

    expect(result).toEqual([]);
  });
});

describe("listBots", () => {
  it("returns bots array on success", async () => {
    const bots = [{ bot_id: "1" }, { bot_id: "2" }];
    mockedApiFetch.mockResolvedValue(bots);

    const result = await listBots();

    expect(result).toEqual(bots);
    expect(mockedApiFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots");
  });

  it("returns empty array on error", async () => {
    mockedApiFetch.mockRejectedValue(new Error("Network error"));

    const result = await listBots();

    expect(result).toEqual([]);
  });
});

describe("getBot", () => {
  it("returns bot details on success", async () => {
    const bot = { bot_id: "1", name: "Test Bot" };
    mockedApiFetch.mockResolvedValue(bot);

    const result = await getBot("1");

    expect(result).toEqual(bot);
    expect(mockedApiFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots/1", expect.objectContaining({}));
  });

  it("returns null on error", async () => {
    mockedApiFetch.mockRejectedValue(new Error("Not found"));

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
    mockedApiFetch.mockResolvedValue(({ pid: 12345, log_file: "/var/log/bot.log", message: "Started" }));

    const result = await startBot("bot-123");

    expect(result).toEqual(response);
    expect(mockedApiFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots/bot-123/start", {
      method: "POST",
    });
  });

  it("returns failure on error", async () => {
    mockedApiFetch.mockRejectedValue(new Error("Failed to start"));

    const result = await startBot("bot-123");

    expect(result.success).toBe(false);
    expect(result.message).toContain("Failed to start");
  });
});

describe("stopBot", () => {
  it("stops bot and returns success", async () => {
    const response = { success: true, message: "Stopped" };
    mockedApiFetch.mockResolvedValue(({ message: "Stopped" }));

    const result = await stopBot("bot-123");

    expect(result).toEqual(response);
    expect(mockedApiFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots/bot-123/stop", {
      method: "POST",
    });
  });

  it("returns failure on error", async () => {
    mockedApiFetch.mockRejectedValue(new Error("Failed to stop"));

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
    mockedApiFetch.mockResolvedValue(portfolio);

    const result = await fetchBotPortfolio("1");

    expect(result).toEqual(portfolio);
    expect(mockedApiFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots/1/portfolio", expect.objectContaining({}));
  });

  it("returns null on error", async () => {
    mockedApiFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchBotPortfolio("1");

    expect(result).toBeNull();
  });
});

describe("fetchBotPositions", () => {
  it("fetches all positions without filter", async () => {
    const response = { positions: [{ symbol: "TATASTEEL" }], count: 1 };
    mockedApiFetch.mockResolvedValue(response);

    const result = await fetchBotPositions("bot-1");

    expect(result).toEqual(response.positions);
    expect(mockedApiFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots/bot-1/positions", expect.objectContaining({}));
  });

  it("adds strategy_id query param when provided", async () => {
    mockedApiFetch.mockResolvedValue(({ positions: [], count: 0 }));

    await fetchBotPositions("bot-1", "strategy-1");

    const calledUrl = mockedApiFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("strategy_id=strategy-1");
  });

  it("returns empty array on error", async () => {
    mockedApiFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchBotPositions("bot-1");

    expect(result).toEqual([]);
  });
});

describe("fetchBotScanItems", () => {
  it("fetches scan items without filter", async () => {
    const response = { scan_items: [{ symbol: "INFY" }] };
    mockedApiFetch.mockResolvedValue(response);

    const result = await fetchBotScanItems("bot-1");

    expect(result).toEqual(response.scan_items);
    expect(mockedApiFetch).toHaveBeenCalledWith("http://localhost:8765/api/bots/bot-1/scan", expect.objectContaining({}));
  });

  it("adds strategy_id query param when provided", async () => {
    mockedApiFetch.mockResolvedValue(({ scan_items: [] }));

    await fetchBotScanItems("bot-1", "strategy-1");

    const calledUrl = mockedApiFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("strategy_id=strategy-1");
  });

  it("returns empty array on error", async () => {
    mockedApiFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchBotScanItems("bot-1");

    expect(result).toEqual([]);
  });
});

describe("fetchBotStrategyPerformance", () => {
  it("fetches performance with default includeTest=true", async () => {
    const perf = { bot_id: "1", strategies: [{ id: "orb", pnl: 1000 }] };
    mockedApiFetch.mockResolvedValue(perf);

    const result = await fetchBotStrategyPerformance("bot-1");

    expect(result).toEqual(perf);
    expect(mockedApiFetch).toHaveBeenCalledWith(
      "http://localhost:8765/api/bots/bot-1/strategy-performance",
    );
  });

  it("omits include_test param when true", async () => {
    mockedApiFetch.mockResolvedValue(({}));

    await fetchBotStrategyPerformance("bot-1", true);

    const calledUrl = mockedApiFetch.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("include_test");
  });

  it("adds include_test=false when false", async () => {
    mockedApiFetch.mockResolvedValue(({}));

    await fetchBotStrategyPerformance("bot-1", false);

    const calledUrl = mockedApiFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("include_test=false");
  });

  it("returns null on error", async () => {
    mockedApiFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchBotStrategyPerformance("bot-1");

    expect(result).toBeNull();
  });
});

describe("refreshBotLiveData", () => {
  it("refreshes all bot data and updates state", async () => {
    mockedApiFetch
      .mockResolvedValueOnce(({ running: true, pid: 12345, log_file: "test.log" }))
      .mockResolvedValueOnce(({
          portfolio: { total_value: 100000, initial_capital: 100000 },
          watchlist: ["RELIANCE", "INFY"],
        }))
      .mockResolvedValueOnce(({ positions: [{ symbol: "TATASTEEL", side: "BUY" }] }))
      .mockResolvedValueOnce(({ scan_items: [{ symbol: "INFY" }] }));

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
        watchlist: ["RELIANCE", "INFY"],
        open_positions: ["TATASTEEL"],
        scan_items: [{ symbol: "INFY" }],
      }),
    );
  });

  it("does not throw when individual APIs return null/empty", async () => {
    mockedApiFetch
      .mockResolvedValueOnce(({ running: false }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(({ positions: [] }))
      .mockResolvedValueOnce(({ scan_items: [] }));

    mockFetchTrades.mockResolvedValue([]);

    await expect(refreshBotLiveData("bot-1")).resolves.not.toThrow();

    // State should still be set appropriately
    expect(setBotStatus).toHaveBeenCalledWith(false, null, null);
    expect(setPortfolio).not.toHaveBeenCalled(); // because portfolioData is null
    expect(setLoading).toHaveBeenCalledWith(false);
  });

  it("ignores stale responses when newer request started before first completed", async () => {
    // Setup mocks for Bot 1 (will be stale) and Bot 2 (winner)
    mockedApiFetch
      .mockResolvedValueOnce(({ running: true, pid: 111 }))
      .mockResolvedValueOnce(({ portfolio: { total_value: 100, initial_capital: 100 }, watchlist: ["BOT1"] }))
      .mockResolvedValueOnce(({ positions: [{ symbol: "BOT1_POS", side: "BUY" }] }))
      .mockResolvedValueOnce(({ scan_items: [{ symbol: "BOT1_SCAN" }] }))
      .mockResolvedValueOnce(({ running: true, pid: 222 }))
      .mockResolvedValueOnce(({ portfolio: { total_value: 200, initial_capital: 200 }, watchlist: ["BOT2"] }))
      .mockResolvedValueOnce(({ positions: [{ symbol: "BOT2_POS", side: "BUY" }] }))
      .mockResolvedValueOnce(({ scan_items: [{ symbol: "BOT2_SCAN" }] }));

    mockFetchTrades.mockResolvedValue([{ exit_time: new Date().toISOString(), net_pnl: 200 }]);

    vi.clearAllMocks();

    // Restore mock implementations: Bot 1 (4 calls) + Bot 2 (4 calls) + 1 fetchTrades
    mockedApiFetch
      .mockResolvedValueOnce(({ running: true, pid: 111 }))
      .mockResolvedValueOnce(({ portfolio: { total_value: 100, initial_capital: 100 }, watchlist: ["BOT1"] }))
      .mockResolvedValueOnce(({ positions: [{ symbol: "BOT1_POS", side: "BUY" }] }))
      .mockResolvedValueOnce(({ scan_items: [{ symbol: "BOT1_SCAN" }] }))
      .mockResolvedValueOnce(({ running: true, pid: 222 }))
      .mockResolvedValueOnce(({ portfolio: { total_value: 200, initial_capital: 200 }, watchlist: ["BOT2"] }))
      .mockResolvedValueOnce(({ positions: [{ symbol: "BOT2_POS", side: "BUY" }] }))
      .mockResolvedValueOnce(({ scan_items: [{ symbol: "BOT2_SCAN" }] }));

    mockFetchTrades.mockResolvedValue([{ exit_time: new Date().toISOString(), net_pnl: 200 }]);

    // Fire bot-1 without await, then await bot-2
    refreshBotLiveData("bot-1");
    await refreshBotLiveData("bot-2");

    // Bot 1's response should be stale — verify only Bot 2's state was applied
    const loadingFalse = vi.mocked(setLoading).mock.calls.filter(c => c[0] === false);
    expect(loadingFalse).toHaveLength(1);

    const portfolioCalls = vi.mocked(setPortfolio).mock.calls;
    expect(portfolioCalls).toHaveLength(1);
    expect(portfolioCalls[0][0].initial_capital).toBe(200);

    const posCalls = vi.mocked(setPositions).mock.calls;
    expect(posCalls).toHaveLength(1);
    expect(posCalls[0][0][0].symbol).toBe("BOT2_POS");
  });
});
