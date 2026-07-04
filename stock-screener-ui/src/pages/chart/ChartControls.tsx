import { Group, Stack } from "@/ui";
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
    <div className="chart-controls" id="chart-controls" data-testid="chart-controls">
      <Stack gap="xs" className="controls-container">
        <Group gap="xs" wrap="nowrap">
          <span
            className="control-label"
            style={{ fontSize: "12px", color: "var(--mantine-color-dimmed)" }}
          >
            Timeframe:
          </span>
          <select
            value={timeframe}
            onChange={(e) => onTimeframeChange(parseInt(e.target.value))}
            data-testid="chart-timeframe-select"
            className="timeframe-select"
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf.value} value={tf.value}>
                {tf.label}
              </option>
            ))}
          </select>
        </Group>

        <Group gap="xs" wrap="nowrap">
          <span
            className="control-label"
            style={{ fontSize: "12px", color: "var(--mantine-color-dimmed)" }}
          >
            OR:
          </span>
          <select
            value={orMinutes}
            onChange={(e) => onOrMinutesChange(parseInt(e.target.value))}
            data-testid="chart-or-select"
            className="or-select"
          >
            {OR_MINUTES_OPTIONS.map((or) => (
              <option key={or.value} value={or.value}>
                {or.label}
              </option>
            ))}
          </select>
        </Group>

        <Group gap="xs" wrap="nowrap">
          <label className="checkbox-label" data-testid="chart-pivots-checkbox-wrapper">
            <input
              type="checkbox"
              checked={showPivots}
              onChange={(e) => onPivotsChange(e.target.checked)}
              data-testid="chart-pivots-checkbox"
              aria-label="Toggle pivot levels"
            />
            <span>Pivots</span>
          </label>
        </Group>

        <Group gap="xs" wrap="nowrap">
          <label className="checkbox-label" data-testid="chart-52w-checkbox-wrapper">
            <input
              type="checkbox"
              checked={show52wHigh}
              onChange={(e) => on52wHighChange(e.target.checked)}
              data-testid="chart-52w-checkbox"
              aria-label="Toggle 52-week high"
            />
            <span>52W High</span>
          </label>
        </Group>
      </Stack>
    </div>
  );
}
