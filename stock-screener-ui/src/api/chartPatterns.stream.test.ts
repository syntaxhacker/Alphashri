import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { streamResults, streamWatch } from "./chartPatterns";
import {
  createErrorCapture,
  createStreamCollector,
  errorResponse,
  makePatternHit as makeHit,
  STREAM_META as META,
  sseFrame as frame,
  sseResponse,
} from "./apiTestMocks";

const mockedFetch = vi.mocked(fetchWithAuth);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("streamResults", () => {
  it("GETs /results/stream with the query and emits meta/item/item/done in order", async () => {
    mockedFetch.mockResolvedValue(
      sseResponse([
        frame("meta", META),
        frame("item", makeHit("AAA", 90)),
        frame("item", makeHit("BBB", 70)),
        "event: done\n\n",
      ]),
    );

    const collector = createStreamCollector();
    await streamResults({ universe: "nifty500", timeframe: "1D" }, collector.handlers);

    // Meta shows early: it is the first event, before any item and before done.
    expect(collector.order).toEqual(["meta", "item:AAA", "item:BBB", "done"]);
    expect((collector.getMeta() as typeof META).total).toBe(2);
    expect(collector.items.map((i) => i.symbol)).toEqual(["AAA", "BBB"]);
    expect(collector.isDone()).toBe(true);

    const [url, options] = mockedFetch.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toContain("/api/chart-patterns/results/stream?");
    expect(String(url)).toContain("universe=nifty500");
    // Auth path: fetchWithAuth injects the Authorization header; the stream
    // only adds the SSE accept header (never EventSource).
    expect(options.headers["Accept"]).toBe("text/event-stream");
  });

  it("reassembles frames split across chunk boundaries", async () => {
    const full = frame("meta", META) + frame("item", makeHit("AAA", 90)) + "event: done\n\n";
    // Split mid-JSON (inside the item payload) to prove buffering works.
    const chunks = [full.slice(0, 40), full.slice(40, 90), full.slice(90)];
    mockedFetch.mockResolvedValue(sseResponse(chunks));

    const seen: string[] = [];
    let done = false;
    await streamResults(
      {},
      {
        onMeta: () => seen.push("meta"),
        onItem: (item) => seen.push(String((item as unknown as Record<string, unknown>).symbol)),
        onDone: () => {
          done = true;
        },
        onError: (err) => {
          throw new Error(`must not error: ${err.message}`);
        },
      },
    );
    expect(seen).toEqual(["meta", "AAA"]);
    expect(done).toBe(true);
  });

  it("reports non-OK responses via onError and never throws", async () => {
    mockedFetch.mockResolvedValue(errorResponse(500, { detail: "stream boom" }));
    const capture = createErrorCapture();
    await expect(
      streamResults({}, { onError: capture.onError }),
    ).resolves.toBeUndefined();
    expect(capture.getMessage()).toBe("stream boom");
  });

  it("reports fetch rejections via onError and never throws", async () => {
    mockedFetch.mockRejectedValue(new Error("network down"));
    const capture = createErrorCapture();
    await expect(
      streamResults({}, { onError: capture.onError }),
    ).resolves.toBeUndefined();
    expect(capture.getMessage()).toBe("network down");
  });

  it("treats an `error` event as onError", async () => {
    mockedFetch.mockResolvedValue(sseResponse([frame("error", { message: "backend sad" })]));
    const capture = createErrorCapture();
    let done = false;
    await streamResults(
      {},
      {
        onError: capture.onError,
        onDone: () => {
          done = true;
        },
      },
    );
    expect(capture.getMessage()).toBe("backend sad");
    expect(done).toBe(false);
  });

  it("stays silent on abort (no onError, no onDone) and never throws", async () => {
    mockedFetch.mockResolvedValue(sseResponse([frame("meta", META)]));
    const controller = new AbortController();
    controller.abort();
    let errored = false;
    let done = false;
    await expect(
      streamResults(
        {},
        {
          signal: controller.signal,
          onError: () => {
            errored = true;
          },
          onDone: () => {
            done = true;
          },
        },
      ),
    ).resolves.toBeUndefined();
    expect(errored).toBe(false);
    expect(done).toBe(false);
  });
});

describe("streamWatch", () => {
  it("GETs /watch/stream and emits meta/item/done", async () => {
    mockedFetch.mockResolvedValue(
      sseResponse([
        frame("meta", { setup: "breakout", min_rel_volume: 0.7 }),
        frame("item", { symbol: "AAA", state: "armed" }),
        frame("item", { symbol: "BBB", state: "triggered" }),
        "event: done\n\n",
      ]),
    );

    const collector = createStreamCollector();
    await streamWatch({ setup: "breakout", universe: "nifty500", timeframe: "1D" }, collector.handlers);

    expect(collector.order).toEqual(["meta", "item:AAA", "item:BBB", "done"]);
    expect(collector.getMeta()).toEqual({ setup: "breakout", min_rel_volume: 0.7 });
    expect(collector.isDone()).toBe(true);

    const [url, options] = mockedFetch.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toContain("/api/chart-patterns/watch/stream?");
    expect(String(url)).toContain("setup=breakout");
    expect(options.headers["Accept"]).toBe("text/event-stream");
  });

  it("reports failures via onError and never throws", async () => {
    mockedFetch.mockResolvedValue(errorResponse(500, { detail: "watch stream boom" }));
    const capture = createErrorCapture();
    await expect(
      streamWatch(
        { setup: "breakout", universe: "nifty500", timeframe: "1D" },
        { onError: capture.onError },
      ),
    ).resolves.toBeUndefined();
    expect(capture.getMessage()).toBe("watch stream boom");
  });
});
