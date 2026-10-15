// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useReplayClock } from "./useReplayClock";

let rafCbs = new Map<number, FrameRequestCallback>();
let rafId = 0;

beforeEach(() => {
  rafCbs = new Map();
  rafId = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = ++rafId;
    rafCbs.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { rafCbs.delete(id); });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** run every currently-queued frame callback with the given timestamp */
function frame(ts: number) {
  const cbs = [...rafCbs.values()];
  rafCbs.clear();
  for (const cb of cbs) cb(ts);
}

describe("useReplayClock", () => {
  test("seeds at t0, advances at speed, calls onTick, stops at tEnd", () => {
    const onTick = vi.fn();
    const onEnd = vi.fn();
    const { result } = renderHook(() => useReplayClock({
      t0: 1000, tEnd: 1005, playing: true, speed: 1, onTick, onEnd,
    }));

    // seed on first play: clock jumps to t0 and paints
    expect(result.current.clockRef.current).toBe(1000);
    expect(onTick).toHaveBeenCalledWith(1000);

    // first rAF only arms (lazy) — never jumps
    act(() => { frame(1000); });
    expect(onTick).toHaveBeenCalledTimes(1);

    // 100ms per frame at speed 1 => +1s per 10 frames
    let ts = 1100;
    for (let i = 0; i < 10; i++) {
      act(() => { frame(ts); });
      ts += 100;
    }
    expect(result.current.clockRef.current).toBeCloseTo(1001, 5);

    // keep going until tEnd; loop must stop and report end exactly once
    for (let i = 0; i < 60 && !onEnd.mock.calls.length; i++) {
      act(() => { frame(ts); });
      ts += 100;
    }
    expect(result.current.clockRef.current).toBe(1005);
    expect(result.current.clock).toBe(1005);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenLastCalledWith(1005);
    // no frame left armed after stop
    expect(rafCbs.size).toBe(0);
  });

  test("speed multiplier advances proportionally", () => {
    const onTick = vi.fn();
    const onEnd = vi.fn();
    const { result } = renderHook(() => useReplayClock({
      t0: 0, tEnd: 10, playing: true, speed: 10, onTick, onEnd,
    }));

    // t0=0 => no seed paint; first frame arms
    act(() => { frame(0); });
    expect(onTick).not.toHaveBeenCalled();

    // dt=0.1s * 10x = 1s per frame
    act(() => { frame(100); });
    expect(result.current.clockRef.current).toBeCloseTo(1, 5);
    act(() => { frame(200); });
    expect(result.current.clockRef.current).toBeCloseTo(2, 5);
  });

  test("does not run while paused", () => {
    const onTick = vi.fn();
    const onEnd = vi.fn();
    const { result } = renderHook(() => useReplayClock({
      t0: 1000, tEnd: 2000, playing: false, speed: 1, onTick, onEnd,
    }));
    expect(rafCbs.size).toBe(0);
    expect(onTick).not.toHaveBeenCalled();
    expect(result.current.clockRef.current).toBe(0);
  });

  test("guards a falsy tEnd (no loop)", () => {
    const onTick = vi.fn();
    const { result } = renderHook(() => useReplayClock({
      t0: 1000, tEnd: 0, playing: true, speed: 1, onTick, onEnd: vi.fn(),
    }));
    expect(rafCbs.size).toBe(0);
    expect(onTick).not.toHaveBeenCalled();
    expect(result.current.clockRef.current).toBe(0);
  });

  test("jump resets paint cursor and syncs both clock stores", () => {
    const onTick = vi.fn();
    const { result } = renderHook(() => useReplayClock({
      t0: 1000, tEnd: 2000, playing: false, speed: 1, onTick, onEnd: vi.fn(),
    }));

    result.current.lastPaintRef.current = 999;
    act(() => { result.current.jump(1234); });

    expect(result.current.clockRef.current).toBe(1234);
    expect(result.current.clock).toBe(1234);
    expect(result.current.lastPaintRef.current).toBe(0);
    expect(onTick).toHaveBeenLastCalledWith(1234);
  });
});
