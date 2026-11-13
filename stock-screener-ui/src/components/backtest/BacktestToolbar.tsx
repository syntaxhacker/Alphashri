// BacktestToolbar — always-visible control strip above the full-bleed chart.
// Chart mode + Run/Reset live here; right-rail panels collapse from their own headers.
import { Button, Text, Box } from "@/ui";
import * as palette from "@/ui/palette";
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

export function BacktestToolbar(props: BacktestToolbarProps) {
  return (
    <Box
      className="flex-shrink-0 h-10 flex items-center gap-2 px-2 border-b border-fin-border"
      style={{
        flex: "0 0 auto",
        height: "40px",
        display: "flex",
        "align-items": "center",
        gap: "8px",
        "padding-left": "8px",
        "padding-right": "8px",
        "background-color": palette.SURFACE,
        "border-bottom": `1px solid ${palette.BROWN}`,
      }}
      data-testid="backtest-toolbar"
    >
      <Box className="flex items-center gap-1">
        <Button
          size="sm"
          variant={props.chartMode === "all" ? "filled" : "subtle"}
          color={props.chartMode === "all" ? "primary" : "secondary"}
          onClick={() => props.onChartModeChange("all")}
          data-testid="chart-mode-all"
          data-state={chartMode === "all" ? "active" : "inactive"}
        >
          All trades
        </Button>
        <Button
          size="sm"
          variant={props.chartMode === "trades" ? "filled" : "subtle"}
          color={props.chartMode === "trades" ? "primary" : "secondary"}
          onClick={() => props.onChartModeChange("trades")}
          data-testid="chart-mode-trades"
          data-state={chartMode === "trades" ? "active" : "inactive"}
        >
          Per trade
        </Button>
      </Box>

      <Box className="flex-1 min-w-0 flex items-center gap-1.5 px-2">
        <Text size="xs" c="dimmed" style={{ "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
          {props.strategyLabel || "No strategy"}
        </Text>
        <Text size="xs" c="dimmed" style={{ "white-space": "nowrap" }}>
          {props.symbolCount} symbol{props.symbolCount === 1 ? "" : "s"} · {props.days}d
        </Text>
      </Box>

      <Button
        size="sm"
        variant="filled"
        onClick={props.onRun}
        disabled={!props.canRun || props.isRunning}
        loading={props.isRunning}
        leftSection={props.isRunning ? undefined : <IconPlayerPlay size={12} />}
        data-testid="toolbar-run-btn"
      >
        {props.isRunning ? null : "Run"}
      </Button>
      <Button
        size="sm"
        variant="subtle"
        color="secondary"
        onClick={props.onReset}
        leftSection={<IconLayoutGrid size={12} />}
        data-testid="toolbar-reset-layout"
      >
        Reset layout
      </Button>
    </Box>
  );
}
