import { createEffect, createSignal, onCleanup } from "solid-js";
import { getExperimentState, subscribe, type ExperimentsState } from "../../state/experiments";

/**
 * Re-evaluate `getExperimentState()` whenever the legacy subscriber store
 * notifies. Call sites read `state()` inside memos/effects so the snapshot
 * stays live — a destructure at setup would freeze the values forever.
 */
export function useExperimentState(): () => ExperimentsState {
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    const unsubscribe = subscribe(() => setTick((t) => t + 1));
    onCleanup(unsubscribe);
  });
  return () => {
    tick();
    return getExperimentState();
  };
}
