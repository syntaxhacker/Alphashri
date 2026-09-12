// BacktestToolbar — always-visible control strip above the full-bleed chart.
// Owns window toggles + a quick Run / Reset so the chart is never blocked.
import { Box, Button, Text } from "@/ui";
import { IconPlayerPlay, IconLayoutGrid, IconAdjustments, IconTable, IconList } from "@tabler/icons-react";
import type { BacktestWindowId } from "./useBacktestWindows";

interface BacktestToolbarProps {
  strategyLabel: string;
  symbolCount: number;
  days: number;
  isRunning: boolean;
  canRun: boolean;
  openWindows: Record<BacktestWindowId, boolean>;
  onToggleWindow: (id: BacktestWindowId) => void;
  onRun: () => void;
  onReset: () => void;
}

const TOGGLES: { id: BacktestWindowId; label: string; icon: React.ReactNode }[] = [
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
  openWindows,
  onToggleWindow,
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
          const active = openWindows[t.id];
          return (
            <Button
              key={t.id}
              size="sm"
              variant={active ? "filled" : "subtle"}
              color={active ? "primary" : "secondary"}
              onClick={() => onToggleWindow(t.id)}
              leftSection={t.icon}
              data-testid={`toolbar-toggle-${t.id}`}
            >
              {t.label}
            </Button>
          );
        })}
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
