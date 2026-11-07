import { describe, it, expect } from "vitest";
import { iterateSse, readSseStream, type SseFrame } from "./sse";

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream } as unknown as Response;
}

async function collect(gen: AsyncGenerator<SseFrame>): Promise<SseFrame[]> {
  const out: SseFrame[] = [];
  for await (const frame of gen) {
    out.push(frame);
  }
  return out;
}

describe("iterateSse", () => {
  it("yields a single event", async () => {
    const frames = await collect(
      iterateSse(sseResponse([`event: price\ndata: {"ltp": 100}\n\n`])),
    );
    expect(frames).toEqual([{ event: "price", data: '{"ltp": 100}' }]);
  });

  it("joins multi-line data with \\n", async () => {
    const frames = await collect(
      iterateSse(sseResponse([`data: line one\ndata: line two\n\n`])),
    );
    expect(frames).toEqual([{ event: "message", data: "line one\nline two" }]);
  });

  it("yields an event without data", async () => {
    const frames = await collect(iterateSse(sseResponse([`event: done\n\n`])));
    expect(frames).toEqual([{ event: "done", data: "" }]);
  });

  it("defaults the event name to message for data-only frames", async () => {
    const frames = await collect(iterateSse(sseResponse([`data: 42\n\n`])));
    expect(frames).toEqual([{ event: "message", data: "42" }]);
  });

  it("parses two events in one chunk", async () => {
    const frames = await collect(
      iterateSse(sseResponse([`event: a\ndata: 1\n\nevent: b\ndata: 2\n\n`])),
    );
    expect(frames).toEqual([
      { event: "a", data: "1" },
      { event: "b", data: "2" },
    ]);
  });

  it("reassembles an event split across chunks", async () => {
    const frames = await collect(
      iterateSse(sseResponse([`event: progress\ndata: {"p`, `ercy": 50}\n\n`])),
    );
    expect(frames).toEqual([{ event: "progress", data: '{"percy": 50}' }]);
  });

  it("flushes the trailing buffer when the stream ends without a blank line", async () => {
    const frames = await collect(
      iterateSse(sseResponse([`event: price\ndata: 100`])),
    );
    expect(frames).toEqual([{ event: "price", data: "100" }]);
  });

  it("ignores comment lines", async () => {
    const frames = await collect(
      iterateSse(sseResponse([`: this is a comment\n: another\nevent: price\ndata: 42\n\n`])),
    );
    expect(frames).toEqual([{ event: "price", data: "42" }]);
  });

  it("yields a frame immediately followed by [DONE]", async () => {
    const frames = await collect(
      iterateSse(sseResponse([`data: ok\n\ndata: [DONE]\n\n`])),
    );
    expect(frames).toEqual([
      { event: "message", data: "ok" },
      { event: "message", data: "[DONE]" },
    ]);
  });

  it("resolves silently when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const frames = await collect(
      iterateSse(sseResponse([`event: price\ndata: 1\n\n`]), {
        signal: controller.signal,
      }),
    );
    expect(frames).toEqual([]);
  });
});

describe("readSseStream", () => {
  it("dispatches frames to onFrame in order", async () => {
    const received: SseFrame[] = [];
    await readSseStream(
      sseResponse([`event: price\ndata: 100\n\nevent: done\n\n`]),
      (f) => received.push(f),
    );
    expect(received).toEqual([
      { event: "price", data: "100" },
      { event: "done", data: "" },
    ]);
  });
});
