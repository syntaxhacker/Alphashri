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
    <Box id="chart-controls" data-testid="chart-controls" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
      <Stack spacing={1} sx={{ alignItems: "center", width: "100%" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
          <Box component="span" sx={{ minWidth: 80, fontSize: "0.75rem", color: "text.secondary", textAlign: "center", flexShrink: 0 }}>
            Timeframe
          </Box>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <Box component="select" value={timeframe} onChange={(e: any) => onTimeframeChange(parseInt(e.target.value))} data-testid="chart-timeframe-select" sx={{ p: 0.5, borderRadius: 1, width: "100%" }}>
              {TIMEFRAMES.map((tf) => (
                <option key={tf.value} value={tf.value}>
                  {tf.label}
                </option>
              ))}
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
          <Box component="span" sx={{ minWidth: 80, fontSize: "0.75rem", color: "text.secondary", textAlign: "center", flexShrink: 0 }}>
            OR
          </Box>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <Box component="select" value={orMinutes} onChange={(e: any) => onOrMinutesChange(parseInt(e.target.value))} data-testid="chart-or-select" sx={{ p: 0.5, borderRadius: 1, width: "100%" }}>
              {OR_MINUTES_OPTIONS.map((or) => (
                <option key={or.value} value={or.value}>
                  {or.label}
                </option>
              ))}
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
          <Box component="span" sx={{ minWidth: 80, fontSize: "0.75rem", color: "text.secondary", textAlign: "center", flexShrink: 0 }}>
            Pivots
          </Box>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Box component="label" data-testid="chart-pivots-checkbox-wrapper" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
              <input type="checkbox" checked={showPivots} onChange={(e) => onPivotsChange(e.target.checked)} data-testid="chart-pivots-checkbox" aria-label="Toggle pivot levels" />
              <Box component="span" sx={{ fontSize: "0.75rem" }}>
                Show
              </Box>
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
          <Box component="span" sx={{ minWidth: 80, fontSize: "0.75rem", color: "text.secondary", textAlign: "center", flexShrink: 0 }}>
            52W High
          </Box>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Box component="label" data-testid="chart-52w-checkbox-wrapper" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
              <input type="checkbox" checked={show52wHigh} onChange={(e) => on52wHighChange(e.target.checked)} data-testid="chart-52w-checkbox" aria-label="Toggle 52-week high" />
              <Box component="span" sx={{ fontSize: "0.75rem" }}>
                Show
              </Box>
            </Box>
          </Box>
        </Box>
      </Stack>
    </Box>
  );
}
