import { useEffect, useMemo } from "react";
import {
  Stack,
  Group,
  Select,
  NumberInput,
  Checkbox,
  Button,
  Text,
  Paper,
  Menu,
  Box,
  Tooltip,
  Divider,
} from "@/ui";
import { IconPlayerPlay, IconChevronDown, IconRotate, IconPlayerPause } from "@tabler/icons-react";
import type { Strategy, StrategyVariation } from "../../types/backtest";
import { ParamInput } from "./ParamInput";
import { SymbolChips } from "./SymbolChips";

interface BacktestConfigProps {
  strategies: Strategy[];
  variations: StrategyVariation[];
  selectedStrategy: string;
  selectedVariation: string | null;
  params: Record<string, any>;
  selectedSymbols: string[];
  days: number;
  includeCosts: boolean;
  isRunning: boolean;
  saveToHistory: boolean;
  onStrategyChange: (strategyId: string) => void;
  onVariationChange: (variationId: string | null) => void;
  onParamChange: (key: string, value: any) => void;
  onDaysChange: (days: number) => void;
  onIncludeCostsChange: (include: boolean) => void;
  onSaveToHistoryChange: (save: boolean) => void;
  onSymbolsChange: (symbols: string[]) => void;
  onReset: () => void;
  onRun: () => void;
}

export function BacktestConfig({
  strategies,
  variations,
  selectedStrategy,
  selectedVariation,
  params,
  selectedSymbols,
  days,
  includeCosts,
  isRunning,
  saveToHistory: _saveToHistory,
  onStrategyChange: _onStrategyChange,
  onVariationChange,
  onParamChange,
  onDaysChange,
  onIncludeCostsChange,
  onSaveToHistoryChange,
  onSymbolsChange,
  onReset,
  onRun,
}: BacktestConfigProps) {
  const strategy = strategies.find((s) => s.id === selectedStrategy);
  const selectedVariationData = variations.find((v) => v.id === selectedVariation);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (!isRunning && selectedSymbols.length > 0) {
          onRun();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isRunning, selectedSymbols, onRun]);

  const selectData = useMemo(
    () => [
      {
        group: "Templates (Base Logic)",
        items: variations
          .filter((v) => v.is_template)
          .map((v) => ({
            value: v.id,
            label: `${v.name} (${v.strategy_type})`,
          })),
      },
      {
        group: "Your Variations",
        items: variations
          .filter((v) => !v.is_template)
          .map((v) => ({
            value: v.id,
            label: v.name,
          })),
      },
    ],
    [variations],
  );

  const handleRunAndSave = () => {
    onSaveToHistoryChange(true);
    onRun();
  };

  return (
    <Paper
      elevation={1}
      id="config-form"
      p="sm"
      radius="sm"
      data-testid="strategy-config"
      sx={{ p: 1 }}
    >
      <Stack spacing={1} sx={{ gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }}>
          <Box sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>
            <Text size="sm" fw={500} c="dimmed">Strategy</Text>
          </Box>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", textAlign: "right", flexDirection: "column", alignContent: "stretch" }}>
            <Box sx={{ width: "100%", flex: 1, display: "flex", alignItems: "center" }}>
              <Select
                id="variation-select"
                className="config-variation-select"
                data-testid="variation-select"
                placeholder="Select strategy or template"
                value={selectedVariation}
                onChange={(v) => onVariationChange(v)}
                data={selectData}
                size="sm"
                clearable
                searchable
              />
            </Box>
            {selectedVariationData?.description && (
              <Text size="xs" c="dimmed" sx={{ mt: 0.5, width: "100%", textAlign: "left" }}>
                {selectedVariationData.description}
              </Text>
            )}
          </Box>
        </Box>

        <Divider />

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }}>
          <Box sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>
            <Text size="sm" fw={500} c="dimmed">Symbols</Text>
          </Box>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", textAlign: "right" }}>
            <SymbolChips selectedSymbols={selectedSymbols} onSymbolsChange={onSymbolsChange} />
          </Box>
        </Box>

        <Divider />

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1 }}>
          {strategy && strategy.params.length > 0 ? (
            <>
              <Box sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>
                <Text size="sm" fw={500} c="dimmed">Params</Text>
              </Box>
              <Box sx={{ flex: 1, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1, textAlign: "right", justifyContent: "flex-end" }}>
                {strategy.params.map((param) => (
                  <Tooltip key={param.key} label={param.label} withArrow>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <Text size="xs" c="dimmed">
                        {param.label}
                      </Text>
                      <ParamInput
                        param={param}
                        value={params[param.key]}
                        onChange={(value) => onParamChange(param.key, value)}
                      />
                    </Box>
                  </Tooltip>
                ))}
              </Box>
            </>
          ) : (
            <>
              <Box sx={{ minWidth: 80, display: "flex", alignItems: "center" }}>
                <Text size="sm" fw={500} c="dimmed">Params</Text>
              </Box>
              <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", textAlign: "right" }}>
                <Text size="sm" c="dimmed">
                  Select a strategy to configure parameters
                </Text>
              </Box>
            </>
          )}
        </Box>

        <Divider />

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1, flexWrap: "wrap" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Tooltip label="Backtest period in days" withArrow>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Text size="sm" c="dimmed">
                  Days
                </Text>
                <NumberInput
                  data-testid="days-input"
                  value={days}
                  onChange={(v) => onDaysChange(Number(v) || 30)}
                  min={30}
                  max={365}
                  step={30}
                  size="sm"
                  w={72}
                />
              </Box>
            </Tooltip>

            <Tooltip label="Include brokerage and slippage costs" withArrow>
              <Box sx={{ display: "flex", alignItems: "center" }}>
                <Checkbox
                  data-testid="include-costs-checkbox"
                  label="Include Costs"
                  checked={includeCosts}
                  onChange={(checked) => onIncludeCostsChange(checked)}
                  size="sm"
                />
              </Box>
            </Tooltip>
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Tooltip label="Ctrl+Enter to run" withArrow>
              <Button
                variant="filled"
                size="sm"
                onClick={onRun}
                disabled={isRunning || selectedSymbols.length === 0}
                loading={isRunning}
                data-testid="run-backtest-btn"
                leftSection={
                  isRunning ? <IconPlayerPause size={12} /> : <IconPlayerPlay size={12} />
                }
              >
                {isRunning ? "Running..." : "Run"}
              </Button>
            </Tooltip>
            <Menu>
              <Menu.Target>
                <Button
                  variant="filled"
                  size="sm"
                  disabled={isRunning || selectedSymbols.length === 0}
                  p={0}
                  w={28}
                  data-testid="run-menu-btn"
                  sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <IconChevronDown size={12} />
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  onClick={onRun}
                  disabled={isRunning || selectedSymbols.length === 0}
                  leftSection={<IconPlayerPlay size={14} />}
                  data-testid="menu-run-backtest"
                >
                  Run Backtest
                </Menu.Item>
                <Menu.Item
                  onClick={handleRunAndSave}
                  disabled={isRunning || selectedSymbols.length === 0}
                  leftSection={<IconPlayerPlay size={14} />}
                  data-testid="menu-run-save"
                >
                  Run & Save to History
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  onClick={onReset}
                  color="gray"
                  leftSection={<IconRotate size={14} />}
                  data-testid="reset-btn"
                >
                  Reset Config
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Box>
        </Box>
      </Stack>
    </Paper>
  );
}
