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
      id="config-form"
      p="sm"
      radius="sm"
      data-testid="strategy-config"
    >
      <Stack spacing={1}>
        <Group gap="sm" align="flex-start">
          <Text size="sm" fw={500} sx={{ width: 70, pt: 0.5 }}>
            Strategy
          </Text>
          <Box flex={1}>
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
            {selectedVariationData?.description && (
              <Text size="xs" c="dimmed" mt={2}>
                {selectedVariationData.description}
              </Text>
            )}
          </Box>
        </Group>

        <Divider />

        <Group gap="sm" align="flex-start">
          <Text size="sm" fw={500} sx={{ width: 70, pt: 0.5 }}>
            Symbols
          </Text>
          <Box flex={1}>
            <SymbolChips selectedSymbols={selectedSymbols} onSymbolsChange={onSymbolsChange} />
          </Box>
        </Group>

        <Divider />

        <Box>
          {strategy && strategy.params.length > 0 ? (
            <Group gap="sm" align="flex-start">
              <Text size="sm" fw={500} sx={{ width: 70, pt: 0.5 }}>
                Params
              </Text>
              <Box flex={1} sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                {strategy.params.map((param) => (
                  <Tooltip key={param.key} label={param.label} withArrow>
                    <Group gap={1} align="center">
                      <Text size="xs" c="dimmed">
                        {param.label}
                      </Text>
                      <ParamInput
                        param={param}
                        value={params[param.key]}
                        onChange={(value) => onParamChange(param.key, value)}
                      />
                    </Group>
                  </Tooltip>
                ))}
              </Box>
            </Group>
          ) : (
            <Group gap="sm" align="center">
              <Text size="sm" fw={500} sx={{ width: 70 }}>
                Params
              </Text>
              <Text size="sm" c="dimmed">
                Select a strategy to configure parameters
              </Text>
            </Group>
          )}
        </Box>

        <Divider />

        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <Group gap="sm" align="center">
            <Tooltip label="Backtest period in days" withArrow>
              <Group gap={1} align="center">
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
              </Group>
            </Tooltip>

            <Tooltip label="Include brokerage and slippage costs" withArrow>
              <Checkbox
                data-testid="include-costs-checkbox"
                label="Include Costs"
                checked={includeCosts}
                onChange={(checked) => onIncludeCostsChange(checked)}
                size="sm"
              />
            </Tooltip>
          </Group>

          <Group gap="xs" align="center">
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
          </Group>
        </Group>
      </Stack>
    </Paper>
  );
}
