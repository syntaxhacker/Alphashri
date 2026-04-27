// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNewsWebSocket, NewsWebSocketProvider } from "./newsWebSocket";

const mockNewsItem: NewsItem = {
  id: "1",
  headline: "Test News",
  description: "Test description",
  source: "Test Source",
  sourceUrl: "https://test.com",
  publishedAt: "2025-01-01T00:00:00Z",
  fetchedAt: "2025-01-01T00:00:00Z",
};

// Simple mock for WebSocket
function createMockWebSocket() {
  let handlers: any = {};
  return {
    set onopen(fn: any) {
      handlers.open = fn;
    },
    set onclose(fn: any) {
      handlers.close = fn;
    },
    set onmessage(fn: any) {
      handlers.message = fn;
    },
    set onerror(fn: any) {
      handlers.error = fn;
    },
    close: vi.fn(),
    send: vi.fn(),
    triggerOpen() {
      handlers.open?.();
    },
    triggerClose(event?: any) {
      handlers.close?.(event);
    },
    triggerMessage(data: string) {
      handlers.message?.({ data });
    },
    triggerError(err: any) {
      handlers.error?.(err);
    },
  };
}

describe("useNewsWebSocket", () => {
  let mockWsInstance: any;
  let wsUrl: string;
  let origWebSocket: typeof WebSocket;
  let wsConstructor: any;

  beforeEach(() => {
    vi.stubEnv("WS_BASE", "ws://localhost");
    origWebSocket = global.WebSocket;

    mockWsInstance = createMockWebSocket();
    wsUrl = "";
    wsConstructor = vi.fn(function (this: any, url: string) {
      wsUrl = url;
      return mockWsInstance;
    });

    // @ts-expect-error mocking WebSocket
    global.WebSocket = wsConstructor as any;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.WebSocket = origWebSocket;
    vi.restoreAllMocks();
  });

  function renderWithWrapper() {
    return renderHook(() => useNewsWebSocket(), {
      wrapper: ({ children }) => <NewsWebSocketProvider>{children}</NewsWebSocketProvider>,
    });
  }

  it("provides initial state", () => {
    const { result } = renderWithWrapper();
    expect(result.current.connected).toBe(false);
    expect(result.current.newsItems).toEqual([]);
    expect(result.current.hasNewArticles).toBe(false);
    expect(typeof result.current.clearNewArticlesFlag).toBe("function");
    expect(typeof result.current.addNewsItems).toBe("function");
  });

  it("connects to correct WebSocket URL", () => {
    renderWithWrapper();
    expect(wsUrl).toBe("ws://localhost:8765/ws/news");
  });

  it("sets connected true on open", () => {
    const { result, rerender } = renderWithWrapper();

    act(() => {
      mockWsInstance.triggerOpen();
    });
    rerender();

    expect(result.current.connected).toBe(true);
  });

  it("adds news items on message", () => {
    const { result, rerender } = renderWithWrapper();

    const items: NewsItem[] = [
      { ...mockNewsItem, id: "1" },
      { ...mockNewsItem, id: "2" },
    ];

    act(() => {
      mockWsInstance.triggerMessage(JSON.stringify({ type: "new_items", items }));
    });
    rerender();

    expect(result.current.newsItems).toHaveLength(2);
    expect(result.current.hasNewArticles).toBe(true);
  });

  it("deduplicates items by id", () => {
    const { result, rerender } = renderWithWrapper();

    const items: NewsItem[] = [{ ...mockNewsItem, id: "1" }];

    act(() => {
      mockWsInstance.triggerMessage(JSON.stringify({ type: "new_items", items }));
    });
    act(() => {
      mockWsInstance.triggerMessage(JSON.stringify({ type: "new_items", items }));
    });

    rerender();

    expect(result.current.newsItems).toHaveLength(1);
  });

  it("limits items to 100", () => {
    const { result, rerender } = renderWithWrapper();

    const manyItems = Array.from({ length: 150 }, (_, i) => ({
      ...mockNewsItem,
      id: String(i),
    }));

    act(() => {
      mockWsInstance.triggerMessage(JSON.stringify({ type: "new_items", items: manyItems }));
    });
    rerender();

    expect(result.current.newsItems).toHaveLength(100);
  });

  it("clearNewsArticlesFlag resets flag", () => {
    const { result, rerender } = renderWithWrapper();

    // Initially false
    expect(result.current.hasNewArticles).toBe(false);

    act(() => {
      result.current.clearNewArticlesFlag();
    });
    rerender();

    // Remains false
    expect(result.current.hasNewArticles).toBe(false);
  });

  it("addNewsItems function adds items manually", () => {
    const { result, rerender } = renderWithWrapper();

    act(() => {
      result.current.addNewsItems([mockNewsItem]);
    });
    rerender();

    expect(result.current.newsItems).toHaveLength(1);
  });

  it("sets connected false on close", () => {
    const { result, rerender } = renderWithWrapper();

    act(() => {
      mockWsInstance.triggerOpen();
    });
    rerender();
    expect(result.current.connected).toBe(true);

    act(() => {
      mockWsInstance.triggerClose({ code: 1000 });
    });
    rerender();

    expect(result.current.connected).toBe(false);
  });

  it("reconnects on abnormal close", async () => {
    vi.useFakeTimers();
    const { result } = renderWithWrapper();

    act(() => {
      mockWsInstance.triggerOpen();
    });
    expect(result.current.connected).toBe(true);

    act(() => {
      mockWsInstance.triggerClose({ code: 1001 });
    });

    await vi.runAllTimersAsync();

    expect(global.WebSocket).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not reconnect on normal close (code 1000)", () => {
    const { result } = renderWithWrapper();

    act(() => {
      mockWsInstance.triggerOpen();
    });
    expect(result.current.connected).toBe(true);

    act(() => {
      mockWsInstance.triggerClose({ code: 1000 });
    });

    expect(global.WebSocket).toHaveBeenCalledTimes(1);
  });

  it("handles malformed JSON gracefully", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithWrapper();

    act(() => {
      mockWsInstance.triggerMessage("invalid json");
    });
    // just ensure no crash

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("NewsWebSocketProvider", () => {
  it("renders children without crashing", () => {
    const { result } = renderHook(() => useNewsWebSocket(), {
      wrapper: ({ children }) => <NewsWebSocketProvider>{children}</NewsWebSocketProvider>,
    });
    expect(result.current).toBeDefined();
  });
});
