// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { NewsWebSocketProvider, useNewsWebSocket } from "./newsWebSocket";
import type { NewsItem } from "../components/news/news-types";

vi.mock("../api/config", () => ({
  WS_BASE: "ws://localhost:8765",
}));

const mockNewsItems: NewsItem[] = [
  {
    id: "news-1",
    headline: "Market Rally",
    description: "Nifty hits all-time high",
    source: "Moneycontrol",
    sourceUrl: "https://example.com/1",
    publishedAt: "2025-01-01T10:00:00Z",
    fetchedAt: "2025-01-01T10:05:00Z",
    symbols: [],
  },
  {
    id: "news-2",
    headline: "Bank Results",
    description: "HDFC Bank Q3 results",
    source: "LiveMint",
    sourceUrl: "https://example.com/2",
    publishedAt: "2025-01-01T09:00:00Z",
    fetchedAt: "2025-01-01T09:05:00Z",
    symbols: [],
  },
];

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  private closeCode = 1000;

  constructor(url: string) {
    this.url = url;
    if (typeof MockWebSocket.onCreate === "function") {
      MockWebSocket.onCreate(this);
    }
  }

  close(code = 1000) {
    this.closeCode = code;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code, wasClean: code === 1000 }));
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  simulateMessage(data: any) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }

  simulateClose(code = 1000) {
    this.closeCode = code;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code, wasClean: code === 1000 }));
  }

  static onCreate: ((ws: MockWebSocket) => void) | null = null;
  static instances: MockWebSocket[] = [];
  static lastInstance: MockWebSocket | null = null;
}

const originalWebSocket = globalThis.WebSocket;

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(NewsWebSocketProvider, null, children);
  };
}

