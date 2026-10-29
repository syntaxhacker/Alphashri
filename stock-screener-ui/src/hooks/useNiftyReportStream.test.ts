// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { reportWsUrl, useNiftyReportStream } from "./useNiftyReportStream";

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

function installMockWs() {
  MockWebSocket.instances = [];
  (globalThis as Record<string, unknown>).WebSocket = MockWebSocket;
}

beforeEach(() => {
  installMockWs();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  (globalThis as Record<string, unknown>).WebSocket = REAL_WS;
});

const REPORT_DATA = {
  mode: "live",
  date: "2026-10-12",
  expiry: "2026-10-15",
  spot: 25750.5,
  ohlc: { open: 25600, high: 25800, low: 25550, close: 25750.5 },
  pcrOi: 1.12,
  pcrVol: 0.95,
  maxPain: 25700,
  walls: { calls: [], puts: [] },
  strikes: [],
  timeline: [],
};

describe("reportWsUrl", () => {
  test("http base becomes ws with expiry + token query", () => {
    expect(reportWsUrl("http://localhost:8765", { token: "abc" })).toBe(
      "ws://localhost:8765/ws/nifty/report?token=abc",
    );
    expect(
      reportWsUrl("http://localhost:8765", { expiry: "2026-10-15", token: "abc" }),
    ).toBe("ws://localhost:8765/ws/nifty/report?expiry=2026-10-15&token=abc");
  });

  test("https base becomes wss", () => {
    expect(
      reportWsUrl("https://alphashri-backend.onrender.com", { token: "abc" }),
    ).toBe("wss://alphashri-backend.onrender.com/ws/nifty/report?token=abc");
  });

  test("no opts means no query string; values are URL-encoded", () => {
    expect(reportWsUrl("http://localhost:8765")).toBe(
      "ws://localhost:8765/ws/nifty/report",
    );
    const url = reportWsUrl("http://h", { expiry: "15 OCT 2026", token: "a+b&c" });
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("expiry")).toBe("15 OCT 2026");
    expect(qs.get("token")).toBe("a+b&c");
  });
});

