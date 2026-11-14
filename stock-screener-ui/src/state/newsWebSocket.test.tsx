// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSignal } from "solid-js";
import { render } from "@solidjs/testing-library";
import type { NewsItem } from "../components/news/news-types";
import { NewsWebSocketProvider, useNewsWebSocket, type NewsWebSocketContextType } from "./newsWebSocket";

const mockNewsItem: NewsItem = {
  id: "1",
  headline: "Test News",
  description: "Test description",
  source: "Test Source",
  sourceUrl: "https://test.com",
  publishedAt: "2025-01-01T00:00:00Z",
  fetchedAt: "2025-01-01T00:00:00Z",
};

function createMockWebSocket() {
  const handlers: Record<string, ((arg?: unknown) => void) | undefined> = {};
  return {
    set onopen(fn: (arg?: unknown) => void) {
      handlers.open = fn;
    },
    set onclose(fn: (arg?: unknown) => void) {
      handlers.close = fn;
    },
    set onmessage(fn: (arg?: unknown) => void) {
      handlers.message = fn;
    },
    set onerror(fn: (arg?: unknown) => void) {
      handlers.error = fn;
    },
    close: vi.fn(),
    send: vi.fn(),
    triggerOpen() {
      handlers.open?.();
    },
    triggerClose(event?: unknown) {
      handlers.close?.(event);
    },
    triggerMessage(data: string) {
      handlers.message?.({ data });
    },
    triggerError(err: unknown) {
      handlers.error?.(err);
    },
  };
}

describe("useNewsWebSocket", () => {
  let mockWsInstance: ReturnType<typeof createMockWebSocket>;
  let wsUrl: string;
  let origWebSocket: typeof WebSocket;
  let wsConstructor: unknown;

  beforeEach(() => {
    vi.stubEnv("WS_BASE", "ws://localhost");
    origWebSocket = global.WebSocket;

    mockWsInstance = createMockWebSocket();
    wsUrl = "";
    const ctor = vi.fn(function (this: unknown, url: string) {
      wsUrl = url;
      return mockWsInstance;
    });

    // @ts-expect-error mocking WebSocket
    global.WebSocket = ctor as unknown;
    wsConstructor = ctor;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.WebSocket = origWebSocket;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  /**
   * Solid has no `renderHook`: mount the provider around a probe that copies
   * the context into a signal the test can read.
   */
  function renderWithWrapper() {
    const [ctx, setCtx] = createSignal<NewsWebSocketContextType | null>(null);
    function Probe() {
      setCtx(useNewsWebSocket());
      return null;
    }
    render(() => (
      <NewsWebSocketProvider>
        <Probe />
      </NewsWebSocketProvider>
    ));
    return {
      get current(): NewsWebSocketContextType {
        const value = ctx();
        if (!value) throw new Error("provider did not mount");
        return value;
      },
    };
  }

  it("provides initial state", () => {
    const { current } = renderWithWrapper();
    expect(current.connected()).toBe(false);
    expect(current.newsItems()).toEqual([]);
    expect(current.hasNewArticles()).toBe(false);
    expect(typeof current.clearNewArticlesFlag).toBe("function");
    expect(typeof current.addNewsItems).toBe("function");
  });

  it("connects to the correct WebSocket URL", () => {
    renderWithWrapper();
    expect(wsUrl).toBe("ws://localhost:8765/ws/news");
  });

  it("sets connected true on open", () => {
    const { current } = renderWithWrapper();
    mockWsInstance.triggerOpen();
    expect(current.connected()).toBe(true);
  });

  it("adds news items on message", () => {
    const { current } = renderWithWrapper();

    const items: NewsItem[] = [
      { ...mockNewsItem, id: "1" },
      { ...mockNewsItem, id: "2" },
    ];

    mockWsInstance.triggerMessage(JSON.stringify({ type: "new_items", items }));

    expect(current.newsItems()).toHaveLength(2);
    expect(current.hasNewArticles()).toBe(true);
  });

  it("deduplicates items by id", () => {
    const { current } = renderWithWrapper();

    const items: NewsItem[] = [{ ...mockNewsItem, id: "1" }];

    mockWsInstance.triggerMessage(JSON.stringify({ type: "new_items", items }));
    mockWsInstance.triggerMessage(JSON.stringify({ type: "new_items", items }));

    expect(current.newsItems()).toHaveLength(1);
  });

  it("limits items to 100", () => {
    const { current } = renderWithWrapper();

    const manyItems = Array.from({ length: 150 }, (_, i) => ({
      ...mockNewsItem,
      id: String(i),
    }));

    mockWsInstance.triggerMessage(JSON.stringify({ type: "new_items", items: manyItems }));

    expect(current.newsItems()).toHaveLength(100);
  });

  it("clearNewsArticlesFlag resets the flag", () => {
    const { current } = renderWithWrapper();
    expect(current.hasNewArticles()).toBe(false);
    current.clearNewArticlesFlag();
    expect(current.hasNewArticles()).toBe(false);
  });

  it("addNewsItems adds items manually", () => {
    const { current } = renderWithWrapper();
    current.addNewsItems([mockNewsItem]);
    expect(current.newsItems()).toHaveLength(1);
  });

  it("sets connected false on close", () => {
    const { current } = renderWithWrapper();

    mockWsInstance.triggerOpen();
    expect(current.connected()).toBe(true);

    mockWsInstance.triggerClose({ code: 1000 });
    expect(current.connected()).toBe(false);
  });

  it("reconnects on abnormal close", async () => {
    vi.useFakeTimers();
    renderWithWrapper();

    mockWsInstance.triggerOpen();
    mockWsInstance.triggerClose({ code: 1001 });

    await vi.runAllTimersAsync();

    expect(wsConstructor as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not reconnect on normal close (code 1000)", () => {
    renderWithWrapper();

    mockWsInstance.triggerOpen();
    mockWsInstance.triggerClose({ code: 1000 });

    expect(wsConstructor as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("handles malformed JSON gracefully", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { current } = renderWithWrapper();

    mockWsInstance.triggerMessage("{not json");

    expect(current.newsItems()).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("swallows a constructor throw and retries", async () => {
    vi.useFakeTimers();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const throwing = vi.fn(function () {
      throw new Error("boom");
    });
    // @ts-expect-error mocking WebSocket
    global.WebSocket = throwing;

    renderWithWrapper();

    await vi.runAllTimersAsync();

    expect(throwing).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
    vi.useRealTimers();
  });
});