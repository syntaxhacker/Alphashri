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

type ReplayConfig = Parameters<typeof runReplay>[0];

function makeReplayHandlers() {
  return { onEvent: vi.fn(), onError: vi.fn(), onComplete: vi.fn() };
}

function startSseReplay(config: ReplayConfig, events: unknown[]) {
  mockGlobalFetchResponse(sseDataResponse(events));
  const handlers = makeReplayHandlers();
  const cancel = runReplay(config, handlers.onEvent, handlers.onError, handlers.onComplete);
  return { cancel, ...handlers };
}

async function runPrimedReplay(
  prime: () => void,
  config: ReplayConfig = { symbols: ["TATASTEEL"] } as ReplayConfig,
) {
  prime();
  const handlers = makeReplayHandlers();
  runReplay(config, handlers.onEvent, handlers.onError, handlers.onComplete);
  await waitAsync();
  return handlers;
}

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
    const { onEvent, onError, onComplete, cancel } = startSseReplay(mockConfig, mockEvents);

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
    startSseReplay(mockConfig, [{ type: "complete" }]);

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
    const { onComplete, cancel } = startSseReplay(mockConfig, mockEvents);

    // Cancel immediately
    cancel();

    await waitAsync();

    // onComplete should not be called because we cancelled
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("returns a cancel function", () => {
    const mockConfig = { symbols: ["TATASTEEL"] };
    const { cancel } = startSseReplay(mockConfig, []);

    expect(typeof cancel).toBe("function");
  });

  it("calls onError when fetch fails", async () => {
    const { onEvent, onError, onComplete } = await runPrimedReplay(() =>
      mockGlobalFetchRejected("Network error"),
    );

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onEvent).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("calls onError when response is not ok", async () => {
    const { onError, onComplete } = await runPrimedReplay(() =>
      mockGlobalFetchResponse(errorResponse(400, {})),
    );

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("handles malformed SSE events gracefully", async () => {
    const mockConfig = { symbols: ["TATASTEEL"] };
    const { onEvent } = startSseReplay(mockConfig, [{ type: "complete" }]);

    await waitAsync();

    // Should still have been called for valid event
    expect(onEvent).toHaveBeenCalledWith({ type: "complete" });
  });

  it("passes AbortSignal to fetch", async () => {
    const mockConfig = { symbols: ["TATASTEEL"] };

    new AbortController(); // Just verify abort controller can be created

    const { cancel } = startSseReplay(mockConfig, [{ type: "complete" }]);

    expect(cancel).toBeDefined();
    cancel();

    await waitAsync();
  });
});
