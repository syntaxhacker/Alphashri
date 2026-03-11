import { useState, useEffect } from "react";
import {
  Stack,
  Group,
  Select,
  NumberInput,
  Checkbox,
  Button,
  Text,
  Paper,
  MultiSelect,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconPlayerPlay } from "@tabler/icons-react";
import type { Strategy, StrategyParam, StrategyVariation } from "../../types/backtest";
import { searchSymbols } from "../../api/symbols";

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

function renderParamInput(param: StrategyParam, value: any, onChange: (value: any) => void) {
  const testId = `param-${param.key}`;

  if (param.type === "select") {
    return (
      <Select
        data-testid={testId}
        value={value ?? param.default}
        onChange={(v) => v && onChange(v)}
        data={(param.options || []).map((opt) => ({ value: opt, label: opt }))}
        size="xs"
        w={80}
      />
    );
  }

  if (param.type === "boolean") {
    return (
      <Checkbox
        data-testid={testId}
        checked={value ?? param.default}
        onChange={(e) => onChange(e.currentTarget.checked)}
        size="xs"
      />
    );
  }

  return (
    <NumberInput
      data-testid={testId}
      value={value ?? param.default}
      onChange={(v) => onChange(Number(v))}
      min={param.min}
      max={param.max}
      step={param.step ?? 1}
      size="xs"
      w={70}
    />
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
  saveToHistory,
  onStrategyChange,
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

  // Symbol search state for MultiSelect
  const [symbolSearch, setSymbolSearch] = useState("");
  const [symbolOptions, setSymbolOptions] = useState<{ value: string; label: string }[]>([]);
  const [debouncedSearch] = useDebouncedValue(symbolSearch, 300);

  // Fetch symbol options when search changes
  useEffect(() => {
    if (debouncedSearch.trim().length < 1) {
      return;
    }

    searchSymbols(debouncedSearch, 20).then((results) => {
      setSymbolOptions(
        results.map((r) => ({
          value: r.symbol,
          label: `${r.symbol} - ${r.name}`,
        })),
      );
    });
  }, [debouncedSearch]);

  // Group variations for the select dropdown
  const selectData = [
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
  ];

  return (
    <Paper p="sm" radius="sm" withBorder data-testid="strategy-config">
      <Stack gap="xs">
        <Group gap="xs" align="center">
          <Select
            data-testid="variation-select"
            placeholder="Select Strategy or Template"
            value={selectedVariation}
            onChange={(v) => onVariationChange(v)}
            data={selectData}
            size="xs"
            w={250}
            clearable
            searchable
          />

          {strategy?.params.map((param) => (
            <Group key={param.key} gap={4} align="center">
              <Text size="xs" c="dimmed">
                {param.label}
              </Text>
              {renderParamInput(param, params[param.key], (value) =>
                onParamChange(param.key, value),
              )}
            </Group>
          ))}

          <NumberInput
            data-testid="days-input"
            value={days}
            onChange={(v) => onDaysChange(Number(v) || 30)}
            min={30}
            max={365}
            step={30}
            size="xs"
            w={65}
            leftSection={
              <Text size="xs" c="dimmed">
                D
              </Text>
            }
          />

          <Checkbox
            data-testid="include-costs-checkbox"
            label="Costs"
            checked={includeCosts}
            onChange={(e) => onIncludeCostsChange(e.currentTarget.checked)}
            size="xs"
          />

          <Checkbox
            data-testid="save-history-checkbox"
            label="Save"
            checked={saveToHistory}
            onChange={(e) => onSaveToHistoryChange(e.currentTarget.checked)}
            size="xs"
          />

          <Button variant="light" size="xs" onClick={onReset} data-testid="reset-btn" color="gray">
            Reset
          </Button>

          <Button
            variant="filled"
            size="xs"
            onClick={onRun}
            disabled={isRunning || selectedSymbols.length === 0}
            loading={isRunning}
            data-testid="run-backtest-btn"
            leftSection={<IconPlayerPlay size={12} />}
          >
            Run
          </Button>
        </Group>

        <Group gap={4} align="center">
          <MultiSelect
            data={symbolOptions}
            value={selectedSymbols}
            onChange={onSymbolsChange}
            searchable
            searchValue={symbolSearch}
            onSearchChange={setSymbolSearch}
            clearable
            hidePickedOptions
            size="xs"
            w={300}
            nothingFoundMessage="No symbols found"
            maxDropdownHeight={200}
            data-testid="symbol-multiselect"
          />
          {selectedSymbols.length === 0 && (
            <Text size="xs" c="orange">
              Add at least 1 symbol
            </Text>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}
