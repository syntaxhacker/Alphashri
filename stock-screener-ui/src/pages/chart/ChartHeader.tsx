import { Box, Button, Text, ToolbarRow } from "@/ui";
import { ChartControls } from "./ChartControls";

interface ChartHeaderProps {
  symbol: string;
  timeframe: number;
  orMinutes: number;
  showPivots: boolean;
  show52wHigh: boolean;
  onBack: () => void;
  onTimeframeChange: (value: number) => void;
  onOrMinutesChange: (value: number) => void;
  onPivotsChange: (checked: boolean) => void;
  on52wHighChange: (checked: boolean) => void;
}

export function ChartHeader({
  symbol,
  timeframe,
  orMinutes,
  showPivots,
  show52wHigh,
  onBack,
  onTimeframeChange,
  onOrMinutesChange,
  onPivotsChange,
  on52wHighChange,
}: ChartHeaderProps) {
  return (
    <ToolbarRow
      id="chart-header"
      data-testid="chart-header"
      gap={8}
      justify="space-between"
      wrap={false}
      clip
      style={{
        height: 48,
        minHeight: 48,
        maxHeight: 48,
        paddingLeft: 12,
        paddingRight: 12,
        borderBottom: "1px solid var(--mui-palette-divider)",
        width: "100%",
        flexShrink: 0,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 0 }}>
        <Button size="xs" variant="subtle" onClick={onBack} data-testid="chart-back-btn">
          ← Back
        </Button>
        <Text size="md" fw={700} data-testid="chart-title" truncate>
          {symbol}
        </Text>
      </Box>
      <ChartControls
        timeframe={timeframe}
        orMinutes={orMinutes}
        showPivots={showPivots}
        show52wHigh={show52wHigh}
        onTimeframeChange={onTimeframeChange}
        onOrMinutesChange={onOrMinutesChange}
        onPivotsChange={onPivotsChange}
        on52wHighChange={on52wHighChange}
      />
    </ToolbarRow>
  );
}
