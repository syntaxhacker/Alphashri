import { Select } from "@/ui";
import type { TFSpec } from "@/types/chartPatterns";

/**
 * Full timeframe ladder fallback. The server (`GET /timeframes`) is the source
 * of truth; this is only used before the catalog resolves so the selector is
 * never empty. Mirrors CONTRACT §1.
 */
export const FALLBACK_TIMEFRAMES: TFSpec[] = [
  { id: "1m", label: "1m", minutes: 1, native: "minutes/1", source_tf: null, max_lookback_days: 30, min_bars: 60 },
  { id: "3m", label: "3m", minutes: 3, native: null, source_tf: "1m", max_lookback_days: 30, min_bars: 60 },
  { id: "5m", label: "5m", minutes: 5, native: "minutes/5", source_tf: null, max_lookback_days: 90, min_bars: 60 },
  { id: "10m", label: "10m", minutes: 10, native: "minutes/10", source_tf: null, max_lookback_days: 90, min_bars: 60 },
  { id: "15m", label: "15m", minutes: 15, native: "minutes/15", source_tf: null, max_lookback_days: 90, min_bars: 60 },
  { id: "30m", label: "30m", minutes: 30, native: "minutes/30", source_tf: null, max_lookback_days: 180, min_bars: 60 },
  { id: "1h", label: "1h", minutes: 60, native: "hours/1", source_tf: null, max_lookback_days: 365, min_bars: 60 },
  { id: "2h", label: "2h", minutes: 120, native: null, source_tf: "1h", max_lookback_days: 365, min_bars: 60 },
  { id: "3h", label: "3h", minutes: 180, native: null, source_tf: "1h", max_lookback_days: 365, min_bars: 60 },
  { id: "4h", label: "4h", minutes: 240, native: "hours/4", source_tf: null, max_lookback_days: 365, min_bars: 60 },
  { id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 },
  { id: "1W", label: "1W", minutes: 10080, native: "weeks/1", source_tf: null, max_lookback_days: 1825, min_bars: 52 },
  { id: "1M", label: "1M", minutes: 43200, native: "months/1", source_tf: null, max_lookback_days: 3650, min_bars: 24 },
];

export interface TimeframeSelectProps {
  timeframes: TFSpec[];
  value: string;
  onChange: (value: string) => void;
}

/**
 * Server-driven timeframe ladder (1m … 1M). Values come from `/timeframes`;
 * falls back to the frozen contract ladder only when the catalog is empty.
 */
export function TimeframeSelect({ timeframes, value, onChange }: TimeframeSelectProps) {
  const source = timeframes.length > 0 ? timeframes : FALLBACK_TIMEFRAMES;
  const data = source.map((tf) => ({ value: tf.id, label: tf.label || tf.id }));
  return (
    <Select
      label="Timeframe"
      data={data}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      w={150}
      size="sm"
      searchable
      data-testid="patterns-timeframe-select"
    />
  );
}
