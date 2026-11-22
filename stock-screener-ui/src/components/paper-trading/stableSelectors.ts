import { createMemo } from "solid-js";

/**
 * `useStoreSnapshot` re-emits the whole snapshot object on every live-price
 * tick. A memo that reads `state()` therefore re-runs even when the fields it
 * derives from did not change, producing a fresh array and forcing downstream
 * tables to re-filter, re-sort and rebuild every row. Compare only the inputs
 * the derivation actually reads; dependents then stay untouched on unrelated
 * ticks while still updating the moment one of those inputs changes.
 */
export function createNarrowMemo<Inputs extends readonly unknown[], Result>(
  select: () => Inputs,
  compute: (inputs: Inputs) => Result,
): () => Result {
  const inputs = createMemo<Inputs | undefined, undefined>(
    select,
    undefined,
    {
      equals: (a, b) =>
        !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]),
    },
  );

  return createMemo(() => compute(inputs() as Inputs));
}
