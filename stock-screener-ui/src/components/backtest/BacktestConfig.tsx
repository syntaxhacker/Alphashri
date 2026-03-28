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
  Menu,
  Tooltip,
  Badge,
  ActionIcon,
  Divider,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import {
  IconPlayerPlay,
  IconChevronDown,
  IconChevronUp,
  IconX,
  IconRotate,
  IconPlayerPause,
} from "@tabler/icons-react";
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

const MAX_VISIBLE_CHIPS = 5;

function renderParamInput(param: StrategyParam, value: any, onChange: (value: any) => void) {
  const testId = `param-${param.key}`;

  if (param.type === "select") {
    return (
      <Select
        data-testid={testId}
        value={value ?? param.default}
        onChange={(v) => v && onChange(v)}
        data={(param.options || []).map((opt) => ({ value: opt, label: opt }))}
        size="sm"
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
        size="sm"
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
      size="sm"
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

  const [symbolSearch, setSymbolSearch] = useState("");
  const [symbolOptions, setSymbolOptions] = useState<{ value: string; label: string }[]>([]);
  const [debouncedSearch] = useDebouncedValue(symbolSearch, 300);
  const [symbolsExpanded, setSymbolsExpanded] = useState(false);

  useEffect(() => {
    if (debouncedSearch.trim().length < 1) {
      return;
    }

    searchSymbols(debouncedSearch, 20)
      .then((results) => {
        setSymbolOptions(
          results.map((r) => ({
            value: r.symbol,
            label: `${r.symbol} - ${r.name}`,
          })),
        );
      })
      .catch((err) => {
        console.error("Failed to search symbols:", err);
      });
  }, [debouncedSearch]);

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

  const visibleChips = symbolsExpanded
    ? selectedSymbols
    : selectedSymbols.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenCount = selectedSymbols.length - MAX_VISIBLE_CHIPS;
  const hasOverflow = selectedSymbols.length > MAX_VISIBLE_CHIPS;

  const handleRemoveSymbol = (symbol: string) => {
    onSymbolsChange(selectedSymbols.filter((s) => s !== symbol));
  };

  const handleRunAndSave = () => {
    onSaveToHistoryChange(true);
    onRun();
  };

  return (
    <Paper
      id="config-form"
      className="backtest-config"
      p="sm"
      radius="sm"
      withBorder
      data-testid="strategy-config"
    >
      <Stack gap="xs">
        <Group gap="sm" align="flex-start">
          <Text size="sm" fw={500} w={70} pt={4}>
            Strategy
          </Text>
          <div style={{ flex: 1 }}>
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
          </div>
        </Group>

        <Divider />

        <Group gap="sm" align="flex-start">
          <Text size="sm" fw={500} w={70} pt={4}>
            Symbols
          </Text>
          <div style={{ flex: 1 }}>
            <Group gap={4}>
              <MultiSelect
                id="symbol-multiselect"
                className="config-symbol-multiselect"
                data={symbolOptions}
                value={selectedSymbols}
                onChange={onSymbolsChange}
                searchable
                searchValue={symbolSearch}
                onSearchChange={setSymbolSearch}
                clearable
                hidePickedOptions
                size="sm"
                flex={1}
                nothingFoundMessage="No symbols found"
                maxDropdownHeight={200}
                data-testid="symbol-multiselect"
              />
              {selectedSymbols.length > 0 && (
                <Tooltip label="Clear all symbols">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    onClick={() => onSymbolsChange([])}
                    data-testid="clear-symbols-btn"
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
            {selectedSymbols.length > 0 && (
              <div
                className={`config-symbols-chips ${symbolsExpanded ? "expanded" : ""}`}
                data-testid="symbol-chips"
              >
                {visibleChips.map((symbol) => (
                  <Badge
                    key={symbol}
                    variant="outline"
                    size="sm"
                    className="symbol-chip"
                    rightSection={
                      <IconX
                        size={10}
                        style={{ cursor: "pointer" }}
                        onClick={() => handleRemoveSymbol(symbol)}
                      />
                    }
                    data-testid={`chip-${symbol}`}
                  >
                    {symbol}
                  </Badge>
                ))}
                {hasOverflow && !symbolsExpanded && (
                  <Badge
                    variant="light"
                    color="gray"
                    size="sm"
                    className="symbol-chip symbol-expand-toggle"
                    onClick={() => setSymbolsExpanded(true)}
                    style={{ cursor: "pointer" }}
                    rightSection={<IconChevronDown size={10} />}
                  >
                    +{hiddenCount} more
                  </Badge>
                )}
                {symbolsExpanded && hasOverflow && (
                  <Badge
                    variant="light"
                    color="gray"
                    size="sm"
                    className="symbol-chip symbol-expand-toggle"
                    onClick={() => setSymbolsExpanded(false)}
                    style={{ cursor: "pointer" }}
                    rightSection={<IconChevronUp size={10} />}
                  >
                    Less
                  </Badge>
                )}
              </div>
            )}
          </div>
        </Group>

        <Divider />

        <div>
          {strategy && strategy.params.length > 0 ? (
            <Group gap="sm" align="flex-start">
              <Text size="sm" fw={500} w={70} pt={4}>
                Params
              </Text>
              <div className="config-params-row" style={{ flex: 1 }}>
                {strategy.params.map((param) => (
                  <Tooltip key={param.key} label={param.label} withArrow>
                    <Group gap={4} align="center">
                      <Text size="xs" c="dimmed">
                        {param.label}
                      </Text>
                      {renderParamInput(param, params[param.key], (value) =>
                        onParamChange(param.key, value),
                      )}
                    </Group>
                  </Tooltip>
                ))}
              </div>
            </Group>
          ) : (
            <Group gap="sm" align="center">
              <Text size="sm" fw={500} w={70}>
                Params
              </Text>
              <Text size="sm" c="dimmed">
                Select a strategy to configure parameters
              </Text>
            </Group>
          )}
        </div>

        <Divider />

        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <Group gap="sm" align="center">
            <Tooltip label="Backtest period in days" withArrow>
              <Group gap={4} align="center">
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
                  w={65}
                />
              </Group>
            </Tooltip>

            <Tooltip label="Include brokerage and slippage costs" withArrow>
              <Checkbox
                data-testid="include-costs-checkbox"
                label="Include Costs"
                checked={includeCosts}
                onChange={(e) => onIncludeCostsChange(e.currentTarget.checked)}
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
                >
                  Run Backtest
                </Menu.Item>
                <Menu.Item
                  onClick={handleRunAndSave}
                  disabled={isRunning || selectedSymbols.length === 0}
                  leftSection={<IconPlayerPlay size={14} />}
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
