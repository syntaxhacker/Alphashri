import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";

/**
 * Kept for the paper-trading, backtest and replay modules that still import
 * from this path. Their tests stub the shared hook module with only
 * `useStoreSubscription`, so a re-export would leave `useStoreSnapshot`
 * undefined there. Behaviour matches the shared hook exactly; once those
 * imports and their mocks move to `@/hooks/useStoreSubscription`, this file
 * can be deleted.
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
