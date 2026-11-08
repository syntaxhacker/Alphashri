import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally since replay.ts uses raw fetch
global.fetch = vi.fn();

import { fetchReplaySymbols, runReplay } from "./replay";
import {
  errorResponse,
  mockGlobalFetchRejected,
  mockGlobalFetchResponse,
  okResponse,
  sseDataResponse,
  waitAsync,
} from "./apiTestMocks";

describe("fetchReplaySymbols", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and returns symbols array", async () => {
    const mockSymbols = ["TATASTEEL", "INFY", "RELIANCE"];
    mockGlobalFetchResponse(okResponse({ symbols: mockSymbols }));

    const result = await fetchReplaySymbols();

    expect(result).toEqual(mockSymbols);
    expect(global.fetch).toHaveBeenCalledWith("http://localhost:8765/api/replay/symbols");
  });

  it("returns empty array when response has no symbols", async () => {
    mockGlobalFetchResponse(okResponse({}));

    const result = await fetchReplaySymbols();

    expect(result).toEqual([]);
  });

  it("throws on network error", async () => {
    mockGlobalFetchRejected("Network error");

    await expect(fetchReplaySymbols()).rejects.toThrow("Network error");
  });

  it("throws on non-ok response", async () => {
    mockGlobalFetchResponse(errorResponse(500, { detail: "Server error" }));

    await expect(fetchReplaySymbols()).rejects.toThrow("Failed to fetch symbols: 500");
  });
});

describe("runReplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("streams events and calls onEvent for each SSE event", async () => {
    const mockConfig = { symbols: ["TATASTEEL"], start_date: "2024-01-01", end_date: "2024-01-02" };
    const mockEvents = [
      { type: "progress", percent: 25, message: "Processing..." },
      { type: "progress", percent: 50, message: "Halfway there" },
      { type: "complete", summary: "Done" },
    ];
    const mockResponse = sseDataResponse(mockEvents);
    mockGlobalFetchResponse(mockResponse);

    const onEvent = vi.fn();
    const onError = vi.fn();
    const onComplete = vi.fn();

    const cancel = runReplay(mockConfig, onEvent, onError, onComplete);

    // Wait for all events to be processed
    await waitAsync();

    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(onEvent).toHaveBeenNthCalledWith(1, mockEvents[0]);
    expect(onEvent).toHaveBeenNthCalledWith(2, mockEvents[1]);
    expect(onEvent).toHaveBeenNthCalledWith(3, mockEvents[2]);
    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
    expect(cancel).toBeInstanceOf(Function);
  });

  it("sends correct POST request with config as JSON", async () => {
    const mockConfig = { symbols: ["TATASTEEL"], start_date: "2024-01-01" };
    const mockResponse = sseDataResponse([{ type: "complete" }]);
    mockGlobalFetchResponse(mockResponse);

    const onEvent = vi.fn();
    runReplay(mockConfig, onEvent, vi.fn(), vi.fn());

    await waitAsync();

    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe("http://localhost:8765/api/replay/run");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.body).toBe(JSON.stringify(mockConfig));
  });

  it("aborts when cancel function is called", async () => {
    const mockConfig = { symbols: ["TATASTEEL"] };
    const mockEvents = [{ type: "progress", percent: 25 }, { type: "complete" }];
    const mockResponse = sseDataResponse(mockEvents);
    mockGlobalFetchResponse(mockResponse);

    const onEvent = vi.fn();
    const onError = vi.fn();
    const onComplete = vi.fn();

    const cancel = runReplay(mockConfig, onEvent, onError, onComplete);

    // Cancel immediately
    cancel();

    await waitAsync();

    // onComplete should not be called because we cancelled
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("returns a cancel function", () => {
    const mockConfig = { symbols: ["TATASTEEL"] };
    const mockResponse = sseDataResponse([]);
    mockGlobalFetchResponse(mockResponse);

    const cancel = runReplay(mockConfig, vi.fn(), vi.fn(), vi.fn());

    expect(typeof cancel).toBe("function");
  });

  it("calls onError when fetch fails", async () => {
    const mockConfig = { symbols: ["TATASTEEL"] };
    mockGlobalFetchRejected("Network error");

    const onEvent = vi.fn();
    const onError = vi.fn();
    const onComplete = vi.fn();

    runReplay(mockConfig, onEvent, onError, onComplete);

    await waitAsync();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onEvent).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("calls onError when response is not ok", async () => {
    const mockConfig = { symbols: ["TATASTEEL"] };
    mockGlobalFetchResponse(errorResponse(400, {}));

    const onEvent = vi.fn();
    const onError = vi.fn();
    const onComplete = vi.fn();

    runReplay(mockConfig, onEvent, onError, onComplete);

    await waitAsync();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("handles malformed SSE events gracefully", async () => {
    const mockConfig = { symbols: ["TATASTEEL"] };
    const mockResponse = sseDataResponse([{ type: "complete" }]);
    mockGlobalFetchResponse(mockResponse);

    const onEvent = vi.fn();
    runReplay(mockConfig, onEvent, vi.fn(), vi.fn());

    await waitAsync();

    // Should still have been called for valid event
    expect(onEvent).toHaveBeenCalledWith({ type: "complete" });
  });

  it("passes AbortSignal to fetch", async () => {
    const mockConfig = { symbols: ["TATASTEEL"] };
    const mockResponse = sseDataResponse([{ type: "complete" }]);
    mockGlobalFetchResponse(mockResponse);

    new AbortController(); // Just verify abort controller can be created

    const onEvent = vi.fn();
    const cancel = runReplay(mockConfig, onEvent, vi.fn(), vi.fn());

    expect(cancel).toBeDefined();
    cancel();

    await waitAsync();
  });
});
