import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import { streamResults, streamWatch } from "./chartPatterns";

const mockedFetch = vi.mocked(fetchWithAuth);

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream } as unknown as Response;
}

function errorResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}

function makeHit(symbol: string, confidence: number): Record<string, unknown> {
  return {
    id: confidence,
    symbol,
    timeframe: "1D",
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence,
  };
}

const META = {
  total: 2,
  summary: { scanned: 2, patterns: 2, in_view: 2, confirmed: 2, bullish: 2, bearish: 0, data_through: "2026-09-30" },
  data_through: "2026-09-30",
};

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

    const order: string[] = [];
    const items: Array<Record<string, unknown>> = [];
    let meta: unknown = null;
    let done = false;
    await streamResults(
      { universe: "nifty500", timeframe: "1D" },
      {
        onMeta: (m) => {
          order.push("meta");
          meta = m;
        },
        onItem: (item) => {
          order.push(`item:${(item as unknown as Record<string, unknown>).symbol}`);
          items.push(item as unknown as Record<string, unknown>);
        },
        onDone: () => {
          order.push("done");
          done = true;
        },
        onError: () => {
          throw new Error("must not error");
        },
      },
    );

    // Meta shows early: it is the first event, before any item and before done.
    expect(order).toEqual(["meta", "item:AAA", "item:BBB", "done"]);
    expect((meta as typeof META).total).toBe(2);
    expect(items.map((i) => i.symbol)).toEqual(["AAA", "BBB"]);
    expect(done).toBe(true);

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
    let message: string | null = null;
    await expect(
      streamResults(
        {},
        {
          onError: (err) => {
            message = err.message;
          },
        },
      ),
    ).resolves.toBeUndefined();
    expect(message).toBe("stream boom");
  });

  it("reports fetch rejections via onError and never throws", async () => {
    mockedFetch.mockRejectedValue(new Error("network down"));
    let message: string | null = null;
    await expect(
      streamResults(
        {},
        {
          onError: (err) => {
            message = err.message;
          },
        },
      ),
    ).resolves.toBeUndefined();
    expect(message).toBe("network down");
  });

  it("treats an `error` event as onError", async () => {
    mockedFetch.mockResolvedValue(sseResponse([frame("error", { message: "backend sad" })]));
    let message: string | null = null;
    let done = false;
    await streamResults(
      {},
      {
        onError: (err) => {
          message = err.message;
        },
        onDone: () => {
          done = true;
        },
      },
    );
    expect(message).toBe("backend sad");
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

    const order: string[] = [];
    let meta: unknown = null;
    let done = false;
    await streamWatch(
      { setup: "breakout", universe: "nifty500", timeframe: "1D" },
      {
        onMeta: (m) => {
          order.push("meta");
          meta = m;
        },
        onItem: (item) => {
          order.push(`item:${(item as unknown as Record<string, unknown>).symbol}`);
        },
        onDone: () => {
          order.push("done");
          done = true;
        },
        onError: () => {
          throw new Error("must not error");
        },
      },
    );

    expect(order).toEqual(["meta", "item:AAA", "item:BBB", "done"]);
    expect(meta).toEqual({ setup: "breakout", min_rel_volume: 0.7 });
    expect(done).toBe(true);

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
    let message: string | null = null;
    await expect(
      streamWatch(
        { setup: "breakout", universe: "nifty500", timeframe: "1D" },
        {
          onError: (err) => {
            message = err.message;
          },
        },
      ),
    ).resolves.toBeUndefined();
    expect(message).toBe("watch stream boom");
  });
});
