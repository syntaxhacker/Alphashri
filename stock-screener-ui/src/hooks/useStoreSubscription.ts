import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";

/**
 * Subscribe to a store for the lifetime of the owner and expose the
 * invalidation counter as an accessor.
 *
 * Solid has no re-render: writing a signal nobody reads does nothing, so the
 * consumer must read `version()` (in JSX, a memo, or an effect) to pick the
 * store's notifications up. Returning the accessor is what makes the
 * subscription observable — and it is a no-op for the callers that ignore it.
 */
export function useStoreSubscription(subscribe: (callback: () => void) => () => void): () => number {
  const [version, setVersion] = createSignal(0);

  createEffect(() => {
    const unsubscribe = subscribe(() => setVersion((n) => n + 1));
    onCleanup(() => unsubscribe());
  });

  return version;
}

/**
 * Reads a store snapshot reactively: returns a memo that re-runs whenever the
 * store notifies (via `subscribe`). Use as `const state = useStoreSnapshot(subscribe, getState)`
 * and read `state()` in JSX / memos so the store's live updates reach the DOM.
 */
export function useStoreSnapshot<T>(
  subscribe: (callback: () => void) => () => void,
  getState: () => T,
): () => T {
  const [, forceUpdate] = createSignal(0);

  createEffect(() => {
    const unsubscribe = subscribe(() => forceUpdate((n) => n + 1));
    onCleanup(() => unsubscribe());
  });

  return createMemo(() => {
    forceUpdate();
    return getState();
  });
}
