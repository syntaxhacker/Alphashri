// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { useNiftyBurstStream } from "./useNiftyBurstStream";

vi.mock("@/state/auth", () => ({ fetchWithAuth: vi.fn() }));

import { fetchWithAuth } from "@/state/auth";

/** A Response-ish object whose body streams the given SSE frames. */
function sseResponse(frames: string[], { ok = true, status = 200 } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return { ok, status, body } as unknown as Response;
}

const BURST_FRAME =
  'data: {"id":"2026-10-14T14:20:00+05:30-squeeze-call","type":"squeeze","side":"call",' +
  '"t":"2026-10-14T14:20:00+05:30","delta":-16461965,"baseline":2000000,"score":8.2,' +
  '"severity":"critical","wall":22750,"spot":22597.3}\n\n';

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("useNiftyBurstStream", () => {
  test("delivers a normalized burst from an SSE data frame", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(sseResponse([": connected\n\n", BURST_FRAME]));
    const onEvent = vi.fn();

    renderHook(() => useNiftyBurstStream(onEvent, true));

    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
    const b = onEvent.mock.calls[0][0];
    expect(b.id).toBe("2026-10-14T14:20:00+05:30-squeeze-call");
    expect(b.type).toBe("squeeze");
    expect(b.side).toBe("call");
    expect(b.wall).toBe(22750);
    expect(b.severity).toBe("critical");
  });

  test("comments/heartbeats are ignored, malformed frames do not kill the stream", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      sseResponse([": heartbeat\n\n", "data: {not json\n\n", BURST_FRAME, ": heartbeat\n\n"]),
    );
    const onEvent = vi.fn();
    renderHook(() => useNiftyBurstStream(onEvent, true));
    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
    expect(onEvent.mock.calls[0][0].id).toContain("squeeze-call");
  });

  test("frames split across chunks are reassembled", async () => {
    const half = Math.floor(BURST_FRAME.length / 2);
    vi.mocked(fetchWithAuth).mockResolvedValue(
      sseResponse([BURST_FRAME.slice(0, half), BURST_FRAME.slice(half)]),
    );
    const onEvent = vi.fn();
    renderHook(() => useNiftyBurstStream(onEvent, true));
    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
  });

  test("disabled (EOD) never opens a connection", () => {
    renderHook(() => useNiftyBurstStream(vi.fn(), false));
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  test("a non-ok response does not deliver anything", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(sseResponse([], { ok: false, status: 401 }));
    const onEvent = vi.fn();
    renderHook(() => useNiftyBurstStream(onEvent, true));
    await new Promise((r) => setTimeout(r, 30));
    expect(onEvent).not.toHaveBeenCalled();
  });

  test("unmounting aborts the request", async () => {
    let seenSignal: AbortSignal | undefined;
    vi.mocked(fetchWithAuth).mockImplementation(async (_u: string, init?: RequestInit) => {
      seenSignal = init?.signal as AbortSignal;
      return sseResponse([BURST_FRAME]);
    });
    const { unmount } = renderHook(() => useNiftyBurstStream(vi.fn(), true));
    await waitFor(() => expect(seenSignal).toBeDefined());
    unmount();
    expect(seenSignal?.aborted).toBe(true);
  });
});
