// SymbolAutocomplete — single-select NSE symbol search for replay params typed
// "symbol". Debounces the query and reuses the shared searchSymbols API. Commits
// only on option select / Enter (freeSolo) so typing does not refetch the replay.
import { useEffect, useRef, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import { searchSymbols, type SymbolResult } from "@/api/symbols";

const labelOf = (o: SymbolResult | string | null): string =>
  o == null ? "" : typeof o === "string" ? o : o.symbol;

interface SymbolAutocompleteProps {
  value: string;
  onChange: (symbol: string) => void;
  label?: string;
  width?: number;
  testid?: string;
}

export default function SymbolAutocomplete({
  value, onChange, label = "Symbol", width = 220, testid,
}: SymbolAutocompleteProps) {
  const [options, setOptions] = useState<SymbolResult[]>([]);
  const [input, setInput] = useState(value ?? "");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const handleInput = (_e: unknown, v: string) => {
    setInput(v);
    window.clearTimeout(timer.current);
    const q = v.trim();
    if (!q) {
      setOptions([]);
      return;
    }
    timer.current = window.setTimeout(() => {
      searchSymbols(q, 10)
        .then((r) => setOptions(r))
        .catch(() => setOptions([]));
    }, 250);
  };

  return (
    <Autocomplete
      freeSolo
      size="small"
      options={options}
      value={value ?? ""}
      inputValue={input}
      sx={{ width }}
      getOptionLabel={labelOf}
      isOptionEqualToValue={(o, v) => labelOf(o) === labelOf(v as SymbolResult | string)}
      filterOptions={(x) => x}
      onInputChange={handleInput}
      onChange={(_e, v) => onChange(labelOf(v as SymbolResult | string))}
      renderOption={(props, option) => (
        <li {...props} key={option.symbol}>
          <span style={{ fontWeight: 600 }}>{option.symbol}</span>
          {option.name ? (
            <span style={{ color: "#9CA3AF", marginLeft: 8, fontSize: 12 }}>{option.name}</span>
          ) : null}
        </li>
      )}
      renderInput={(params) => <TextField {...params} label={label} data-testid={testid} />}
    />
  );
}
