// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { useStoreSubscription } from "./useStoreSubscription";
import { renderSolidHook } from "../test-utils/solidRenderHook";

afterEach(() => {
  vi.clearAllMocks();
});

describe("useStoreSubscription", () => {
  it("subscribes on mount and unsubscribes on unmount", () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn().mockReturnValue(unsubscribe);

    const { unmount } = renderSolidHook(() => useStoreSubscription(subscribe));

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

    // The hook returns the invalidation counter; reading it is what a Solid
    // component/memo does to pick up the store's notifications.
    const { result } = renderSolidHook(() => useStoreSubscription(subscribe));

    expect(callback).not.toBeNull();

    const initialCount = result.current();

    callback!();

    expect(result.current()).toBeGreaterThan(initialCount);
  });

  it("handles subscribe function changes", () => {
    const unsub1 = vi.fn();
    const unsub2 = vi.fn();
    const sub1 = vi.fn().mockReturnValue(unsub1);
    const sub2 = vi.fn().mockReturnValue(unsub2);

    // A different subscribe function is an owner change: the old subscription
    // is cleaned up and the new one is established.
    const { rerender, unmount } = renderSolidHook(
      (props: { sub: (cb: () => void) => () => void }) => useStoreSubscription(props.sub),
      { initialProps: { sub: sub1 } },
    );

    expect(sub1).toHaveBeenCalledTimes(1);

    rerender({ sub: sub2 });

    expect(unsub1).toHaveBeenCalledTimes(1);
    expect(sub2).toHaveBeenCalledTimes(1);

    unmount();

    expect(unsub2).toHaveBeenCalledTimes(1);
  });
});
