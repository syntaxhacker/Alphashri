import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";

export function useStoreSubscription(subscribe: (callback: () => void) => () => void): void {
  const [, forceUpdate] = createSignal(0);

  createEffect(() => {
    const unsubscribe = subscribe(() => forceUpdate((n) => n + 1));
    onCleanup(() => unsubscribe());
  });
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
