// SymbolAutocomplete — single-select NSE symbol search with free text entry.
// Typing is debounced; a value is committed only on option select / Enter so
// consumers are not refetched on every keystroke. Static extras (indices such
// as NIFTY/BANKNIFTY) are merged ahead of API results.
import { useEffect, useMemo, useRef, useState } from "react";
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

export default function SymbolAutocomplete({
  value,
  onChange,
  label = "Symbol",
  width = 220,
  testid,
  extraOptions = [],
  compact = false,
  fnoOnly = false,
}: SymbolAutocompleteProps) {
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [input, setInput] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const highlightedIndex = useRef(-1);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Converge to an external value change (param load / form reset) without
  // clobbering text the user is actively typing (the prop only changes on commit).
  useEffect(() => {
    setInput(value ?? "");
  }, [value]);

  const handleInput = (v: string, reason?: string) => {
    // MUI fires reason "reset"/"blur" with "" when async options resolve or the
    // field blurs; those are not user edits and must not wipe the typed text.
    if (reason === "reset" || reason === "blur") return;
    setInput(v);
    setOpen(true);
    window.clearTimeout(timer.current);
    const q = v.trim();
    if (!q) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer.current = window.setTimeout(() => {
      const request = fnoOnly
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

  const options = useMemo<Option[]>(() => {
    const q = input.trim().toUpperCase();
    const seen = new Set<string>();
    const merged: Option[] = [];

    for (const extra of extraOptions) {
      const key = extra.toUpperCase();
      if (q && !key.includes(q)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(extra);
    }

    if (q) {
      for (const result of results) {
        const key = result.symbol.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(result);
      }
    }

    return merged;
  }, [extraOptions, input, results]);

  const handleSelect = (option: Option) => {
    setInput(labelOf(option));
    setOpen(false);
    onChange(labelOf(option));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && options[highlightedIndex.current] !== undefined) {
        handleSelect(options[highlightedIndex.current]);
      } else {
        onChange(input);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <Box style={{ position: "relative", width, display: "inline-block" }} data-testid={testid ? `${testid}-wrap` : undefined}>
      <TextInput
        size="xs"
        value={input}
        onChange={(v) => handleInput(v)}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        label={compact ? undefined : label}
        placeholder={compact ? "Index or F&O stock" : undefined}
        data-testid={testid}
        style={{ width: "100%" }}
      />
      {open && options.length > 0 && (
        <Box
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            backgroundColor: palette.SURFACE,
            border: `1px solid ${palette.BORDER}`,
            borderTop: "none",
            borderRadius: "0 0 4px 4px",
            boxShadow: `0 4px 12px ${withAlpha(palette.BG, 0.3)}`,
            zIndex: 50,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {options.map((option, index) => (
            <div
              key={labelOf(option)}
              role="option"
              style={{
                padding: "6px 8px",
                cursor: "pointer",
                borderBottom: `1px solid ${palette.BORDER}`,
                display: "flex",
                alignItems: "center",
                gap: 8,
                backgroundColor: highlightedIndex.current === index ? palette.SCALE_GRAY[6] : "inherit",
                color: palette.TEXT,
              }}
              onMouseEnter={() => (highlightedIndex.current = index)}
              onClick={() => handleSelect(option)}
            >
              <span style={{ fontWeight: 600 }}>{labelOf(option)}</span>
              {nameOf(option) ? (
                <span style={{ color: palette.TEXT_MUTED, marginLeft: 8, fontSize: 12 }}>{nameOf(option)}</span>
              ) : null}
            </div>
          ))}
        </Box>
      )}
    </Box>
  );
}
