import { createEffect, createSignal } from "solid-js";
import { Box, NumberInput, Text } from "@/ui";

export interface PresetFieldDef {
  key: string;
  label: string;
  suffix?: string;
  min?: number;
  step?: number;
}

/** Sector-relative first: a flat threshold means a different thing per sector. */
export const VALUE_FIELDS: readonly PresetFieldDef[] = [
  { key: "pePctMax", label: "P/E %ile ≤ (cheap)", min: 0, step: 0.05 },
  { key: "roePctMin", label: "ROE %ile ≥ (top)", min: 0, step: 0.05 },
  { key: "dePctMax", label: "D/E %ile ≤ (low)", min: 0, step: 0.05 },
  { key: "peMax", label: "P/E ≤ (absolute)", min: 0, step: 0.5 },
  { key: "psMax", label: "P/S ≤ (absolute)", min: 0, step: 0.1 },
  { key: "pbMax", label: "P/B ≤ (absolute)", min: 0, step: 0.1 },
  { key: "roeMin", label: "ROE ≥ (absolute)", suffix: "%", min: -100, step: 1 },
  { key: "divYieldMin", label: "Div yield ≥", suffix: "%", min: 0, step: 0.1 },
  { key: "fcfYieldMin", label: "FCF yield ≥", suffix: "%", min: -100, step: 0.1 },
  { key: "debtToEquityMax", label: "D/E ≤ (absolute)", min: 0, step: 0.1 },
  { key: "revYoyMin", label: "Rev growth ≥", suffix: "%", step: 1 },
  { key: "epsYoyMin", label: "EPS growth ≥", suffix: "%", step: 1 },
];

export const MOVER_VALUE_FIELDS: readonly PresetFieldDef[] = [
  { key: "gapMin", label: "Gap ≥", suffix: "%", step: 0.5 },
  { key: "gapMax", label: "Gap ≤", suffix: "%", step: 0.5 },
  { key: "rangeVsAtrMin", label: "Range ÷ ATR ≥", min: 0, step: 0.1 },
  { key: "to52wHighMin", label: "To 52W high ≥", suffix: "%", step: 0.5 },
  { key: "to52wHighMax", label: "To 52W high ≤", suffix: "%", step: 0.5 },
  { key: "from52wLowMin", label: "From 52W low ≥", suffix: "%", step: 0.5 },
  { key: "from52wLowMax", label: "From 52W low ≤", suffix: "%", step: 0.5 },
  { key: "volumeMin", label: "Volume ≥", min: 0, step: 100 },
  { key: "valueTradedMin", label: "Value traded ≥", min: 0, step: 100 },
];

/**
 * The value-scan contract's manual bounds. These are the same keys the API
 * accepts (`src/api/valueScan.ts::ValueFilters`), so a typed bound can never
 * survive only in gallery state while the scan ignores it.
 */
export const VALUE_SCAN_FIELDS: readonly PresetFieldDef[] = [
  { key: "max_pe", label: "P/E ≤", min: 0, step: 0.5 },
  { key: "max_ps", label: "P/S ≤", min: 0, step: 0.1 },
  { key: "max_pb", label: "P/B ≤", min: 0, step: 0.1 },
  { key: "min_roe", label: "ROE ≥", suffix: "%", min: -100, step: 1 },
  { key: "min_div_yield", label: "Dividend yield ≥", suffix: "%", min: 0, step: 0.1 },
  { key: "min_fcf_yield", label: "FCF yield ≥", suffix: "%", min: -100, step: 0.1 },
  { key: "max_de", label: "D/E ≤", min: 0, step: 0.1 },
  { key: "min_rev_yoy", label: "Revenue growth ≥", suffix: "%", step: 1 },
  { key: "min_eps_yoy", label: "EPS growth ≥", suffix: "%", step: 1 },
];

/** In-progress keystrokes ("1.", "-") are not bounds; an empty field is "off". */
function toBound(raw: number | string): number | null {
  if (raw === "" || raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

interface PresetNumberFieldProps {
  def: PresetFieldDef;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  testIdPrefix?: string;
}

export function PresetNumberField(props: PresetNumberFieldProps) {
  const [raw, setRaw] = createSignal(props.value == null ? "" : String(props.value));
  let committed: number | null = props.value ?? null;
  // Presets and chip removals change the bound from outside the field; follow
  // them without stomping an in-progress keystroke.
  createEffect(() => {
    const bound = props.value ?? null;
    if (bound === committed) return;
    committed = bound;
    setRaw(bound == null ? "" : String(bound));
  });

  return (
    <Box className="flex flex-col gap-1 min-w-0">
      <Text fw={600} c="dimmed" className="text-xs">
        {props.def.label}
      </Text>
      <NumberInput
        size="xs"
        suffix={props.def.suffix}
        min={props.def.min}
        step={props.def.step}
        hideControls
        placeholder="Any"
        value={raw()}
        data-testid={`${props.testIdPrefix ?? "market-filter"}-${props.def.key}`}
        onChange={(next) => {
          const text = typeof next === "string" ? next : String(next);
          setRaw(text);
          const bound = toBound(next);
          if (bound === committed) return;
          committed = bound;
          props.onChange(bound);
        }}
      />
    </Box>
  );
}
