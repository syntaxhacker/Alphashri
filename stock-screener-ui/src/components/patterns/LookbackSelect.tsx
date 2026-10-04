import { Select } from "@/ui";

/** Lookback window options (in bars). `null` = Auto (server default). */
export const LOOKBACK_OPTIONS: number[] = [60, 120, 250, 500, 1000];

export interface LookbackSelectProps {
  value: number | null;
  onChange: (value: number | null) => void;
}

/** Lookback (in bars) selector for the Patterns scan bar. */
export function LookbackSelect({ value, onChange }: LookbackSelectProps) {
  const data = [
    { value: "auto", label: "Auto" },
    ...LOOKBACK_OPTIONS.map((n) => ({ value: String(n), label: String(n) })),
  ];
  return (
    <Select
      label="Lookback"
      data={data}
      value={value == null ? "auto" : String(value)}
      onChange={(v) => {
        if (v == null || v === "" || v === "auto") {
          onChange(null);
          return;
        }
        const n = Number(v);
        if (Number.isFinite(n)) onChange(n);
      }}
      w={130}
      size="sm"
      data-testid="patterns-lookback-select"
    />
  );
}
