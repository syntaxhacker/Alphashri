import { useEffect, useRef, useState } from "react";
import { TextInput, useDebouncedValue } from "@/ui";
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
export function ResultsSearch({ filters, setFilter }: ResultsSearchProps) {
  const external = readResultsQuery(filters);
  const [value, setValue] = useState(external);
  const [debouncedValue] = useDebouncedValue(value, 300);
  const committedRef = useRef(false);

  // Keep the input in sync when filters change elsewhere (reset, presets).
  useEffect(() => {
    setValue(external);
  }, [external]);

  useEffect(() => {
    // Skip the mount run: initial value is not a user edit.
    if (!committedRef.current) {
      committedRef.current = true;
      return;
    }
    setFilter("q", debouncedValue);
  }, [debouncedValue, setFilter]);

  return (
    <TextInput
      data-testid="patterns-results-search"
      label="Search results"
      placeholder="Symbol or company"
      size="xs"
      w={220}
      value={value}
      onChange={setValue}
    />
  );
}
