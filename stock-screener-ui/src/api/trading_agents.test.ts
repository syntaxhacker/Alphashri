import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import {
  getTradingAgentsConfig,
  checkTradingAgentsHealth,
  analyzeStock,
  streamStockAnalysis,
  sendChatMessage,
} from "./trading_agents";
import { fetchWithAuth } from "../state/auth";

const mockFetchWithAuth = vi.mocked(fetchWithAuth);

describe("TradingAgents API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getTradingAgentsConfig", () => {
    it("fetches config successfully", async () => {
      const mockConfig = {
        available_providers: ["deepseek", "openai"],
        default_provider: "deepseek",
        available_models: { deepseek: ["deepseek-chat"] },
        default_analysts: ["market", "news", "fundamentals"],
      };

      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockConfig),
      } as any);

      const result = await getTradingAgentsConfig();
      expect(result).toEqual(mockConfig);
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.stringContaining("/api/trading-agents/config"),
      );
    });

    it("throws error on failure", async () => {
      mockFetchWithAuth.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ detail: "Server error" }),
      } as any);

      await expect(getTradingAgentsConfig()).rejects.toThrow("Server error");
    });
  });

  describe("checkTradingAgentsHealth", () => {
    it("returns health status", async () => {
      const mockHealth = {
        status: "ok",
        tradingagents_available: true,
        timestamp: "2026-01-01T00:00:00",
      };

      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockHealth),
      } as any);

      const result = await checkTradingAgentsHealth();
      expect(result).toEqual(mockHealth);
    });

    it("returns unavailable when service down", async () => {
      const mockHealth = {
        status: "unavailable",
        tradingagents_available: false,
        timestamp: "2026-01-01T00:00:00",
      };

      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockHealth),
      } as any);

      const result = await checkTradingAgentsHealth();
      expect(result.tradingagents_available).toBe(false);
    });
  });

  describe("analyzeStock", () => {
    it("sends analysis request correctly", async () => {
      const mockResponse = {
        ticker: "NVDA",
        date: "2026-01-01",
        decision: "BUY",
        reports: {},
        stats: { llm_calls: 10, tool_calls: 5 },
      };

      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await analyzeStock({ ticker: "NVDA" });
      expect(result.ticker).toBe("NVDA");
      expect(result.decision).toBe("BUY");

      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.stringContaining("/api/trading-agents/analyze"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("includes optional parameters", async () => {
      const mockResponse = {
        ticker: "AAPL",
        date: "2026-01-15",
        decision: "HOLD",
        reports: {},
        stats: {},
      };

      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as any);

      await analyzeStock({
        ticker: "AAPL",
        date: "2026-01-15",
        analysts: ["market", "news"],
        llm_provider: "openai",
      });

      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.stringContaining("/api/trading-agents/analyze"),
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
  });

  describe("sendChatMessage", () => {
    it("sends chat message correctly", async () => {
      const mockResponse = {
        response: "Hello!",
        conversation_id: "chat_123",
        sources: null,
      };

      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await sendChatMessage({
        message: "Hello",
        ticker: "NVDA",
      });

      expect(result.response).toBe("Hello!");
      expect(result.conversation_id).toBe("chat_123");
    });
  });

  describe("streamStockAnalysis", () => {
    it("yields events from SSE stream", async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode('data: {"percent": 50}\n\n'),
              })
              .mockResolvedValueOnce({
                done: true,
                value: new TextEncoder().encode(""),
              }),
          }),
        },
      };

      mockFetchWithAuth.mockResolvedValue(mockResponse as any);

      const events: any[] = [];
      for await (const event of streamStockAnalysis("NVDA")) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
    });
  });
});
