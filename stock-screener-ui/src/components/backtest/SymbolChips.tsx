import { createEffect, createMemo, createSignal, For, Show, onCleanup } from "solid-js";
import { MultiSelect, Tooltip, Badge, ActionIcon, Box, Group } from "@/ui";
import { IconX, IconChevronDown, IconChevronUp } from "@/components/common/Icons";
import * as palette from "@/ui/palette";
import { searchSymbols } from "../../api/symbols";
const MAX_VISIBLE_CHIPS = 5;

export function SymbolChips(props: {
  selectedSymbols: string[];
  onSymbolsChange: (symbols: string[]) => void;
}) {
  const [symbolSearch, setSymbolSearch] = createSignal("");
  const [symbolOptions, setSymbolOptions] = createSignal<{ value: string; label: string }[]>([]);
  const [symbolsExpanded, setSymbolsExpanded] = createSignal(false);

  // Debounced symbol search — local effect (the @/ui useDebouncedValue never fires
  // after mount and returns a signal tuple, not the value).
  createEffect(() => {
    const q = symbolSearch().trim();
    if (q.length < 1) {
      setSymbolOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      searchSymbols(q, 20)
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
    }, 300);
    onCleanup(() => clearTimeout(timer));
  });

  const visibleChips = () =>
    symbolsExpanded() ? props.selectedSymbols : props.selectedSymbols.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenCount = () => props.selectedSymbols.length - MAX_VISIBLE_CHIPS;
  const hasOverflow = () => props.selectedSymbols.length > MAX_VISIBLE_CHIPS;

  const handleRemoveSymbol = (symbol: string) => {
    props.onSymbolsChange(props.selectedSymbols.filter((s) => s !== symbol));
  };

  return (
    <>
      <Group gap={4} align="center" flex={1} miw={0}>
        <Box flex={1} className="min-w-0">
          <MultiSelect
            id="symbol-multiselect"
            className="config-symbol-multiselect"
            data={symbolOptions()}
            value={props.selectedSymbols}
            onChange={props.onSymbolsChange}
            searchable
            searchValue={symbolSearch()}
            onSearchChange={setSymbolSearch}
            clearable
            hidePickedOptions
            size="sm"
            style={{ width: "100%" }}
            nothingFoundMessage="No symbols found"
            maxDropdownHeight={200}
            data-testid="symbol-multiselect"
          />
        </Box>
        <Show when={props.selectedSymbols.length > 0}>
          <Tooltip label="Clear all symbols">
            <ActionIcon
              size="sm"
              variant="subtle"
              color="secondary"
              onClick={() => props.onSymbolsChange([])}
              data-testid="clear-symbols-btn"
            >
              <IconX size={14} />
            </ActionIcon>
          </Tooltip>
        </Show>
      </Group>
      <Show when={props.selectedSymbols.length > 0}>
        <Box
          className={`config-symbols-chips ${symbolsExpanded() ? "expanded" : ""}`}
          data-testid="symbol-chips"
        >
          <For each={visibleChips()}>
            {(symbol) => (
              <Badge
                variant="outline"
                size="sm"
                className="symbol-chip"
                style={{ color: palette.TEXT, borderColor: palette.BORDER }}
                rightSection={
                  <button
                    type="button"
                    aria-label={`Remove ${symbol}`}
                    onClick={() => handleRemoveSymbol(symbol)}
                    style={{ background: "transparent", border: "none", cursor: "pointer", display: "inline-flex", padding: 0 }}
                  >
                    <IconX size={10} />
                  </button>
                }
                data-testid={`chip-${symbol}`}
              >
                {symbol}
              </Badge>
            )}
          </For>
          <Show when={hasOverflow() && !symbolsExpanded()}>
            <Badge
              variant="light"
              color="secondary"
              size="sm"
              className="symbol-chip symbol-expand-toggle"
              onClick={() => setSymbolsExpanded(true)}
              rightSection={<IconChevronDown size={10} />}
              data-testid="symbol-expand-more-btn"
              style={{ color: palette.TEXT_MUTED }}
            >
              +{hiddenCount()} more
            </Badge>
          </Show>
          <Show when={symbolsExpanded() && hasOverflow()}>
            <Badge
              variant="light"
              color="secondary"
              size="sm"
              className="symbol-chip symbol-expand-toggle"
              onClick={() => setSymbolsExpanded(false)}
              rightSection={<IconChevronUp size={10} />}
              data-testid="symbol-expand-less-btn"
              style={{ color: palette.TEXT_MUTED }}
            >
              Less
            </Badge>
          </Show>
        </Box>
      </Show>
    </>
  );
}
