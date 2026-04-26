import { useState, useEffect } from "react";
import { Box, Group, MultiSelect, Tooltip, Badge, ActionIcon } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconChevronDown, IconChevronUp, IconX } from "@tabler/icons-react";
import { searchSymbols } from "../../api/symbols";

const MAX_VISIBLE_CHIPS = 5;

export function SymbolChips({
  selectedSymbols,
  onSymbolsChange,
}: {
  selectedSymbols: string[];
  onSymbolsChange: (symbols: string[]) => void;
}) {
  const [symbolSearch, setSymbolSearch] = useState("");
  const [symbolOptions, setSymbolOptions] = useState<{ value: string; label: string }[]>([]);
  const [debouncedSearch] = useDebouncedValue(symbolSearch, 300);
  const [symbolsExpanded, setSymbolsExpanded] = useState(false);

  useEffect(() => {
    if (debouncedSearch.trim().length < 1) {
      return;
    }

    searchSymbols(debouncedSearch, 20)
      .then((results) => {
        setSymbolOptions(
          results.map((r) => ({
            value: r.symbol,
            label: `${r.symbol} - ${r.name}`,
          })),
        );
      })
      .catch((err) => {
        console.error("Failed to search symbols:", err);
      });
  }, [debouncedSearch]);

  const visibleChips = symbolsExpanded
    ? selectedSymbols
    : selectedSymbols.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenCount = selectedSymbols.length - MAX_VISIBLE_CHIPS;
  const hasOverflow = selectedSymbols.length > MAX_VISIBLE_CHIPS;

  const handleRemoveSymbol = (symbol: string) => {
    onSymbolsChange(selectedSymbols.filter((s) => s !== symbol));
  };

  return (
    <>
      <Group gap={4}>
        <MultiSelect
          id="symbol-multiselect"
          className="config-symbol-multiselect"
          data={symbolOptions}
          value={selectedSymbols}
          onChange={onSymbolsChange}
          searchable
          searchValue={symbolSearch}
          onSearchChange={setSymbolSearch}
          clearable
          hidePickedOptions
          size="sm"
          flex={1}
          nothingFoundMessage="No symbols found"
          maxDropdownHeight={200}
          data-testid="symbol-multiselect"
        />
        {selectedSymbols.length > 0 && (
          <Tooltip label="Clear all symbols">
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              onClick={() => onSymbolsChange([])}
              data-testid="clear-symbols-btn"
            >
              <IconX size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      {selectedSymbols.length > 0 && (
        <Box
          className={`config-symbols-chips ${symbolsExpanded ? "expanded" : ""}`}
          data-testid="symbol-chips"
        >
          {visibleChips.map((symbol) => (
            <Badge
              key={symbol}
              variant="outline"
              size="sm"
              className="symbol-chip"
              rightSection={<IconX size={10} onClick={() => handleRemoveSymbol(symbol)} />}
              data-testid={`chip-${symbol}`}
            >
              {symbol}
            </Badge>
          ))}
          {hasOverflow && !symbolsExpanded && (
            <Badge
              variant="light"
              color="gray"
              size="sm"
              className="symbol-chip symbol-expand-toggle"
              onClick={() => setSymbolsExpanded(true)}
              rightSection={<IconChevronDown size={10} />}
              data-testid="symbol-expand-more-btn"
            >
              +{hiddenCount} more
            </Badge>
          )}
          {symbolsExpanded && hasOverflow && (
            <Badge
              variant="light"
              color="gray"
              size="sm"
              className="symbol-chip symbol-expand-toggle"
              onClick={() => setSymbolsExpanded(false)}
              rightSection={<IconChevronUp size={10} />}
              data-testid="symbol-expand-less-btn"
            >
              Less
            </Badge>
          )}
        </Box>
      )}
    </>
  );
}
