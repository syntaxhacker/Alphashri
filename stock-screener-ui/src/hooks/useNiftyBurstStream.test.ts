// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { useNiftyBurstStream, burstWsUrl } from "./useNiftyBurstStream";

vi.mock("@/state/auth", () => ({ getAccessToken: () => "tok123" }));

type Handler = ((ev: never) => void) | null;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: Handler = null;
  onmessage: Handler = null;
  onclose: Handler = null;
  onerror: Handler = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.({} as never);
  }
  receive(payload: unknown) {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.onmessage?.({ data } as never);
  }
}

const REAL_WS = (globalThis as Record<string, unknown>).WebSocket;

beforeEach(() => {
  MockWebSocket.instances = [];
  (globalThis as Record<string, unknown>).WebSocket = MockWebSocket;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  (globalThis as Record<string, unknown>).WebSocket = REAL_WS;
});

const BURST = {
  id: "2026-10-14T14:20:00+05:30-squeeze-call",
  type: "squeeze",
  side: "call",
  t: "2026-10-14T14:20:00+05:30",
  delta: -16461965,
  baseline: 2000000,
  score: 8.2,
  severity: "critical",
  wall: 22750,
  spot: 22597.3,
};

describe("burstWsUrl", () => {
  test("http becomes ws with the token query", () => {
    expect(burstWsUrl("http://localhost:8765", { token: "abc" })).toBe(
      "ws://localhost:8765/ws/nifty/bursts?token=abc",
    );
  });

  test("https becomes wss; absent token means no query string", () => {
    expect(burstWsUrl("https://example.com")).toBe(
      "wss://example.com/ws/nifty/bursts",
    );
  });
});

describe("useNiftyBurstStream", () => {
  test("connects with the token and delivers a burst frame normalized", async () => {
    const onEvent = vi.fn();
    renderHook(() => useNiftyBurstStream(onEvent, true));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain("/ws/nifty/bursts");
    expect(MockWebSocket.instances[0].url).toContain("token=tok123");

    act(() => {
      MockWebSocket.instances[0].receive({ type: "burst", data: BURST });
    });

    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
    const b = onEvent.mock.calls[0][0];
    expect(b.id).toBe("2026-10-14T14:20:00+05:30-squeeze-call");
    expect(b.type).toBe("squeeze");
    expect(b.side).toBe("call");
    expect(b.wall).toBe(22750);
    expect(b.severity).toBe("critical");
  });

  test("a snapshot frame delivers every event in the list", async () => {
    const onEvent = vi.fn();
    renderHook(() => useNiftyBurstStream(onEvent, true));

    act(() => {
      MockWebSocket.instances[0].receive({
        type: "snapshot",
        data: [BURST, { ...BURST, id: "second", side: "put" }],
      });
    });

    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(2));
    expect(onEvent.mock.calls[1][0].id).toBe("second");
    expect(onEvent.mock.calls[1][0].side).toBe("put");
  });

  test("heartbeats are ignored, malformed frames do not kill the stream", async () => {
    const onEvent = vi.fn();
    renderHook(() => useNiftyBurstStream(onEvent, true));
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.receive({ type: "heartbeat" });
      ws.receive("not-json{{{");
      ws.receive({ type: "burst", data: BURST });
      ws.receive({ type: "heartbeat" });
    });

    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
    expect(onEvent.mock.calls[0][0].id).toContain("squeeze-call");
  });

  test("disabled (EOD) never opens a connection", () => {
    renderHook(() => useNiftyBurstStream(vi.fn(), false));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  test("missing WebSocket global does nothing", () => {
    (globalThis as Record<string, unknown>).WebSocket = undefined;
    const onEvent = vi.fn();
    renderHook(() => useNiftyBurstStream(onEvent, true));
    expect(onEvent).not.toHaveBeenCalled();
  });

  test("unmounting closes the socket", async () => {
    const { unmount } = renderHook(() => useNiftyBurstStream(vi.fn(), true));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    unmount();
    expect(MockWebSocket.instances[0].closed).toBe(true);
  });

  test("error followed by close schedules a single reconnect (no socket doubling)", () => {
    // Browsers fire `error` then `close` for one failure. Both handlers ran
    // scheduleReconnect, so the first timer handle was overwritten and a
    // second socket opened — doubling the live streams on every failure.
    vi.useFakeTimers();
    try {
      renderHook(() => useNiftyBurstStream(vi.fn(), true));
      expect(MockWebSocket.instances).toHaveLength(1);
      const ws = MockWebSocket.instances[0];
      act(() => {
        ws.onerror?.({} as never);
        ws.onclose?.({} as never);
      });
      // First backoff is 2s; the overwritten duplicate would fire at 4s and
      // open a third socket — advancing past both must still leave exactly 2.
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(MockWebSocket.instances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
