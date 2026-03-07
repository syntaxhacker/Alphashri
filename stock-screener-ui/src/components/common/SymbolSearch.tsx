/**
 * Symbol Search Component (Mantine)
 *
 * Reusable autocomplete component for searching and selecting stock symbols.
 * Features:
 * - Debounced search (300ms)
 * - Keyboard navigation
 * - Click to select
 * - Filters out already selected symbols
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { TextInput, Box, Text, Loader } from "@mantine/core";
import { searchSymbols, SymbolResult } from "../../api/symbols";

interface SymbolSearchProps {
  placeholder?: string;
  selectedSymbols?: string[];
  onSelect: (symbol: string) => void;
  width?: number;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  "data-testid"?: string;
}

export function SymbolSearch({
  placeholder = "Search symbol...",
  selectedSymbols = [],
  onSelect,
  width = 120,
  size = "xs",
  "data-testid": testId,
}: SymbolSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      setSelectedIndex(0);

      // Clear previous timer
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      if (value.trim().length < 1) {
        setResults([]);
        setIsOpen(false);
        return;
      }

      // Debounced search
      debounceRef.current = window.setTimeout(async () => {
        setIsLoading(true);
        setIsOpen(true);

        let searchResults = await searchSymbols(value, 10);
        // Filter out already selected symbols
        searchResults = searchResults.filter((r) => !selectedSymbols.includes(r.symbol));

        setResults(searchResults);
        setIsLoading(false);
        setSelectedIndex(0);

        if (searchResults.length === 0) {
          setIsOpen(false);
        }
      }, 300);
    },
    [selectedSymbols],
  );

  const handleSelect = useCallback(
    (symbol: string) => {
      setQuery("");
      setResults([]);
      setIsOpen(false);
      setSelectedIndex(0);
      onSelect(symbol);
      inputRef.current?.focus();
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen || results.length === 0) {
        if (e.key === "Enter" && query.trim()) {
          e.preventDefault();
          // If exact match in results, select it
          const exact = results.find((r) => r.symbol.toLowerCase() === query.trim().toLowerCase());
          if (exact) {
            handleSelect(exact.symbol);
          }
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;

        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;

        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex].symbol);
          }
          break;

        case "Escape":
          setIsOpen(false);
          break;
      }
    },
    [isOpen, results, selectedIndex, query, handleSelect],
  );

  return (
    <Box ref={containerRef} style={{ position: "relative", width }}>
      <TextInput
        ref={inputRef}
        placeholder={placeholder}
        value={query}
        onChange={(e) => handleSearch(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (results.length > 0) {
            setIsOpen(true);
          }
        }}
        size={size}
        w={width}
        data-testid={testId}
        rightSection={isLoading ? <Loader size={12} /> : null}
      />
      {isOpen && results.length > 0 && (
        <Box
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            backgroundColor: "var(--mantine-color-body)",
            border: "1px solid var(--mantine-color-default-border)",
            borderRadius: "var(--mantine-radius-sm)",
            boxShadow: "var(--mantine-shadow-md)",
            zIndex: 1000,
            maxHeight: 200,
            overflowY: "auto",
          }}
          data-testid="symbol-search-dropdown"
        >
          {results.map((result, index) => (
            <Box
              key={result.symbol}
              onClick={() => handleSelect(result.symbol)}
              style={{
                padding: "6px 10px",
                cursor: "pointer",
                backgroundColor:
                  index === selectedIndex ? "var(--mantine-color-default-hover)" : "transparent",
              }}
              onMouseEnter={() => setSelectedIndex(index)}
              data-testid={`symbol-option-${result.symbol}`}
            >
              <Text size={size} fw={500}>
                {result.symbol}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {result.name}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
