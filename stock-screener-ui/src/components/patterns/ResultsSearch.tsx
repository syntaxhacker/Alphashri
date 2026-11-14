import { createEffect, createSignal, onCleanup } from "solid-js";
import { TextInput } from "@/ui";
import { IconSearch } from "@/patterns/icons";
import type { PatternFilters } from "@/types/chartPatterns";

/**
 * `PatternFilters.q` is added by the symbols/q filter feature. Read it
 * defensively so this control also works against older filter payloads.
 */
type FiltersWithQuery = PatternFilters & { q?: string };

export interface ResultsSearchProps {
  filters: PatternFilters;
  setFilter: (key: string, value: any) => void;
}

/** Read the free-text results query from a filter payload. */
export function readResultsQuery(filters: PatternFilters): string {
  const q = (filters as FiltersWithQuery).q;
  return typeof q === "string" ? q : "";
}

/**
 * Compact client-side text filter over the currently loaded results. Commits a
 * debounced `filters.q` so typing does not spam the results endpoint.
 */
export function ResultsSearch(props: ResultsSearchProps) {
  const external = () => readResultsQuery(props.filters);
  const [value, setValue] = createSignal(external());
  const [debounced, setDebounced] = createSignal(external());
  let debounceTimer: number | undefined;

  createEffect(() => {
    const v = value();
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => setDebounced(v), 300);
    onCleanup(() => window.clearTimeout(debounceTimer));
  });

  // Keep the input in sync when filters change elsewhere (reset, presets), but
  // ignore the echo of our own debounced commit: syncing that back would clobber
  // any characters typed after the commit landed.
  let lastCommitted: string | null = null;
  createEffect(() => {
    const ext = external();
    if (ext === lastCommitted) return;
    setValue(ext);
  });

  let committedOnce = false;
  createEffect(() => {
    const dv = debounced();
    // Skip the mount run: initial value is not a user edit.
    if (!committedOnce) {
      committedOnce = true;
      return;
    }
    // No-op guard: never re-commit an unchanged query (avoids redundant reloads).
    if (dv === external()) return;
    lastCommitted = dv;
    props.setFilter("q", dv);
  });

  return (
    <TextInput
      data-testid="patterns-results-search"
      placeholder="Search results…"
      size="xs"
      w={190}
      leftSection={<IconSearch size={14} />}
      value={value()}
      onChange={setValue}
      style={{ "flex-shrink": 0 }}
    />
  );
}
