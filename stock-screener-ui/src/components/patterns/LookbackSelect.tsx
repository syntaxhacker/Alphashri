import { Select, Text } from "@/ui";
import { LOOKBACK_OPTIONS } from "@/config/patterns";

/** Re-exported so existing imports from this module keep working. */
export { LOOKBACK_OPTIONS };

export interface LookbackSelectProps {
  value: number | null;
  onChange: (value: number | null) => void;
}

/** Lookback (in bars) selector for the Patterns scan bar. */
export function LookbackSelect(props: LookbackSelectProps) {
  const data = [
    { value: "auto", label: "Auto" },
    ...LOOKBACK_OPTIONS.map((n) => ({ value: String(n), label: String(n) })),
  ];
  return (
    <Select
      data={data}
      value={props.value == null ? "auto" : String(props.value)}
      onChange={(v) => {
        if (v == null || v === "" || v === "auto") {
          props.onChange(null);
          return;
        }
        const n = Number(v);
        if (Number.isFinite(n)) props.onChange(n);
      }}
      w={122}
      size="xs"
      leftSection={<Text size="xs" c="dimmed" style={{ fontSize: 10 }}>Bars</Text>}
      data-testid="patterns-lookback-select"
      title="Bars of history the detector reads before forming a pattern (Auto = preset default)"
      style={{ flexShrink: 0 }}
    />
  );
}
