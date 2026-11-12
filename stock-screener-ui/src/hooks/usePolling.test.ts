// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { usePolling } from "./usePolling";
import { renderSolidHook } from "../test-utils/solidRenderHook";

function Harness(props: {
  fn: () => void;
  ms: number;
  opts?: Parameters<typeof usePolling>[2];
}) {
  usePolling(props.fn, props.ms, props.opts);
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
    renderSolidHook((props: { fn: () => void; ms: number }) => Harness({ ...props, opts: { immediate: false } }), {
      initialProps: { fn, ms: 1000 },
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does nothing when disabled", async () => {
    const fn = vi.fn();
    renderSolidHook((props: { fn: () => void; ms: number }) => Harness({ ...props, opts: { enabled: false } }), {
      initialProps: { fn, ms: 1000 },
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not poll when ms is 0 or negative", async () => {
    const fn = vi.fn();
    const hook = (props: { fn: () => void; ms: number }) =>
      Harness({ ...props, opts: { immediate: false } });
    renderSolidHook(hook, { initialProps: { fn, ms: 0 } });
    renderSolidHook(hook, { initialProps: { fn, ms: -100 } });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not poll when ms is NaN (e.g. parseInt of an 'off' setting)", async () => {
    const fn = vi.fn();
    renderSolidHook((props: { fn: () => void; ms: number }) => Harness({ ...props, opts: { immediate: false } }), {
      initialProps: { fn, ms: Number.NaN },
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("clears the interval on unmount", async () => {
    const fn = vi.fn();
    const { unmount } = renderSolidHook(
      (props: { fn: () => void; ms: number }) => Harness({ ...props, opts: { immediate: false } }),
      { initialProps: { fn, ms: 1000 } },
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    unmount();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("clears and re-arms the interval when ms changes", async () => {
    const fn = vi.fn();
    // Solid hooks read their props once, so a cadence change is an owner change.
    const { rerender } = renderSolidHook(
      (props: { fn: () => void; ms: number }) => Harness({ ...props, opts: { immediate: false } }),
      { initialProps: { fn, ms: 1000 } },
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    rerender({ fn, ms: 5000 });
    await vi.advanceTimersByTimeAsync(4000);
    // Old 1s cadence was cleared; the 5s cadence has not elapsed yet.
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("fires once immediately when immediate is true", async () => {
    const fn = vi.fn();
    renderSolidHook((props: { fn: () => void; ms: number }) => Harness({ ...props, opts: { immediate: true } }), {
      initialProps: { fn, ms: 1000 },
    });

    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not fire immediately when immediate is false", async () => {
    const fn = vi.fn();
    renderSolidHook((props: { fn: () => void; ms: number }) => Harness({ ...props, opts: { immediate: false } }), {
      initialProps: { fn, ms: 1000 },
    });

    expect(fn).not.toHaveBeenCalled();
  });

  it("skips overlapping async invocations when skipIfRunning is true", async () => {
    let resolve!: () => void;
    const inFlight = new Promise<void>((r) => {
      resolve = r;
    });
    const fn = vi.fn(() => inFlight);

    renderSolidHook((props: { fn: () => void; ms: number }) => Harness({ ...props, opts: { skipIfRunning: true } }), {
      initialProps: { fn, ms: 100 },
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(1);

    // A second tick arrives while the first is still in flight: skipped.
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(1);

    resolve();
    // Once the flight settles, the next tick fires.
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("allows overlapping async invocations when skipIfRunning is false", async () => {
    let resolve!: () => void;
    const inFlight = new Promise<void>((r) => {
      resolve = r;
    });
    const fn = vi.fn(() => inFlight);

    renderSolidHook((props: { fn: () => void; ms: number }) => Harness({ ...props, opts: { skipIfRunning: false } }), {
      initialProps: { fn, ms: 100 },
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(1);

    // A second tick arrives while the first is still in flight: NOT skipped.
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);

    resolve();
  });
});
