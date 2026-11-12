import { createEffect, createSignal, onCleanup } from "solid-js";
import { getBotsState, getCurrentView, subscribe, type BotsState } from "../../state/bots";
import type { BotsView } from "../../types/bots";

/**
 * Same legacy subscriber store, Solid-flavoured: `snapshot()` re-reads the
 * module state on every call and re-evaluates whenever the store notifies.
 */
export function useBotsState(): () => BotsState {
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    const unsubscribe = subscribe(() => setTick((t) => t + 1));
    onCleanup(unsubscribe);
  });
  return () => {
    tick();
    return getBotsState();
  };
}

export function useCurrentView(): () => BotsView {
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    const unsubscribe = subscribe(() => setTick((t) => t + 1));
    onCleanup(unsubscribe);
  });
  return () => {
    tick();
    return getCurrentView();
  };
}
