import { useEffect, useMemo } from "react";
import {
  Select,
  NumberInput,
  Checkbox,
  Button,
  Menu,
  Box,
  Text,
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

function Field({ label, span, children }: { label?: string; span?: boolean; children: React.ReactNode }) {
  return (
    <Box sx={{ gridColumn: span ? "1 / -1" : undefined, display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
      {label ? (
        <Text size="xs" c="dimmed" fw={700} sx={{ letterSpacing: 0.5, textTransform: "uppercase", fontSize: 10, lineHeight: 1.2 }}>
          {label}
        </Text>
      ) : null}
      {children}
    </Box>
  );
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

  const hasParams = Boolean(strategy && strategy.params.length > 0);

  return (
    <Box
      id="config-form"
      data-testid="strategy-config"
      sx={{ p: "6px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", alignItems: "start" }}
    >
      <Field label="Strategy" span>
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
          w="100%"
        />
        {selectedVariationData?.description && (
          <Text size="xs" c="dimmed" sx={{ mt: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {selectedVariationData.description}
          </Text>
        )}
      </Field>

      <Field label="Symbols" span>
        <SymbolChips selectedSymbols={selectedSymbols} onSymbolsChange={onSymbolsChange} />
      </Field>

      {hasParams ? (
        (strategy as Strategy).params.map((param) => (
          <Field key={param.key} label={param.label}>
            <ParamInput
              param={param}
              value={params[param.key]}
              onChange={(value) => onParamChange(param.key, value)}
            />
          </Field>
        ))
      ) : (
        <Text size="xs" c="dimmed" sx={{ gridColumn: "1 / -1" }}>
          Select a strategy to configure parameters
        </Text>
      )}

      <Field label="Days">
        <NumberInput
          data-testid="days-input"
          value={days}
          onChange={(v) => onDaysChange(Number(v) || 30)}
          min={30}
          max={365}
          step={30}
          size="sm"
          w="100%"
        />
      </Field>

      <Field label="Options">
        <Box sx={{ display: "flex", alignItems: "center", minHeight: 32 }}>
          <Checkbox
            data-testid="include-costs-checkbox"
            label="Include Costs"
            checked={includeCosts}
            onChange={(checked) => onIncludeCostsChange(checked)}
            size="sm"
          />
        </Box>
      </Field>

      <Box sx={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 0.5 }}>
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
  );
}
