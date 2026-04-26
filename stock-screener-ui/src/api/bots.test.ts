import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./utils", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  apiPostAction: vi.fn(),
}));

import { apiGet, apiPost, apiPut, apiDelete, apiPostAction } from "./utils";

import {
  listBots,
  getBot,
  createBot,
  updateBot,
  deleteBot,
  startBot,
  stopBot,
  getBotStatus,
  getBotLogs,
  getBotPortfolio,
  getBotPositions,
  getBotPerformance,
  compareStrategyPerformance,
  listAvailableStrategies,
  getBotTradeCount,
  getBotTrades,
} from "./bots";

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);
const mockedApiPut = vi.mocked(apiPut);
const mockedApiDelete = vi.mocked(apiDelete);
const mockedApiPostAction = vi.mocked(apiPostAction);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listBots", () => {
  it("fetches and returns all bots", async () => {
    const bots = [
      { bot_id: "1", name: "Bot1" },
      { bot_id: "2", name: "Bot2" },
    ];
    mockedApiGet.mockResolvedValue(bots);

    const result = await listBots();

    expect(result).toEqual(bots);
    expect(mockedApiGet).toHaveBeenCalledWith("/api/bots");
  });
});

describe("getBot", () => {
  it("fetches and returns specific bot", async () => {
    const bot = { bot_id: "1", name: "Test Bot" };
    mockedApiGet.mockResolvedValue(bot);

    const result = await getBot("1");

    expect(result).toEqual(bot);
    expect(mockedApiGet).toHaveBeenCalledWith("/api/bots/1");
  });
});

describe("createBot", () => {
  it("creates bot with provided data", async () => {
    const botData = { name: "New Bot", strategy_ids: ["orb"] };
    const createdBot = { bot_id: "1", ...botData };
    mockedApiPost.mockResolvedValue(createdBot);

    const result = await createBot(botData);

    expect(result).toEqual(createdBot);
    expect(mockedApiPost).toHaveBeenCalledWith("/api/bots", botData);
  });
});

describe("updateBot", () => {
  it("updates bot with provided data", async () => {
    const botId = "1";
    const updateData = { name: "Updated Bot" };
    const updatedBot = { bot_id: botId, ...updateData };
    mockedApiPut.mockResolvedValue(updatedBot);

    const result = await updateBot(botId, updateData);

    expect(result).toEqual(updatedBot);
    expect(mockedApiPut).toHaveBeenCalledWith(`/api/bots/${botId}`, updateData);
  });
});

describe("deleteBot", () => {
  it("deletes bot and returns message", async () => {
    const response = { message: "Bot deleted" };
    mockedApiDelete.mockResolvedValue(response);

    const result = await deleteBot("1");

    expect(result).toEqual(response);
    expect(mockedApiDelete).toHaveBeenCalledWith("/api/bots/1");
  });
});

describe("startBot", () => {
  it("starts bot without test mode by default", async () => {
    const response = { message: "Bot started", pid: 12345, log_file: "/var/log/bot.log" };
    mockedApiPostAction.mockResolvedValue(response);

    const result = await startBot("1");

    expect(result).toEqual(response);
    expect(mockedApiPostAction).toHaveBeenCalledWith("/api/bots/1/start", undefined);
  });

  it("includes test_mode param when testMode is true", async () => {
    const response = {
      message: "Bot started in test mode",
      pid: 12345,
      log_file: "/var/log/test.log",
    };
    mockedApiPostAction.mockResolvedValue(response);

    await startBot("1", true);

    expect(mockedApiPostAction).toHaveBeenCalledWith("/api/bots/1/start", { test_mode: "true" });
  });
});

describe("stopBot", () => {
  it("stops bot and returns message", async () => {
    const response = { message: "Bot stopped" };
    mockedApiPostAction.mockResolvedValue(response);

    const result = await stopBot("1");

    expect(result).toEqual(response);
    expect(mockedApiPostAction).toHaveBeenCalledWith("/api/bots/1/stop");
  });
});

describe("getBotStatus", () => {
  it("returns running status when running is true", async () => {
    const raw = { running: true, uptime: 100 };
    mockedApiGet.mockResolvedValue(raw);

    const result = await getBotStatus("1");

    expect(result).toEqual({ ...raw, status: "running" });
  });

  it("returns stopped status when running is false", async () => {
    const raw = { running: false, uptime: 0 };
    mockedApiGet.mockResolvedValue(raw);

    const result = await getBotStatus("1");

    expect(result).toEqual({ ...raw, status: "stopped" });
  });

  it("returns unknown status when status_unknown is true", async () => {
    const raw = { status_unknown: true, running: false };
    mockedApiGet.mockResolvedValue(raw);

    const result = await getBotStatus("1");

    expect(result.status).toBe("unknown");
  });
});

