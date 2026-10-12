// BacktestToolbar — always-visible control strip above the full-bleed chart.
// Chart mode + Run/Reset live here; right-rail panels collapse from their own headers.
import { Box, Button, Text } from "@/ui";
import { IconPlayerPlay, IconLayoutGrid } from "@tabler/icons-react";

interface BacktestToolbarProps {
  strategyLabel: string;
  symbolCount: number;
  days: number;
  isRunning: boolean;
  canRun: boolean;
  chartMode: "all" | "trades";
  onChartModeChange: (mode: "all" | "trades") => void;
  onRun: () => void;
  onReset: () => void;
}

export function BacktestToolbar({
  strategyLabel,
  symbolCount,
  days,
  isRunning,
  canRun,
  chartMode,
  onChartModeChange,
  onRun,
  onReset,
}: BacktestToolbarProps) {
  return (
    <Box
      sx={{
        flex: "0 0 auto",
        height: 40,
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        bgcolor: "background.paper",
        borderBottom: "1px solid",
        borderColor: "divider",
      }}
      data-testid="backtest-toolbar"
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Button
          size="sm"
          variant={chartMode === "all" ? "filled" : "subtle"}
          color={chartMode === "all" ? "primary" : "secondary"}
          onClick={() => onChartModeChange("all")}
          data-testid="chart-mode-all"
          data-state={chartMode === "all" ? "active" : "inactive"}
        >
          All trades
        </Button>
        <Button
          size="sm"
          variant={chartMode === "trades" ? "filled" : "subtle"}
          color={chartMode === "trades" ? "primary" : "secondary"}
          onClick={() => onChartModeChange("trades")}
          data-testid="chart-mode-trades"
          data-state={chartMode === "trades" ? "active" : "inactive"}
        >
          Per trade
        </Button>
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 1.5, px: 1 }}>
        <Text size="xs" c="text.secondary" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {strategyLabel || "No strategy"}
        </Text>
        <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
          {symbolCount} symbol{symbolCount === 1 ? "" : "s"} · {days}d
        </Text>
      </Box>

      <Button
        size="sm"
        variant="filled"
        onClick={onRun}
        disabled={!canRun || isRunning}
        loading={isRunning}
        leftSection={isRunning ? undefined : <IconPlayerPlay size={12} />}
        data-testid="toolbar-run-btn"
      >
        {isRunning ? null : "Run"}
      </Button>
      <Button
        size="sm"
        variant="subtle"
        color="secondary"
        onClick={onReset}
        leftSection={<IconLayoutGrid size={12} />}
        data-testid="toolbar-reset-layout"
      >
        Reset layout
      </Button>
    </Box>
  );
}
