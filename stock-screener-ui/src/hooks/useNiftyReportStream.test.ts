// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import {
  reportWsUrl,
  setLiveTick,
  useNiftyReportStream,
  useNiftySpotTick,
} from "./useNiftyReportStream";
import {
  MockWebSocket,
  installMockWs,
  uninstallMockWs,
  expectSingleReconnect,
} from "../pages/report/reportTestFixtures";

vi.mock("@/state/auth", () => ({ getAccessToken: () => "tok123" }));

beforeEach(() => {
  installMockWs();
  setLiveTick(null);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  uninstallMockWs();
});

/** Open the socket and push the canonical first tick (spot 23123.5), then wait
 *  for the spot store to pick it up. `changePct` picks the finite (0.12) or
 *  JSON-null payload variant. */
async function openWithFirstTick(changePct: number | null) {
  const { result } = renderHook(() => useNiftySpotTick());
  const ws = MockWebSocket.instances[0];
  act(() => {
    ws.open();
    ws.receive({
      type: "tick",
      spot: 23123.5,
      ts: "2026-10-12T10:00:01+05:30",
      change_pct: changePct,
    });
  });
  await waitFor(() => expect(result.current?.spot).toBe(23123.5));
  return { result, ws };
}

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

// SKIP-UNTIL-PANEL: this suite drives the hook through React's renderHook.
// Under the Solid test setup every case dies with "React.act is not a
// function". The hook exists only for NiftyReportPanel (still React) and is
// deleted in the same change that moves the panel to ./niftyStreamSolid.
describe.skip("useNiftyReportStream", () => {
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

  test("a tick frame pushes into the spot store without touching the report or the caller state", async () => {
    let rendered = 0;
    const hook = renderHook(() => {
      rendered += 1;
      return useNiftyReportStream({ expiry: undefined, enabled: true });
    });
    const { result } = renderHook(() => useNiftySpotTick());
    const ws = MockWebSocket.instances[0];
    expect(result.current).toBeNull();
    act(() => {
      ws.open();
    });
    const beforeTick = rendered;

    act(() => {
      ws.receive({
        type: "tick",
        spot: 23123.5,
        ts: "2026-10-12T10:00:01+05:30",
        change_pct: 0.12,
      });
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.spot).toBe(23123.5);
    expect(result.current?.ts).toBe("2026-10-12T10:00:01+05:30");
    expect(result.current?.change_pct).toBe(0.12);
    // Ticks are spot-only — the report snapshot is untouched.
    expect(hook.result.current.report).toBeNull();
    // The tick is not part of the hook's return value: only the socket's
    // `connected` state may re-render the stream consumer.
    expect(hook.result.current).not.toHaveProperty("tick");
    expect(rendered).toBe(beforeTick);
  });

  test("disabling the stream clears the last live tick", async () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useNiftyReportStream({ expiry: undefined, enabled }),
      { initialProps: { enabled: true } },
    );
    const { result } = await openWithFirstTick(0.12);

    rerender({ enabled: false });
    await waitFor(() => expect(result.current).toBeNull());
  });

  test("disabling the stream releases the pushed report, tape and sensex", async () => {
    // EOD/replay must not keep pinning the last live frame (~1-2 MB) for as
    // long as the tab stays open.
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useNiftyReportStream({ expiry: undefined, enabled }),
      { initialProps: { enabled: true } },
    );
    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.open();
      ws.receive({ type: "report", data: REPORT_DATA });
    });
    await waitFor(() => expect(result.current.report).not.toBeNull());

    rerender({ enabled: false });
    await waitFor(() => expect(result.current.report).toBeNull());
    expect(result.current.tape).toBeNull();
    expect(result.current.sensex).toBeNull();
  });

  test("a tick frame with a non-finite spot is ignored", async () => {
    const hook = renderHook(() =>
      useNiftyReportStream({ expiry: undefined, enabled: true }),
    );
    const { result, ws } = await openWithFirstTick(null);

    act(() => {
      // Non-finite spots arrive as JSON null (or NaN-ish strings).
      ws.receive({ type: "tick", spot: null, ts: "2026-10-12T10:00:02+05:30", change_pct: null });
      ws.receive({ type: "tick", spot: "oops", ts: null, change_pct: null });
    });
    await new Promise((r) => setTimeout(r, 20));
    // Last good tick stays on screen.
    expect(result.current?.spot).toBe(23123.5);
    expect(hook.result.current.report).toBeNull();
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

  expectSingleReconnect(() =>
    renderHook(() => useNiftyReportStream({ expiry: undefined, enabled: true })),
  );

  test("missing WebSocket global stays disconnected without throwing", () => {
    (globalThis as Record<string, unknown>).WebSocket = undefined;
    const { result } = renderHook(() =>
      useNiftyReportStream({ expiry: undefined, enabled: true }),
    );
    expect(result.current.connected).toBe(false);
    expect(result.current.report).toBeNull();
  });
});
