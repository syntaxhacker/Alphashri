import { useMemo } from "react";
import { Box, Button, Checkbox, Menu, MenuDropdown, MenuTarget, Text } from "@/ui";
import { IconChevronDown } from "@tabler/icons-react";
import type { TFSpec } from "@/types/chartPatterns";
import { DEFAULT_TIMEFRAME } from "@/state/chartPatterns";

/**
 * Full timeframe ladder fallback. The server (`GET /timeframes`) is the source
 * of truth; this is only used before the catalog resolves so the selector is
 * never empty. Mirrors CONTRACT §1.
 */
export const FALLBACK_TIMEFRAMES: TFSpec[] = [
  { id: "1m", label: "1m", minutes: 1, native: "minutes/1", source_tf: null, max_lookback_days: 30, min_bars: 60 },
  { id: "5m", label: "5m", minutes: 5, native: "minutes/5", source_tf: null, max_lookback_days: 90, min_bars: 60 },
  { id: "10m", label: "10m", minutes: 10, native: "minutes/10", source_tf: null, max_lookback_days: 90, min_bars: 60 },
  { id: "15m", label: "15m", minutes: 15, native: "minutes/15", source_tf: null, max_lookback_days: 90, min_bars: 60 },
  { id: "30m", label: "30m", minutes: 30, native: "minutes/30", source_tf: null, max_lookback_days: 180, min_bars: 60 },
  { id: "1h", label: "1h", minutes: 60, native: "hours/1", source_tf: null, max_lookback_days: 365, min_bars: 60 },
  { id: "3h", label: "3h", minutes: 180, native: null, source_tf: "1h", max_lookback_days: 365, min_bars: 60 },
  { id: "4h", label: "4h", minutes: 240, native: "hours/4", source_tf: null, max_lookback_days: 365, min_bars: 60 },
  { id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 },
  { id: "1W", label: "1W", minutes: 10080, native: "weeks/1", source_tf: null, max_lookback_days: 1825, min_bars: 52 },
  { id: "1M", label: "1M", minutes: 43200, native: "months/1", source_tf: null, max_lookback_days: 3650, min_bars: 24 },
];

export interface TimeframeSelectProps {
  timeframes: TFSpec[];
  value: string[];
  onChange: (value: string[]) => void;
}

export function TimeframeSelect({ timeframes, value, onChange }: TimeframeSelectProps) {
  const source = timeframes.length > 0 ? timeframes : FALLBACK_TIMEFRAMES;
  const selected = value && value.length > 0 ? value : [DEFAULT_TIMEFRAME];
  const ids = useMemo(() => source.map((tf) => tf.id), [source]);
  const ordered = ids.filter((id) => selected.includes(id));
  const labels = useMemo(() => new Map(source.map((tf) => [tf.id, tf.label || tf.id])), [source]);
  const summary =
    ordered.length <= 2
      ? ordered.map((id) => labels.get(id) ?? id).join(",")
      : String(ordered.length);

  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    if (next.length === 0) return;
    onChange(ids.filter((item) => next.includes(item)));
  };

  return (
    <Menu closeOnItemClick={false} data-testid="patterns-timeframe-menu">
      <MenuTarget>
        <Button
          size="xs"
          variant="outline"
          rightSection={<IconChevronDown size={12} />}
          data-testid="patterns-timeframe-select"
          aria-label="Timeframes"
          title="Timeframes used for pattern detection (select one or more)"
          style={{
            "min-width": 136,
            "max-width": 210,
            "justify-content": "space-between",
            "text-transform": "none",
            "font-size": 11,
            "font-weight": 600,
          }}
        >
          {`Timeframe · ${summary}`}
        </Button>
      </MenuTarget>
      <MenuDropdown data-testid="patterns-timeframe-dropdown">
        <Box className="max-h-[320px] min-w-[170px] overflow-y-auto py-[2px]">
          {source.map((tf) => {
            const checked = selected.includes(tf.id);
            return (
              <Box
                key={tf.id}
                data-testid={`patterns-timeframe-option-${tf.id}`}
                onClick={() => toggle(tf.id)}
                className="flex cursor-pointer items-center gap-1 px-1 py-[2px] transition-colors hover:bg-fin-surface-alt"
              >
                <Checkbox
                  size="xs"
                  checked={checked}
                  onChange={() => toggle(tf.id)}
                  onClick={(event) => event.stopPropagation()}
                />
                <Text size="xs">{tf.label || tf.id}</Text>
              </Box>
            );
          })}
        </Box>
      </MenuDropdown>
    </Menu>
  );
}
