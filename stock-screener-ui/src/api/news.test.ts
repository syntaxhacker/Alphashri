import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./config", () => ({
  API_BASE: "http://localhost:8765",
  WS_BASE: "ws://localhost:8765",
}));

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { ApiError } from "./apiError";
import {
  fetchNews,
  fetchArticle,
  fetchNewsSources,
  createNewsWebSocket,
  fetchRecentArticles,
  searchArticles,
  mapSymbol,
} from "./news";

const mockedFetch = vi.mocked(fetchWithAuth);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchNews", () => {
  it("builds URL with limit param", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: 1 }] }),
    } as Response);

    await fetchNews(undefined, 10);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/news?limit=10");
  });

  it("appends source param when provided and not 'all'", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    } as Response);

    await fetchNews("reuters", 25);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("source=reuters");
  });

  it("does not append source param when source is 'all'", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    } as Response);

    await fetchNews("all", 25);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("source=");
  });

  it("does not append source when undefined", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    } as Response);

    await fetchNews(undefined);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("source=");
  });

  it("returns items array from response", async () => {
    const items = [
      { id: 1, title: "News 1" },
      { id: 2, title: "News 2" },
    ];
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items }),
    } as Response);

    const result = await fetchNews();

    expect(result).toEqual(items);
  });

  it("returns empty array when items not present", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const result = await fetchNews();

    expect(result).toEqual([]);
  });

  it("throws a typed ApiError (401/unauthorized) on a non-ok response", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: "Session expired" }),
    } as Response);

    const err = await fetchNews().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, kind: "unauthorized", message: "Session expired" });
  });

  it("throws a typed ApiError (network) on transport failure", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const err = await fetchNews().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: "network" });
    expect((err as ApiError).message).toBe("Network error");
  });

  it("rethrows an AbortError unchanged instead of swallowing it", async () => {
    const abort = new DOMException("Aborted", "AbortError");
    mockedFetch.mockRejectedValue(abort);

    await expect(fetchNews()).rejects.toBe(abort);
  });

  it("forwards an AbortSignal to fetchWithAuth when one is supplied", async () => {
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [] }) } as Response);
    const controller = new AbortController();

    await fetchNews(undefined, 25, controller.signal);

    expect(mockedFetch.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });

  it("returns byte-identical success data with a signal supplied", async () => {
    const items = [
      { id: 1, title: "News 1" },
      { id: 2, title: "News 2" },
    ];
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({ items }) } as Response);

    const result = await fetchNews(undefined, 50, new AbortController().signal);

    expect(result).toEqual(items);
  });
});

describe("fetchArticle", () => {
  it("encodes the URL parameter", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ title: "Article", content: "Body" }),
    } as Response);

    await fetchArticle("https://example.com/path?q=test&x=1");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent("https://example.com/path?q=test&x=1"));
  });

  it("returns article data on success", async () => {
    const article = { title: "Test", content: "Content" };
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => article,
    } as Response);

    const result = await fetchArticle("https://example.com");

    expect(result).toEqual(article);
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchArticle("https://example.com");

    expect(result).toBeNull();
  });
});

describe("fetchNewsSources", () => {
  it("returns sources array from response", async () => {
    const sources = [{ id: "reuters", name: "Reuters" }];
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ sources }),
    } as Response);

    const result = await fetchNewsSources();

    expect(result).toEqual(sources);
  });

  it("returns empty array when sources not present", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const result = await fetchNewsSources();

    expect(result).toEqual([]);
  });

  it("returns empty array on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchNewsSources();

    expect(result).toEqual([]);
  });
});

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  url = "";
  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  close() {}
  send() {}
}

describe("createNewsWebSocket", () => {
  let OriginalWebSocket: typeof globalThis.WebSocket;

  beforeEach(() => {
    OriginalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = MockWebSocket as any;
  });

  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
  });

  it("returns null when WebSocket constructor throws", () => {
    globalThis.WebSocket = undefined as any;

    const result = createNewsWebSocket(() => {});

    expect(result).toBeNull();
  });

  it("calls onConnect when connection opens", () => {
    const onConnect = vi.fn();
    const ws = createNewsWebSocket(() => {}, onConnect);

    expect(ws).not.toBeNull();
    expect(onConnect).not.toHaveBeenCalled();

    ws!.onopen?.(new Event("open"));
    expect(onConnect).toHaveBeenCalledOnce();

    ws!.close();
  });

  it("parses and forwards messages via onMessage", () => {
    const onMessage = vi.fn();
    const ws = createNewsWebSocket(onMessage);

    const message = { type: "new_items", items: [{ id: 1 }] };
    ws!.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }));

    expect(onMessage).toHaveBeenCalledWith(message);

    ws!.close();
  });

  it("handles malformed messages gracefully", () => {
    const onMessage = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ws = createNewsWebSocket(onMessage);

    ws!.onmessage?.(new MessageEvent("message", { data: "not json" }));

    expect(onMessage).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
    ws!.close();
  });

  it("calls onDisconnect when connection closes", () => {
    const onDisconnect = vi.fn();
    const ws = createNewsWebSocket(() => {}, undefined, onDisconnect);

    ws!.onclose?.(new Event("close") as CloseEvent);

    expect(onDisconnect).toHaveBeenCalledOnce();
  });
});

describe("fetchRecentArticles", () => {
  it("builds URL with hours and limit params", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ total: 0, articles: [] }),
    } as Response);

    await fetchRecentArticles(48, undefined, 20);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("hours=48");
    expect(calledUrl).toContain("limit=20");
  });

  it("appends source param when provided", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ total: 0, articles: [] }),
    } as Response);

    await fetchRecentArticles(24, "reuters");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("source=reuters");
  });

  it("encodes special characters in source", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ total: 0, articles: [] }),
    } as Response);

    await fetchRecentArticles(24, "test source&more");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent("test source&more"));
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await fetchRecentArticles();

    expect(result).toBeNull();
  });
});

describe("searchArticles", () => {
  it("encodes query parameter", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ query: "test", total: 0, articles: [] }),
    } as Response);

    await searchArticles("market crash 2024");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("q=market%20crash%202024");
  });

  it("includes limit parameter", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ query: "test", total: 0, articles: [] }),
    } as Response);

    await searchArticles("test", 5);

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("limit=5");
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await searchArticles("test");

    expect(result).toBeNull();
  });
});

describe("mapSymbol", () => {
  it("encodes symbol in URL", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ symbol: "TATASTEEL", instrument_key: "key" }),
    } as Response);

    await mapSymbol("TATA STEEL");

    const calledUrl = mockedFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent("TATA STEEL"));
  });

  it("returns null on error", async () => {
    mockedFetch.mockRejectedValue(new Error("Network error"));

    const result = await mapSymbol("BAD");

    expect(result).toBeNull();
  });
});
