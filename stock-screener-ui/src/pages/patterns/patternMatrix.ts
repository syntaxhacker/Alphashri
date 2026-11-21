/**
 * patternMatrix.ts — Solid port of src/hooks/usePatternMatrix.ts.
 *
 * Fetches the symbol×timeframe matrix projection used by the results view.
 * 120ms debounce matches the React original so fast keystrokes don't trigger
 * a fetch per keystroke.
 */

import { createEffect, createSignal, onCleanup } from "solid-js";
import { fetchPatternMatrix } from "@/api/chartPatterns";
import type { PatternMatrixResponse } from "@/types/chartPatterns";

export function usePatternMatrix(
  universe: () => string,
  enabled: () => boolean,
  refreshKey: () => string | null,
  timeframes: () => string[],
) {
  const [data, setData] = createSignal<PatternMatrixResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [nonce, setNonce] = createSignal(0);
  let token = 0;
  const reload = () => setNonce((n) => n + 1);

  createEffect(() => {
    const u = universe();
    const en = enabled();
    nonce(); // subscribe to manual reloads
    // refreshKey is tracked so a completed scan re-fetches the matrix.
    const _key = refreshKey();
    const ids = timeframes().join(",");
    if (!en || !u) return;
    const myToken = ++token;
    setLoading(true);
    setError(null);
    const idsList = ids ? ids.split(",") : [];
    const timer = window.setTimeout(() => {
      fetchPatternMatrix(u, { limit: 1000, timeframes: idsList })
        .then((response) => {
          if (token !== myToken) return;
          setData(response);
        })
        .catch((err: unknown) => {
          if (token !== myToken) return;
          setError(err instanceof Error ? err.message : "Failed to load pattern matrix");
        })
        .finally(() => {
          if (token !== myToken) return;
          setLoading(false);
        });
    }, 120);
    onCleanup(() => window.clearTimeout(timer));
  });

  return { data, loading, error, reload };
}
