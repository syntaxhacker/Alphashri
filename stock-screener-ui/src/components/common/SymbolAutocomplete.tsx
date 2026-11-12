// SymbolAutocomplete — single-select NSE symbol search with free text entry.
// Typing is debounced; a value is committed only on option select / Enter so
// consumers are not refetched on every keystroke. Static extras (indices such
// as NIFTY/BANKNIFTY) are merged ahead of API results.
import { For, Show, createEffect, createMemo, createSignal, onCleanup, splitProps } from "solid-js";
import { Box, TextInput } from "@/ui";
import * as palette from "@/ui/palette";
import { searchSymbols, type SymbolResult } from "@/api/symbols";
import { withAlpha } from "@/utils/color";

type Option = SymbolResult | string;

const labelOf = (option: Option | null): string =>
  option == null ? "" : typeof option === "string" ? option : option.symbol;

const nameOf = (option: Option): string => (typeof option === "string" ? "" : option.name ?? "");

interface SymbolAutocompleteProps {
  value: string;
  onChange: (symbol: string) => void;
  label?: string;
  width?: number;
  testid?: string;
  /** Static choices rendered ahead of API results, e.g. index underlyings. */
  extraOptions?: string[];
  /** Drop the floating label, keep the field short (used inside dense headers). */
  compact?: boolean;
  /** Restrict API results to F&O-enabled symbols. */
  fnoOnly?: boolean;
}

export default function SymbolAutocomplete(props: SymbolAutocompleteProps) {
  const [local] = splitProps(props, ["label", "width", "testid", "extraOptions", "compact", "fnoOnly"]);
  const label = () => local.label ?? "Symbol";
  const width = () => local.width ?? 220;
  const extraOptions = () => local.extraOptions ?? [];
  const compact = () => local.compact ?? false;
  const fnoOnly = () => local.fnoOnly ?? false;

  const [results, setResults] = createSignal<SymbolResult[]>([]);
  const [input, setInput] = createSignal(props.value ?? "");
  const [open, setOpen] = createSignal(false);
  const [highlightedIndex, setHighlightedIndex] = createSignal(-1);
  let timer: number | undefined;

  onCleanup(() => window.clearTimeout(timer));

  // Converge to an external value change (param load / form reset) without
  // clobbering text the user is actively typing (the prop only changes on commit).
  createEffect(() => {
    setInput(props.value ?? "");
  });

  const handleInput = (v: string, reason?: string) => {
    // The local Autocomplete fires reason "reset"/"blur" with "" when async options resolve or the
    // field blurs; those are not user edits and must not wipe the typed text.
    if (reason === "reset" || reason === "blur") return;
    setInput(v);
    setOpen(true);
    window.clearTimeout(timer);
    const q = v.trim();
    if (!q) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer = window.setTimeout(() => {
      const request = fnoOnly()
        ? searchSymbols(q, 10, true)
        : searchSymbols(q, 10);
      request
        .then((r) => {
          setResults(r);
          setOpen(r.length > 0);
        })
        .catch(() => {
          setResults([]);
          setOpen(false);
        });
    }, 250);
  };

  const options = createMemo<Option[]>(() => {
    const q = input().trim().toUpperCase();
    const seen = new Set<string>();
    const merged: Option[] = [];

    for (const extra of extraOptions()) {
      const key = extra.toUpperCase();
      if (q && !key.includes(q)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(extra);
    }

    if (q) {
      for (const result of results()) {
        const key = result.symbol.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(result);
      }
    }

    return merged;
  });

  const handleSelect = (option: Option) => {
    setInput(labelOf(option));
    setOpen(false);
    props.onChange(labelOf(option));
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (open() && options()[highlightedIndex()] !== undefined) {
        handleSelect(options()[highlightedIndex()]);
      } else {
        props.onChange(input());
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <Box style={{ position: "relative", width: `${width()}px`, display: "inline-block" }} data-testid={local.testid ? `${local.testid}-wrap` : undefined}>
      <TextInput
        size="xs"
        value={input()}
        onChange={(v) => handleInput(v)}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        label={compact() ? undefined : label()}
        placeholder={compact() ? "Index or F&O stock" : undefined}
        data-testid={local.testid}
        style={{ width: "100%" }}
      />
      <Show when={open() && options().length > 0}>
        <Box
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            "background-color": palette.SURFACE,
            border: `1px solid ${palette.BORDER}`,
            "border-top": "none",
            "border-radius": "0 0 4px 4px",
            "box-shadow": `0 4px 12px ${withAlpha(palette.BG, 0.3)}`,
            "z-index": 50,
            "max-height": 240,
            "overflow-y": "auto",
          }}
        >
          <For each={options()}>{(option, index) => (
            <div
              role="option"
              style={{
                padding: "6px 8px",
                cursor: "pointer",
                "border-bottom": `1px solid ${palette.BORDER}`,
                display: "flex",
                "align-items": "center",
                gap: 8,
                "background-color": highlightedIndex() === index() ? palette.SCALE_GRAY[6] : "inherit",
                color: palette.TEXT,
              }}
              onMouseEnter={() => setHighlightedIndex(index())}
              onClick={() => handleSelect(option)}
            >
              <span style={{ "font-weight": 600 }}>{labelOf(option)}</span>
              <Show when={nameOf(option)}>
                <span style={{ color: palette.TEXT_MUTED, "margin-left": 8, "font-size": 12 }}>{nameOf(option)}</span>
              </Show>
            </div>
          )}</For>
        </Box>
      </Show>
    </Box>
  );
}
