// BacktestToolbar — always-visible control strip above the chart. Chart mode +
// Run/Reset live here; right-rail panels collapse from their own headers.
import { Button, Text, Box, ToolbarRow } from "@/ui";
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
  const presetLabel = () => props.strategyLabel || "No strategy";
  const metaLabel = () =>
    `${props.symbolCount} symbol${props.symbolCount === 1 ? "" : "s"} · ${props.days}d`;
  // The full preset stays reachable on hover even when the visible text ellipsizes.
  const presetTitle = () => `${presetLabel()} · ${metaLabel()}`;

  return (
    <ToolbarRow
      gap={8}
      className="w-full px-2 py-1.5"
      style={{
        "min-height": "40px",
        "background-color": palette.SURFACE,
        "border-bottom": `1px solid ${palette.BROWN}`,
      }}
      data-testid="backtest-toolbar"
    >
      <Box className="flex flex-shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant={props.chartMode === "all" ? "filled" : "subtle"}
          color={props.chartMode === "all" ? "primary" : "secondary"}
          onClick={() => props.onChartModeChange("all")}
          data-testid="chart-mode-all"
          data-state={props.chartMode === "all" ? "active" : "inactive"}
        >
          All trades
        </Button>
        <Button
          size="sm"
          variant={props.chartMode === "trades" ? "filled" : "subtle"}
          color={props.chartMode === "trades" ? "primary" : "secondary"}
          onClick={() => props.onChartModeChange("trades")}
          data-testid="chart-mode-trades"
          data-state={props.chartMode === "trades" ? "active" : "inactive"}
        >
          Per trade
        </Button>
      </Box>

      <Box className="flex min-w-0 flex-1 items-center gap-1.5">
        <Text
          size="xs"
          c="dimmed"
          span
          truncate
          className="min-w-0"
          title={presetTitle()}
          data-testid="backtest-preset-label"
        >
          {presetLabel()}
        </Text>
        <Text size="xs" c="dimmed" span className="hidden flex-shrink-0 sm:inline">
          {metaLabel()}
        </Text>
      </Box>

      <Box className="ml-auto flex flex-shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="filled"
          onClick={props.onRun}
          disabled={!props.canRun || props.isRunning}
          loading={props.isRunning}
          leftSection={
            props.isRunning ? undefined : (
              <span className="hidden sm:inline-flex">
                <IconPlayerPlay size={12} />
              </span>
            )
          }
          aria-label="Run backtest"
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
          aria-label="Reset layout"
          title="Reset layout"
          data-testid="toolbar-reset-layout"
        >
          <span className="hidden sm:inline">Reset layout</span>
        </Button>
      </Box>
    </ToolbarRow>
  );
}
