// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStoreSubscription } from "./useStoreSubscription";

describe("useStoreSubscription", () => {
  it("subscribes on mount and unsubscribes on unmount", () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn().mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useStoreSubscription(subscribe));

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(typeof subscribe.mock.calls[0][0]).toBe("function");

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("triggers re-render when subscription callback fires", () => {
    const unsubscribe = vi.fn();
    let callback: (() => void) | null = null;
    const subscribe = vi.fn().mockImplementation((cb: () => void) => {
      callback = cb;
      return unsubscribe;
    });

    renderHook(() => useStoreSubscription(subscribe));

    expect(callback).not.toBeNull();

    let renderCount = 0;
    renderHook(() => {
      useStoreSubscription(subscribe);
      renderCount++;
    });

    const initialCount = renderCount;

    act(() => {
      callback!();
    });

    expect(renderCount).toBeGreaterThan(initialCount);
  });

  it("handles subscribe function changes", () => {
    const unsub1 = vi.fn();
    const unsub2 = vi.fn();
    const sub1 = vi.fn().mockReturnValue(unsub1);
    const sub2 = vi.fn().mockReturnValue(unsub2);

    const { rerender, unmount } = renderHook(({ sub }) => useStoreSubscription(sub), {
      initialProps: { sub: sub1 },
    });

    expect(sub1).toHaveBeenCalledTimes(1);

    rerender({ sub: sub2 });

    expect(unsub1).toHaveBeenCalledTimes(1);
    expect(sub2).toHaveBeenCalledTimes(1);

    unmount();

    expect(unsub2).toHaveBeenCalledTimes(1);
  });
});
