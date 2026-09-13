// BacktestToolbar — always-visible control strip above the full-bleed chart.
// Panel toggles expand/collapse the right-rail panels; Run/Reset are always here.
import { Box, Button, Text } from "@/ui";
import { IconPlayerPlay, IconLayoutGrid, IconAdjustments, IconTable, IconList } from "@tabler/icons-react";
import type { BacktestPanelId } from "./useBacktestLayout";

interface BacktestToolbarProps {
  strategyLabel: string;
  symbolCount: number;
  days: number;
  isRunning: boolean;
  canRun: boolean;
  panels: Record<BacktestPanelId, boolean>;
  chartMode: "all" | "trades";
  onTogglePanel: (id: BacktestPanelId) => void;
  onChartModeChange: (mode: "all" | "trades") => void;
  onRun: () => void;
  onReset: () => void;
}

const TOGGLES: { id: BacktestPanelId; label: string; icon: React.ReactNode }[] = [
  { id: "config", label: "Config", icon: <IconAdjustments size={12} /> },
  { id: "results", label: "Results", icon: <IconTable size={12} /> },
  { id: "trades", label: "Trades", icon: <IconList size={12} /> },
];

export function BacktestToolbar({
  strategyLabel,
  symbolCount,
  days,
  isRunning,
  canRun,
  panels,
  chartMode,
  onTogglePanel,
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
        {TOGGLES.map((t) => {
          const open = panels[t.id];
          return (
            <Button
              key={t.id}
              size="sm"
              variant={open ? "filled" : "subtle"}
              color={open ? "primary" : "secondary"}
              onClick={() => onTogglePanel(t.id)}
              leftSection={t.icon}
              data-testid={`toolbar-toggle-${t.id}`}
              data-state={open ? "open" : "closed"}
              title={open ? `Collapse ${t.label}` : `Expand ${t.label}`}
            >
              {t.label}
            </Button>
          );
        })}
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, pl: 1, borderLeft: "1px solid", borderColor: "divider" }}>
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
        leftSection={<IconPlayerPlay size={12} />}
        data-testid="toolbar-run-btn"
      >
        {isRunning ? "Running..." : "Run"}
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