describe("useNiftyReportStream", () => {
  test("a report frame sets the normalized report and open flips connected", async () => {
    const { result } = renderHook(() =>
      useNiftyReportStream({ expiry: undefined, enabled: true }),
    );
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain("/ws/nifty/report");
    expect(MockWebSocket.instances[0].url).toContain("token=tok123");
    expect(result.current.connected).toBe(false);

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.open();
    });
    expect(result.current.connected).toBe(true);

    act(() => {
      ws.receive({ type: "report", data: REPORT_DATA });
    });
    await waitFor(() => expect(result.current.report).not.toBeNull());
    expect(result.current.report?.spot).toBe(25750.5);
    expect(result.current.report?.pcrOi).toBe(1.12);
  });

  test("an aux frame exposes tape and sensex; null sides keep the last good value", async () => {
    const { result } = renderHook(() =>
      useNiftyReportStream({ expiry: undefined, enabled: true }),
    );
    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.open();
    });
    expect(result.current.tape).toBeNull();
    expect(result.current.sensex).toBeNull();

    act(() => {
      ws.receive({
        type: "aux",
        tape: {
          date: "2026-10-12",
          interval_sec: 60,
          baseline_t: "09:15",
          rows: [
            {
              t: "09:16",
              spot: 25750.5,
              call_doi: 100,
              put_doi: 50,
              walls: { call: 25800, put: 25700 },
            },
          ],
        },
        sensex: {
          spot: 74200.25,
          expiry: "2026-10-15",
          pcrOi: 1.05,
          pcrVol: 0.9,
          maxPain: 74200,
          walls: {
            calls: [{ strike: 74500, oi: 1000 }],
            puts: [{ strike: 74000, oi: 1200 }],
          },
          ohlc: { open: 74000, high: 74300, low: 73900, close: 74200.25 },
        },
      });
    });
    await waitFor(() => expect(result.current.tape).not.toBeNull());
    expect(result.current.tape?.date).toBe("2026-10-12");
    expect(result.current.tape?.baseline_t).toBe("09:15");
    expect(result.current.tape?.rows).toHaveLength(1);
    expect(result.current.tape?.rows[0].spot).toBe(25750.5);
    expect(result.current.tape?.rows[0].walls).toEqual({ call: 25800, put: 25700 });
    expect(result.current.sensex?.spot).toBe(74200.25);
    expect(result.current.sensex?.maxPain).toBe(74200);

    // Null sides are "unchanged" — the last good value stays.
    act(() => {
      ws.receive({ type: "aux", tape: null, sensex: null });
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.tape?.rows).toHaveLength(1);
    expect(result.current.sensex?.spot).toBe(74200.25);

    // A partial aux frame updates only the side it carries.
    act(() => {
      ws.receive({
        type: "aux",
        tape: null,
        sensex: {
          spot: 74300,
          expiry: "2026-10-15",
          walls: { calls: [], puts: [] },
          ohlc: { open: 0, high: 0, low: 0, close: 74300 },
        },
      });
    });
    await waitFor(() => expect(result.current.sensex?.spot).toBe(74300));
    expect(result.current.tape?.rows).toHaveLength(1);
  });

  test("heartbeat and malformed frames do not set a report", async () => {
    const { result } = renderHook(() =>
      useNiftyReportStream({ expiry: undefined, enabled: true }),
    );
    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.open();
      ws.receive({ type: "heartbeat", ts: new Date().toISOString() });
      ws.receive("not-json{{{");
      ws.receive({ type: "error", message: "boom" });
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.report).toBeNull();
    expect(result.current.connected).toBe(true);
  });

  test("a tick frame exposes tick.spot without touching the report", async () => {
    const { result } = renderHook(() =>
      useNiftyReportStream({ expiry: undefined, enabled: true }),
    );
    const ws = MockWebSocket.instances[0];
    expect(result.current.tick).toBeNull();

    act(() => {
      ws.open();
      ws.receive({
        type: "tick",
        spot: 23123.5,
        ts: "2026-10-12T10:00:01+05:30",
        change_pct: 0.12,
      });
    });
    await waitFor(() => expect(result.current.tick).not.toBeNull());
    expect(result.current.tick?.spot).toBe(23123.5);
    expect(result.current.tick?.ts).toBe("2026-10-12T10:00:01+05:30");
    expect(result.current.tick?.change_pct).toBe(0.12);
    // Ticks are spot-only — the report snapshot is untouched.
    expect(result.current.report).toBeNull();
  });

  test("disabling the stream clears the last live tick", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useNiftyReportStream({ expiry: undefined, enabled }),
      { initialProps: { enabled: true } },
    );
    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.open();
      ws.receive({
        type: "tick",
        spot: 23123.5,
        ts: "2026-10-12T10:00:01+05:30",
        change_pct: 0.12,
      });
    });
    await waitFor(() => expect(result.current.tick?.spot).toBe(23123.5));

    rerender({ enabled: false });
    await waitFor(() => expect(result.current.tick).toBeNull());
    expect(result.current.connected).toBe(false);
  });

  test("a tick frame with a non-finite spot is ignored", async () => {
    const { result } = renderHook(() =>
      useNiftyReportStream({ expiry: undefined, enabled: true }),
    );
    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.open();
      ws.receive({
        type: "tick",
        spot: 23123.5,
        ts: "2026-10-12T10:00:01+05:30",
        change_pct: null,
      });
    });
    await waitFor(() => expect(result.current.tick?.spot).toBe(23123.5));

    act(() => {
      // Non-finite spots arrive as JSON null (or NaN-ish strings).
      ws.receive({ type: "tick", spot: null, ts: "2026-10-12T10:00:02+05:30", change_pct: null });
      ws.receive({ type: "tick", spot: "oops", ts: null, change_pct: null });
    });
    await new Promise((r) => setTimeout(r, 20));
    // Last good tick stays on screen.
    expect(result.current.tick?.spot).toBe(23123.5);
    expect(result.current.report).toBeNull();
  });

  test("expiry is sent as a query param and a change reconnects", () => {
    const { rerender, unmount } = renderHook(
      ({ expiry }: { expiry?: string }) =>
        useNiftyReportStream({ expiry, enabled: true }),
      { initialProps: { expiry: "2026-10-15" as string | undefined } },
    );
    expect(MockWebSocket.instances[0].url).toContain("expiry=2026-10-15");
    rerender({ expiry: undefined });
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[0].closed).toBe(true);
    expect(MockWebSocket.instances[1].url).not.toContain("expiry=");
    unmount();
    expect(MockWebSocket.instances[1].closed).toBe(true);
  });

  test("disabled never opens a connection", () => {
    renderHook(() => useNiftyReportStream({ expiry: undefined, enabled: false }));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  test("error followed by close schedules a single reconnect (no socket doubling)", () => {
    // Browsers fire `error` then `close` for one failure. Both handlers ran
    // scheduleReconnect, so the first timer handle was overwritten and a
    // second socket opened — doubling the live streams on every failure.
    vi.useFakeTimers();
    try {
      renderHook(() => useNiftyReportStream({ expiry: undefined, enabled: true }));
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

  test("missing WebSocket global stays disconnected without throwing", () => {
    (globalThis as Record<string, unknown>).WebSocket = undefined;
    const { result } = renderHook(() =>
      useNiftyReportStream({ expiry: undefined, enabled: true }),
    );
    expect(result.current.connected).toBe(false);
    expect(result.current.report).toBeNull();
  });
});
