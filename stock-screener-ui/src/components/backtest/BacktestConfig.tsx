import { useEffect, useMemo } from "react";
import {
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
  onRunAndSave: () => void;
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
  onRunAndSave,
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
      ...variations
        .filter((v) => v.is_template)
        .map((v) => ({ value: v.id, label: `${v.name} (${v.strategy_type})` })),
      ...variations
        .filter((v) => !v.is_template)
        .map((v) => ({ value: v.id, label: v.name })),
    ],
    [variations],
  );

  const handleRunAndSave = () => {
    onSaveToHistoryChange(true);
    onRunAndSave();
  };

  return (
    <Paper
      elevation={1}
      id="config-form"
      radius="sm"
      data-testid="strategy-config"
      sx={{ p: "8px 10px", display: "flex", flexDirection: "column", gap: "8px" }}
    >
      {/* Row 1 — strategy + symbols */}
      <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Box sx={{ minWidth: 300, flex: "1 1 360px", display: "flex", flexDirection: "column", gap: "2px" }}>
          <Text size="xs" c="dimmed" fw={700} sx={{ letterSpacing: 0.6, textTransform: "uppercase" }}>
            Strategy
          </Text>
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
            <Text size="xs" c="dimmed" sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectedVariationData.description}
            </Text>
          )}
        </Box>
        <Box sx={{ minWidth: 280, flex: "2 1 420px", display: "flex", flexDirection: "column", gap: "2px" }}>
          <Text size="xs" c="dimmed" fw={700} sx={{ letterSpacing: 0.6, textTransform: "uppercase" }}>
            Symbols
          </Text>
          <SymbolChips selectedSymbols={selectedSymbols} onSymbolsChange={onSymbolsChange} />
        </Box>
      </Box>

      <Divider />

      {/* Row 2 — parameters + run controls */}
      <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-end", flexWrap: "wrap" }}>
        <Box sx={{ minWidth: 240, flex: "1 1 auto", display: "flex", flexDirection: "column", gap: "2px" }}>
          <Text size="xs" c="dimmed" fw={700} sx={{ letterSpacing: 0.6, textTransform: "uppercase" }}>
            Parameters
          </Text>
          {strategy && strategy.params.length > 0 ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              {strategy.params.map((param) => (
                <Tooltip key={param.key} label={param.label} withArrow>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Text size="xs" c="text.secondary">{param.label}</Text>
                    <ParamInput
                      param={param}
                      value={params[param.key]}
                      onChange={(value) => onParamChange(param.key, value)}
                    />
                  </Box>
                </Tooltip>
              ))}
            </Box>
          ) : (
            <Text size="xs" c="dimmed">Select a strategy to configure parameters</Text>
          )}
        </Box>

        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1.25, flexWrap: "wrap" }}>
          <Tooltip label="Backtest period in days" withArrow>
            <Box sx={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <Text size="xs" c="dimmed" fw={700} sx={{ letterSpacing: 0.6, textTransform: "uppercase" }}>
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
                w={68}
              />
            </Box>
          </Tooltip>

          <Tooltip label="Include brokerage and slippage costs" withArrow>
            <Box sx={{ display: "flex", alignItems: "center", pb: 0.25 }}>
              <Checkbox
                data-testid="include-costs-checkbox"
                label="Include Costs"
                checked={includeCosts}
                onChange={(checked) => onIncludeCostsChange(checked)}
                size="sm"
              />
            </Box>
          </Tooltip>

          <Tooltip label="Ctrl+Enter to run" withArrow>
            <Button
              variant="filled"
              size="sm"
              onClick={onRun}
              disabled={isRunning || selectedSymbols.length === 0}
              loading={isRunning}
              data-testid="run-backtest-btn"
              leftSection={isRunning ? <IconPlayerPause size={12} /> : <IconPlayerPlay size={12} />}
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
                color="secondary"
                leftSection={<IconRotate size={14} />}
                data-testid="reset-btn"
              >
                Reset Config
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Box>
      </Box>
    </Paper>
  );
}