describe("getBotLogs", () => {
  it("fetches logs with default limit", async () => {
    const response = { logs: "log lines", total_lines: 1000, showing: 100 };
    mockedApiGet.mockResolvedValue(response);

    const result = await getBotLogs("1");

    expect(result).toEqual(response);
    expect(mockedApiGet).toHaveBeenCalledWith("/api/bots/1/logs", { lines: 100 });
  });

  it("fetches logs with custom limit", async () => {
    const response = { logs: "log lines", total_lines: 500, showing: 200 };
    mockedApiGet.mockResolvedValue(response);

    await getBotLogs("1", 200);

    expect(mockedApiGet).toHaveBeenCalledWith("/api/bots/1/logs", { lines: 200 });
  });
});

describe("getBotPortfolio", () => {
  it("fetches portfolio with proper structure", async () => {
    const portfolio = {
      bot_id: "1",
      portfolio: { total_value: 100000 },
      positions: [],
      strategies: {},
      timestamp: "2024-01-01T00:00:00Z",
    };
    mockedApiGet.mockResolvedValue(portfolio);

    const result = await getBotPortfolio("1");

    expect(result).toEqual(portfolio);
    expect(mockedApiGet).toHaveBeenCalledWith("/api/bots/1/portfolio");
  });
});

describe("getBotPositions", () => {
  it("fetches positions without strategy filter", async () => {
    const response = { bot_id: "1", positions: [{ symbol: "TATASTEEL" }], count: 1 };
    mockedApiGet.mockResolvedValue(response);

    const result = await getBotPositions("1");

    expect(result).toEqual(response);
    expect(mockedApiGet).toHaveBeenCalledWith("/api/bots/1/positions", undefined);
  });

  it("includes strategy_id when provided", async () => {
    const response = { bot_id: "1", positions: [], count: 0 };
    mockedApiGet.mockResolvedValue(response);

    await getBotPositions("1", "orb");

    expect(mockedApiGet).toHaveBeenCalledWith("/api/bots/1/positions", { strategy_id: "orb" });
  });
});

describe("getBotPerformance", () => {
  it("fetches performance with default days", async () => {
    const performance = { pnl: 1000, win_rate: 60 };
    mockedApiGet.mockResolvedValue(performance);

    await getBotPerformance("1");

    expect(mockedApiGet).toHaveBeenCalledWith("/api/bots/1/performance", { days: 30 });
  });

  it("fetches performance with custom days", async () => {
    const performance = { pnl: 500 };
    mockedApiGet.mockResolvedValue(performance);

    await getBotPerformance("1", 7);

    expect(mockedApiGet).toHaveBeenCalledWith("/api/bots/1/performance", { days: 7 });
  });
});

describe("compareStrategyPerformance", () => {
  it("fetches strategy comparison", async () => {
    const response = {
      bot_id: "1",
      comparison: [
        { strategy_id: "orb", pnl: 1000, trades: 50 },
        { strategy_id: "52w", pnl: 500, trades: 20 },
      ],
      timestamp: "2024-01-01T00:00:00Z",
    };
    mockedApiGet.mockResolvedValue(response);

    const result = await compareStrategyPerformance("1");

    expect(result).toEqual(response);
    expect(mockedApiGet).toHaveBeenCalledWith("/api/bots/1/performance/compare");
  });
});

describe("listAvailableStrategies", () => {
  it("lists available strategies", async () => {
    const strategies = [
      { id: "orb", name: "Opening Range Breakout", enabled: true },
      { id: "52w", name: "52 Week High", enabled: true },
    ];
    mockedApiGet.mockResolvedValue(strategies);

    const result = await listAvailableStrategies();

    expect(result).toEqual(strategies);
    expect(mockedApiGet).toHaveBeenCalledWith("/api/bots/available-strategies");
  });
});

describe("getBotTradeCount", () => {
  it("returns trade count", async () => {
    const response = { count: 150 };
    mockedApiGet.mockResolvedValue(response);

    const result = await getBotTradeCount("1");

    expect(result).toEqual(response);
    expect(mockedApiGet).toHaveBeenCalledWith("/api/bots/1/trade-count");
  });
});

describe("getBotTrades", () => {
  it("fetches trades with default params", async () => {
    const response = { bot_id: "1", trades: [], count: 0 };
    mockedApiGet.mockResolvedValue(response);

    await getBotTrades("1");

    expect(mockedApiGet).toHaveBeenCalledWith("/api/bots/1/trades", { limit: 50 });
  });

  it("includes all params when provided", async () => {
    const response = { bot_id: "1", trades: [], count: 0 };
    mockedApiGet.mockResolvedValue(response);

    await getBotTrades("1", "orb", 100);

    expect(mockedApiGet).toHaveBeenCalledWith("/api/bots/1/trades", {
      limit: 100,
      strategy_id: "orb",
    });
  });
});
