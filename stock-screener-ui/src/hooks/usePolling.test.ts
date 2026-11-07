// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePolling } from "./usePolling";

function Harness({
  fn,
  ms,
  opts,
}: {
  fn: () => void;
  ms: number;
  opts?: Parameters<typeof usePolling>[2];
}) {
  usePolling(fn, ms, opts);
  return null;
}

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the callback at the requested interval", async () => {
    const fn = vi.fn();
    renderHook(() => Harness({ fn, ms: 1000, opts: { immediate: false } }));

    await act(async () => {
      vi.advanceTimersByTimeAsync(1000);
    });
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTimeAsync(1000);
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does nothing when disabled", async () => {
    const fn = vi.fn();
    renderHook(() => Harness({ fn, ms: 1000, opts: { enabled: false } }));

    await act(async () => {
      vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not poll when ms is 0 or negative", async () => {
    const fn = vi.fn();
    renderHook(() => Harness({ fn, ms: 0, opts: { immediate: false } }));
    renderHook(() => Harness({ fn, ms: -100, opts: { immediate: false } }));

    await act(async () => {
      vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not poll when ms is NaN (e.g. parseInt of an 'off' setting)", async () => {
    const fn = vi.fn();
    renderHook(() => Harness({ fn, ms: Number.NaN, opts: { immediate: false } }));

    await act(async () => {
      vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("clears the interval on unmount", async () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() =>
      Harness({ fn, ms: 1000, opts: { immediate: false } }),
    );

    await act(async () => {
      vi.advanceTimersByTimeAsync(1000);
    });
    expect(fn).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("clears and re-arms the interval when ms changes", async () => {
    const fn = vi.fn();
    const { rerender } = renderHook(
      ({ ms }) => Harness({ fn, ms, opts: { immediate: false } }),
      { initialProps: { ms: 1000 } },
    );

    await act(async () => {
      vi.advanceTimersByTimeAsync(1000);
    });
    expect(fn).toHaveBeenCalledTimes(1);

    rerender({ ms: 5000 });
    await act(async () => {
      vi.advanceTimersByTimeAsync(4000);
    });
    // Old 1s cadence was cleared; the 5s cadence has not elapsed yet.
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTimeAsync(1000);
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("fires once immediately when immediate is true", async () => {
    const fn = vi.fn();
    renderHook(() => Harness({ fn, ms: 1000, opts: { immediate: true } }));

    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTimeAsync(1000);
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not fire immediately when immediate is false", async () => {
    const fn = vi.fn();
    renderHook(() => Harness({ fn, ms: 1000, opts: { immediate: false } }));

    expect(fn).not.toHaveBeenCalled();
  });

  it("skips overlapping async invocations when skipIfRunning is true", async () => {
    let resolve!: () => void;
    const inFlight = new Promise<void>((r) => {
      resolve = r;
    });
    const fn = vi.fn(() => inFlight);

    renderHook(() => Harness({ fn, ms: 100, opts: { skipIfRunning: true } }));

    await act(async () => {
      vi.advanceTimersByTimeAsync(100);
    });
    expect(fn).toHaveBeenCalledTimes(1);

    // A second tick arrives while the first is still in flight: skipped.
    await act(async () => {
      vi.advanceTimersByTimeAsync(100);
    });
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve();
    });
    // Once the flight settles, the next tick fires.
    await act(async () => {
      vi.advanceTimersByTimeAsync(100);
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("allows overlapping async invocations when skipIfRunning is false", async () => {
    let resolve!: () => void;
    const inFlight = new Promise<void>((r) => {
      resolve = r;
    });
    const fn = vi.fn(() => inFlight);

    renderHook(() => Harness({ fn, ms: 100, opts: { skipIfRunning: false } }));

    await act(async () => {
      vi.advanceTimersByTimeAsync(100);
    });
    expect(fn).toHaveBeenCalledTimes(1);

    // A second tick arrives while the first is still in flight: NOT skipped.
    await act(async () => {
      vi.advanceTimersByTimeAsync(100);
    });
    expect(fn).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolve();
    });
  });
});
