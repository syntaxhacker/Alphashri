import { createEffect, createSignal, onCleanup, For, Show } from "solid-js";
import { Badge, Box, Button, MultiSelect, Text } from "@/ui";
import { IconX } from "@/patterns/icons";
import { searchSymbols } from "@/api/symbols";
import type { PatternFilters } from "@/types/chartPatterns";
import { parseSymbolList } from "./parseSymbolList";

/**
 * `PatternFilters.symbols` is added by the symbols/q filter feature. Read it
 * defensively so this control also works against older filter payloads.
 */
type FiltersWithSymbols = PatternFilters & { symbols?: string[] };

/** Shared empty array — keeps the MultiSelect `value` identity stable across renders. */
const EMPTY_SYMBOLS: string[] = [];

export interface SymbolFilterProps {
  filters: PatternFilters;
  setFilter: (key: string, value: any) => void;
  /**
   * Override how a selection change is applied. Defaults to
   * `setFilter("symbols", …)`. The Patterns scan bar passes the custom-scope
   * action so picking symbols switches to (and defines) a custom scan.
   */
  onChange?: (symbols: string[]) => void;
  placeholder?: string;
  helperText?: string;
}

/** Read the selected symbols from a filter payload (tolerant of older shapes). */
export function readSelectedSymbols(filters: PatternFilters): string[] {
  const symbols = (filters as FiltersWithSymbols).symbols;
  return Array.isArray(symbols) ? symbols : EMPTY_SYMBOLS;
}

/**
 * Multi-symbol picker for the Patterns workspace. Debounces async symbol search
 * (via `searchSymbols`) and keeps the selection in `filters.symbols`. By default
 * it narrows results server-side through `setFilter`; the scan bar overrides
 * that with the custom-scope action so the selection drives a targeted scan.
 */
export function SymbolFilter(props: SymbolFilterProps) {
  const selected = () => readSelectedSymbols(props.filters);
  const placeholder = () => props.placeholder ?? "Filter symbols…";
  const helperText = () => props.helperText ?? "Show patterns only for these symbols";
  const apply = (symbols: string[]) =>
    props.onChange ? props.onChange(symbols) : props.setFilter("symbols", symbols);

  const [query, setQuery] = createSignal("");
  const [debouncedQuery, setDebouncedQuery] = createSignal("");
  const [options, setOptions] = createSignal<Array<{ value: string; label: string }>>([]);

  let debounceTimer: number | undefined;
  createEffect(() => {
    const q = query();
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => setDebouncedQuery(q), 250);
    onCleanup(() => window.clearTimeout(debounceTimer));
  });

  createEffect(() => {
    const term = debouncedQuery().trim();
    if (term.length < 1) {
      setOptions([]);
      return;
    }
    let active = true;
    searchSymbols(term, 20)
      .then((results) => {
        if (!active) return;
        setOptions(
          results.map((r) => ({
            value: r.symbol,
            label: `${r.symbol} — ${r.name}`,
          })),
        );
      })
      .catch(() => {
        if (active) setOptions([]);
      });
    onCleanup(() => {
      active = false;
    });
  });

  const removeSymbol = (symbol: string) => {
    apply(selected().filter((s) => s !== symbol));
  };

  return (
    <Box
      data-testid="patterns-symbol-filter"
      className="flex min-w-0 flex-1 flex-col gap-1"
    >
      <Box className="flex max-w-[380px] min-w-0 items-center gap-1">
        <Box
          className="min-w-0 flex-1"
          onPaste={(e) => {
            const parsed = parseSymbolList(e.clipboardData.getData("text"));
            if (parsed.length > 1) {
              e.preventDefault();
              apply(Array.from(new Set([...selected(), ...parsed])));
              setQuery("");
            }
          }}
        >
          <MultiSelect
            data={options()}
            value={selected()}
            searchValue={query()}
            onChange={(vals) => {
              apply(vals);
              setQuery("");
            }}
            searchable
            onSearchChange={(v) => setQuery(v)}
            clearable
            hidePickedOptions
            hideTags
            size="xs"
            placeholder={placeholder()}
            nothingFoundMessage="No symbols found"
            style={{ width: "100%" }}
          />
        </Box>
        <Show when={selected().length > 0}>
          <Button
            size="xs"
            variant="subtle"
            onClick={() => apply([])}
            data-testid="patterns-symbol-clear"
          >
            Clear
          </Button>
        </Show>
      </Box>
      <Show when={helperText()}>
        <Text size="xs" c="dimmed">
          {helperText()}
        </Text>
      </Show>
      <Show when={selected().length > 0}>
        <Box className="flex max-h-[60px] flex-wrap gap-1 overflow-y-auto">
          <For each={selected()}>
            {(symbol) => (
              <Badge
                size="xs"
                variant="light"
                color="info"
                data-testid={`patterns-symbol-chip-${symbol}`}
                rightSection={
                  <button
                    type="button"
                    aria-label={`Remove ${symbol}`}
                    data-testid={`patterns-symbol-remove-${symbol}`}
                    onClick={() => removeSymbol(symbol)}
                    class="inline-flex h-4 w-4 items-center justify-center rounded-full text-fin-text-muted transition-colors hover:bg-fin-surface-alt hover:text-fin-text"
                  >
                    <IconX size={8} />
                  </button>
                }
              >
                {symbol}
              </Badge>
            )}
          </For>
        </Box>
      </Show>
    </Box>
  );
}
