// BacktestToolbar — always-visible control strip above the full-bleed chart.
// Chart mode + Run/Reset live here; right-rail panels collapse from their own headers.
import { Button, Text, Box } from "@/ui";
import { IconPlayerPlay, IconLayoutGrid } from "@/components/common/Icons";
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
      className="flex-shrink-0 h-10 flex items-center gap-2 px-2 border-b border-fin-border"
      style={{
        flex: "0 0 auto",
        height: 40,
        display: "flex",
        "align-items": "center",
        gap: 8,
        "padding-left": 8,
        "padding-right": 8,
        "background-color": "#0A0A0A",
        "border-bottom": "1px solid #30363D",
      }}
      data-testid="backtest-toolbar"
    >
      <Box className="flex items-center gap-1">
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

      <Box className="flex-1 min-w-0 flex items-center gap-1.5 px-2">
        <Text size="xs" c="dimmed" style={{ "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
          {strategyLabel || "No strategy"}
        </Text>
        <Text size="xs" c="dimmed" style={{ "white-space": "nowrap" }}>
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