describe("newsWebSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    MockWebSocket.lastInstance = null;
    MockWebSocket.onCreate = (ws) => {
      MockWebSocket.lastInstance = ws;
      MockWebSocket.instances.push(ws);
    };
    globalThis.WebSocket = MockWebSocket as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    MockWebSocket.onCreate = null;
    MockWebSocket.instances = [];
    MockWebSocket.lastInstance = null;
    vi.restoreAllMocks();
  });

  it("creates WebSocket on mount", () => {
    renderHook(() => useNewsWebSocket(), { wrapper: createWrapper() });
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(1);
  });

  it("initial state is disconnected with empty news", () => {
    const { result } = renderHook(() => useNewsWebSocket(), { wrapper: createWrapper() });
    expect(result.current.connected).toBe(false);
    expect(result.current.newsItems).toEqual([]);
    expect(result.current.hasNewArticles).toBe(false);
  });

  it("sets connected on open", () => {
    const { result } = renderHook(() => useNewsWebSocket(), { wrapper: createWrapper() });

    act(() => {
      MockWebSocket.lastInstance?.simulateOpen();
    });

    expect(result.current.connected).toBe(true);
  });

  it("adds news items on message", () => {
    const { result } = renderHook(() => useNewsWebSocket(), { wrapper: createWrapper() });

    act(() => {
      MockWebSocket.lastInstance?.simulateOpen();
    });

    act(() => {
      MockWebSocket.lastInstance?.simulateMessage({
        type: "new_items",
        items: mockNewsItems,
      });
    });

    expect(result.current.newsItems).toHaveLength(2);
    expect(result.current.hasNewArticles).toBe(true);
  });

  it("deduplicates news items by id", () => {
    const { result } = renderHook(() => useNewsWebSocket(), { wrapper: createWrapper() });

    act(() => {
      MockWebSocket.lastInstance?.simulateOpen();
    });

    act(() => {
      MockWebSocket.lastInstance?.simulateMessage({
        type: "new_items",
        items: mockNewsItems,
      });
    });

    act(() => {
      MockWebSocket.lastInstance?.simulateMessage({
        type: "new_items",
        items: [mockNewsItems[0]],
      });
    });

    expect(result.current.newsItems).toHaveLength(2);
  });

  it("limits news items to 100", () => {
    const { result } = renderHook(() => useNewsWebSocket(), { wrapper: createWrapper() });

    act(() => {
      MockWebSocket.lastInstance?.simulateOpen();
    });

    const manyItems: NewsItem[] = Array.from({ length: 150 }, (_, i) => ({
      id: `news-${i}`,
      headline: `News ${i}`,
      description: `Description ${i}`,
      source: "Test",
      sourceUrl: `https://example.com/${i}`,
      publishedAt: "2025-01-01T10:00:00Z",
      fetchedAt: "2025-01-01T10:05:00Z",
    }));

    act(() => {
      MockWebSocket.lastInstance?.simulateMessage({
        type: "new_items",
        items: manyItems,
      });
    });

    expect(result.current.newsItems).toHaveLength(100);
  });

  it("ignores non-new_items messages", () => {
    const { result } = renderHook(() => useNewsWebSocket(), { wrapper: createWrapper() });

    act(() => {
      MockWebSocket.lastInstance?.simulateOpen();
    });

    act(() => {
      MockWebSocket.lastInstance?.simulateMessage({ type: "ping" });
    });

    expect(result.current.newsItems).toHaveLength(0);
    expect(result.current.hasNewArticles).toBe(false);
  });

  it("clearNewArticlesFlag resets hasNewArticles", () => {
    const { result } = renderHook(() => useNewsWebSocket(), { wrapper: createWrapper() });

    act(() => {
      MockWebSocket.lastInstance?.simulateOpen();
    });

    act(() => {
      MockWebSocket.lastInstance?.simulateMessage({
        type: "new_items",
        items: mockNewsItems,
      });
    });

    expect(result.current.hasNewArticles).toBe(true);

    act(() => {
      result.current.clearNewArticlesFlag();
    });

    expect(result.current.hasNewArticles).toBe(false);
  });

  it("addNewsItems adds items from outside", () => {
    const { result } = renderHook(() => useNewsWebSocket(), { wrapper: createWrapper() });

    act(() => {
      result.current.addNewsItems(mockNewsItems);
    });

    expect(result.current.newsItems).toHaveLength(2);
  });

  it("sets disconnected on close", () => {
    const { result } = renderHook(() => useNewsWebSocket(), { wrapper: createWrapper() });

    act(() => {
      MockWebSocket.lastInstance?.simulateOpen();
    });
    expect(result.current.connected).toBe(true);

    act(() => {
      MockWebSocket.lastInstance?.simulateClose(1000);
    });
    expect(result.current.connected).toBe(false);
  });

  it("reconnects with exponential backoff on abnormal close", () => {
    renderHook(() => useNewsWebSocket(), { wrapper: createWrapper() });

    act(() => {
      MockWebSocket.lastInstance?.simulateOpen();
    });

    const countAfterFirst = MockWebSocket.instances.length;

    act(() => {
      MockWebSocket.lastInstance?.simulateClose(1006);
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(MockWebSocket.instances.length).toBeGreaterThan(countAfterFirst);
  });

  it("stops reconnecting after max retries", () => {
    renderHook(() => useNewsWebSocket(), { wrapper: createWrapper() });

    act(() => {
      MockWebSocket.lastInstance?.simulateOpen();
    });

    for (let i = 0; i < 12; i++) {
      act(() => {
        MockWebSocket.lastInstance?.simulateClose(1006);
      });
      act(() => {
        vi.advanceTimersByTime(120000);
      });
    }

    const finalCount = MockWebSocket.instances.length;
    expect(finalCount).toBeLessThanOrEqual(11);
  });

  it("does not reconnect on normal close (1000)", () => {
    renderHook(() => useNewsWebSocket(), { wrapper: createWrapper() });

    act(() => {
      MockWebSocket.lastInstance?.simulateOpen();
    });

    const countAfterFirst = MockWebSocket.instances.length;

    act(() => {
      MockWebSocket.lastInstance?.simulateClose(1000);
    });

    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(MockWebSocket.instances.length).toBe(countAfterFirst);
  });

  it("closes WebSocket on unmount", () => {
    const { unmount } = renderHook(() => useNewsWebSocket(), { wrapper: createWrapper() });

    act(() => {
      MockWebSocket.lastInstance?.simulateOpen();
    });

    expect(MockWebSocket.lastInstance?.readyState).toBe(MockWebSocket.OPEN);

    unmount();

    expect(MockWebSocket.lastInstance?.readyState).toBe(MockWebSocket.CLOSED);
  });
});
