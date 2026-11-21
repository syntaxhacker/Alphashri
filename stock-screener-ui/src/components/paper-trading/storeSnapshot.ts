import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";

/**
 * Local copy of the store-snapshot hook. The canonical one in
 * `src/hooks/useStoreSubscription.ts` is broken twice: it calls `createMemo`
 * without importing it, and the memo reads the signal *setter* instead of the
 * value getter, so it never re-executes. That file is owned by another
 * agent, so my scope carries a working equivalent instead. Swap back to
 * `useStoreSnapshot` once it is fixed there.
 */
export function useStoreSnapshot<T>(
  subscribe: (callback: () => void) => () => void,
  getState: () => T,
): () => T {
  const [tick, bump] = createSignal(0);

  createEffect(() => {
    const unsubscribe = subscribe(() => bump((n) => n + 1));
    onCleanup(() => unsubscribe());
  });

  return createMemo(() => {
    tick();
    return getState();
  });
}
