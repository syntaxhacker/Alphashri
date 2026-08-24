import { Box, Group, Stack } from "@/ui";
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
    <Box id="chart-controls" data-testid="chart-controls" sx={{ p: 2, borderRadius: 1 }}>
      <Stack gap="xs" sx={{ gap: 1 }}>
        <Group gap="xs" wrap="nowrap">
          <Box component="span" sx={{ fontSize: "0.75rem", color: "text.secondary" }}>
            Timeframe:
          </Box>
          <Box
            component="select"
            value={timeframe}
            onChange={(e: any) => onTimeframeChange(parseInt(e.target.value))}
            data-testid="chart-timeframe-select"
            sx={{ p: 0.5, borderRadius: 1 }}
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf.value} value={tf.value}>
                {tf.label}
              </option>
            ))}
          </Box>
        </Group>

        <Group gap="xs" wrap="nowrap">
          <Box component="span" sx={{ fontSize: "0.75rem", color: "text.secondary" }}>
            OR:
          </Box>
          <Box
            component="select"
            value={orMinutes}
            onChange={(e: any) => onOrMinutesChange(parseInt(e.target.value))}
            data-testid="chart-or-select"
            sx={{ p: 0.5, borderRadius: 1 }}
          >
            {OR_MINUTES_OPTIONS.map((or) => (
              <option key={or.value} value={or.value}>
                {or.label}
              </option>
            ))}
          </Box>
        </Group>

        <Group gap="xs" wrap="nowrap">
          <Box component="label" data-testid="chart-pivots-checkbox-wrapper" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <input
              type="checkbox"
              checked={showPivots}
              onChange={(e) => onPivotsChange(e.target.checked)}
              data-testid="chart-pivots-checkbox"
              aria-label="Toggle pivot levels"
            />
            <Box component="span" sx={{ fontSize: "0.75rem" }}>Pivots</Box>
          </Box>
        </Group>

        <Group gap="xs" wrap="nowrap">
          <Box component="label" data-testid="chart-52w-checkbox-wrapper" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <input
              type="checkbox"
              checked={show52wHigh}
              onChange={(e) => on52wHighChange(e.target.checked)}
              data-testid="chart-52w-checkbox"
              aria-label="Toggle 52-week high"
            />
            <Box component="span" sx={{ fontSize: "0.75rem" }}>52W High</Box>
          </Box>
        </Group>
      </Stack>
    </Box>
  );
}
