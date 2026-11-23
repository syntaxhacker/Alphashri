// @vitest-environment happy-dom
import { cleanup, renderHook } from "@solidjs/testing-library";
import { createEffect, createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installMockWs, MockWebSocket, uninstallMockWs } from "./reportTestFixtures";
import { reportWsUrl, setLiveTick, useNiftyReportStream, useNiftySpotTick } from "./niftyStreamSolid";

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  installMockWs();
  setLiveTick(null);
});

afterEach(() => {
  cleanup();
  uninstallMockWs();
  vi.useRealTimers();
});

describe("niftyStreamSolid reactivity", () => {
  test("reportWsUrl keeps the existing wire contract", () => {
    expect(reportWsUrl("https://example.com", { expiry: "nearest", token: "t" })).toBe(
      "wss://example.com/ws/nifty/report?expiry=nearest&token=t",
    );
  });

  test("one aux frame commits tape + sensex in a single downstream run", async () => {
    const { result } = renderHook(() => useNiftyReportStream({ enabled: true }));
    await flush();
    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];

    let runs = 0;
    let lastTape: unknown;
    let lastSensex: unknown;
    const dispose = createRoot((disposeRoot) => {
      createEffect(() => {
        lastTape = result.tape();
        lastSensex = result.sensex();
        runs += 1;
      });
      return disposeRoot;
    });
    await flush();
    const baseline = runs;

    ws.receive({
      type: "aux",
      tape: { date: "2026-01-01", rows: [] },
      sensex: { spot: 81_000 },
    });
    await flush();

    // Two independent signals are written per aux frame. Without batching the
    // observer runs twice (once per signal); one batch means one commit.
    expect(runs - baseline).toBe(1);
    expect(lastTape).not.toBeNull();
    expect(lastSensex).not.toBeNull();
    dispose();
  });

  test("a live tick fans out to all subscribers in one commit", async () => {
    const a = renderHook(() => useNiftySpotTick()).result;
    const b = renderHook(() => useNiftySpotTick()).result;
    await flush();

    let runs = 0;
    const seen: Array<{ a: number | null; b: number | null }> = [];
    const dispose = createRoot((disposeRoot) => {
      createEffect(() => {
        const av = a()?.spot ?? null;
        const bv = b()?.spot ?? null;
        runs += 1;
        seen.push({ a: av, b: bv });
      });
      return disposeRoot;
    });
    await flush();
    const baseline = runs;

    setLiveTick({ spot: 25_000, ts: "2026-01-01T09:15:00+05:30", change_pct: 0.5 });
    await flush();

    expect(runs - baseline).toBe(1);
    expect(seen[seen.length - 1]).toEqual({ a: 25_000, b: 25_000 });
    dispose();
  });

  test("an aux payload identical to the last one is skipped entirely", async () => {
    const { result } = renderHook(() => useNiftyReportStream({ enabled: true }));
    await flush();
    const ws = MockWebSocket.instances[0];
    const tape = { date: "2026-01-01", rows: [] };

    ws.receive({ type: "aux", tape });
    await flush();
    const first = result.tape();
    expect(first).not.toBeNull();

    ws.receive({ type: "aux", tape });
    await flush();
    expect(result.tape()).toBe(first);
  });

  test("a disabled stream opens no socket and exposes null data", async () => {
    const { result } = renderHook(() => useNiftyReportStream({ enabled: false }));
    await flush();
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(result.report()).toBeNull();
    expect(result.tape()).toBeNull();
    expect(result.sensex()).toBeNull();
    expect(result.connected()).toBe(false);
  });
});
