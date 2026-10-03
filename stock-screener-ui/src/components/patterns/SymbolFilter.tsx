import { useEffect, useState } from "react";
import { ActionIcon, Badge, Box, Button, MultiSelect, Text, useDebouncedValue } from "@/ui";
import { IconX } from "@tabler/icons-react";
import { searchSymbols } from "@/api/symbols";
import type { PatternFilters } from "@/types/chartPatterns";

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
}

/** Read the selected symbols from a filter payload (tolerant of older shapes). */
export function readSelectedSymbols(filters: PatternFilters): string[] {
  const symbols = (filters as FiltersWithSymbols).symbols;
  return Array.isArray(symbols) ? symbols : EMPTY_SYMBOLS;
}

/**
 * Multi-symbol picker for the Patterns workspace. Debounces async symbol search
 * (via `searchSymbols`), keeps the selection in `filters.symbols` and reloads
 * results server-side through `setFilter`.
 */
export function SymbolFilter({ filters, setFilter }: SymbolFilterProps) {
  const selected = readSelectedSymbols(filters);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, 250);
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);

  useEffect(() => {
    const term = debouncedQuery.trim();
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
    return () => {
      active = false;
    };
  }, [debouncedQuery]);

  const removeSymbol = (symbol: string) => {
    setFilter(
      "symbols",
      selected.filter((s) => s !== symbol),
    );
  };

  return (
    <Box
      data-testid="patterns-symbol-filter"
      sx={{ display: "flex", flexDirection: "column", gap: 0.5, width: 280, minWidth: 0 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <MultiSelect
            data={options}
            value={selected}
            searchValue={query}
            onChange={(vals) => {
              setFilter("symbols", vals);
              setQuery("");
            }}
            searchable
            onSearchChange={(v) => setQuery(v)}
            clearable
            hidePickedOptions
            size="xs"
            placeholder="Filter symbols…"
            nothingFoundMessage="No symbols found"
            style={{ width: "100%" }}
          />
        </Box>
        {selected.length > 0 && (
          <Button
            size="xs"
            variant="subtle"
            onClick={() => setFilter("symbols", [])}
            data-testid="patterns-symbol-clear"
          >
            Clear
          </Button>
        )}
      </Box>
      <Text size="xs" c="dimmed">
        Show patterns only for these symbols
      </Text>
      {selected.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {selected.map((symbol) => (
            <Badge
              key={symbol}
              size="sm"
              variant="light"
              color="secondary"
              data-testid={`patterns-symbol-chip-${symbol}`}
              rightSection={
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  aria-label={`Remove ${symbol}`}
                  data-testid={`patterns-symbol-remove-${symbol}`}
                  onClick={() => removeSymbol(symbol)}
                >
                  <IconX size={10} />
                </ActionIcon>
              }
            >
              {symbol}
            </Badge>
          ))}
        </Box>
      )}
    </Box>
  );
}
