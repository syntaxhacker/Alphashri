import { Checkbox, Select, Text, ToolbarRow } from "@/ui";
import { TIMEFRAMES, OR_MINUTES_OPTIONS } from "../../config/constants";

interface ChartControlsProps {
  timeframe: number;
  orMinutes: number;
  showPivots: boolean;
  show52wHigh: boolean;
  onTimeframeChange: (value: number) => void;
  onOrMinutesChange: (value: number) => void;
  onPivotsChange: (checked: boolean) => void;
  on52wHighChange: (checked: boolean) => void;
}

export function ChartControls({
  timeframe,
  orMinutes,
  showPivots,
  show52wHigh,
  onTimeframeChange,
  onOrMinutesChange,
  onPivotsChange,
  on52wHighChange,
}: ChartControlsProps) {
  return (
    <ToolbarRow
      id="chart-controls"
      data-testid="chart-controls"
      gap={8}
      justify="flex-end"
      wrap={false}
    >
      <Text size="xs" c="dimmed">
        Timeframe
      </Text>
      <Select
        data-testid="chart-timeframe-select"
        size="xs"
        w={96}
        value={String(timeframe)}
        onChange={(v) => {
          if (v != null) onTimeframeChange(parseInt(v, 10));
        }}
        data={TIMEFRAMES.map((tf) => ({ value: String(tf.value), label: tf.label }))}
      />
      <Text size="xs" c="dimmed">
        OR
      </Text>
      <Select
        data-testid="chart-or-select"
        size="xs"
        w={96}
        value={String(orMinutes)}
        onChange={(v) => {
          if (v != null) onOrMinutesChange(parseInt(v, 10));
        }}
        data={OR_MINUTES_OPTIONS.map((or) => ({ value: String(or.value), label: or.label }))}
      />
      <Checkbox
        data-testid="chart-pivots-checkbox"
        label="Pivots"
        size="xs"
        checked={showPivots}
        onChange={(e) => onPivotsChange(e.target.checked)}
        aria-label="Toggle pivot levels"
      />
      <Checkbox
        data-testid="chart-52w-checkbox"
        label="52W High"
        size="xs"
        checked={show52wHigh}
        onChange={(e) => on52wHighChange(e.target.checked)}
        aria-label="Toggle 52-week high"
      />
    </ToolbarRow>
  );
}
