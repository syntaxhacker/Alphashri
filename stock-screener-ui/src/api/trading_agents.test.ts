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
  listConversations,
  createConversation,
  getMessages,
  addMessage,
  deleteConversation,
  fetchWithSSE,
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

    it("handles complete events", async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode('data: {"decision":"BUY","stats":{"llm_calls":5}}\n\n'),
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

      expect(events.some((e) => e.event === "complete")).toBe(true);
    });

    it("handles error events", async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: vi
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode('data: {"error":"Rate limit exceeded"}\n\n'),
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

      expect(events.some((e) => e.event === "error")).toBe(true);
    });

    it("throws on non-ok response", async () => {
      mockFetchWithAuth.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ detail: "Server error" }),
      } as any);

      await expect(streamStockAnalysis("NVDA").next()).rejects.toThrow("Server error");
    });

    it("throws when response has no body", async () => {
      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        body: null,
      } as any);

      await expect(streamStockAnalysis("NVDA").next()).rejects.toThrow("No response body");
    });
  });

  describe("analyzeStock", () => {
    it("throws on non-ok response", async () => {
      mockFetchWithAuth.mockResolvedValue({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({ detail: "Invalid ticker" }),
      } as any);

      await expect(analyzeStock({ ticker: "BAD" })).rejects.toThrow("Invalid ticker");
    });
  });

  describe("fetchWithSSE", () => {
  it("reads SSE stream and calls onEvent callback", async () => {
    const encoder = new TextEncoder();
    const chunk =
      "event: progress\ndata: {\"percent\": 50}\n\n" +
      "event: report\ndata: {\"section\": \"market\"}\n\n";
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({ done: false, value: encoder.encode(chunk) })
            .mockResolvedValueOnce({ done: true, value: encoder.encode("") }),
        }),
      },
    } as any);

    const onEvent = vi.fn();
    await fetchWithSSE("/api/test", onEvent);

    expect(onEvent).toHaveBeenNthCalledWith(1, "progress", { percent: 50 });
    expect(onEvent).toHaveBeenNthCalledWith(2, "report", { section: "market" });
  });

  it("throws on non-ok response", async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({}),
    } as any);

    const onEvent = vi.fn();
    await expect(fetchWithSSE("/api/test", onEvent)).rejects.toThrow("HTTP 500");
  });

  it("throws when response has no body", async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      body: null,
    } as any);

    const onEvent = vi.fn();
    await expect(fetchWithSSE("/api/test", onEvent)).rejects.toThrow("No response body");
  });

  it("passes options to fetchWithAuth", async () => {
    const encoder = new TextEncoder();
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({ done: false, value: encoder.encode("data: test\n\n") })
            .mockResolvedValueOnce({ done: true, value: encoder.encode("") }),
        }),
      },
    } as any);

    await fetchWithSSE("/api/test", vi.fn(), { method: "POST" });

    expect(mockFetchWithAuth).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Accept: "text/event-stream" }),
      }),
    );
  });
});

describe("Conversation management", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("listConversations fetches conversation list", async () => {
      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ conversations: [{ id: "c1", title: "Chat 1" }] }),
      } as any);

      const result = await listConversations();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("c1");
    });

    it("createConversation creates with optional title", async () => {
      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: "c2", title: "New Chat" }),
      } as any);

      const result = await createConversation("New Chat");
      expect(result.id).toBe("c2");
    });

    it("getMessages fetches messages for conversation", async () => {
      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ messages: [{ id: "m1", role: "user", content: "Hello", created_at: "2024-01-01" }] }),
      } as any);

      const result = await getMessages("c1");
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("user");
    });

    it("addMessage adds message with role, content, optional ticker", async () => {
      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: "m2", role: "user", content: "Test", created_at: "2024-01-01" }),
      } as any);

      const result = await addMessage("c1", "user", "Test", "AAPL");
      expect(result.id).toBe("m2");
    });

    it("deleteConversation sends DELETE request", async () => {
      mockFetchWithAuth.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      } as any);

      await deleteConversation("c1");
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.stringContaining("/conversations/c1"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });
});
