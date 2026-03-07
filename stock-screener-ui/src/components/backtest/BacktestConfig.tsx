import { useState, useCallback } from "react";
import {
  Group,
  Select,
  NumberInput,
  Checkbox,
  Button,
  Badge,
  TextInput,
  Text,
  ActionIcon,
} from "@mantine/core";
import { IconX, IconPlayerPlay, IconRefresh } from "@tabler/icons-react";
import type { Strategy, StrategyParam } from "../../types/backtest";

interface BacktestConfigProps {
  strategies: Strategy[];
  selectedStrategy: string;
  params: Record<string, any>;
  selectedSymbols: string[];
  days: number;
  includeCosts: boolean;
  isRunning: boolean;
  onStrategyChange: (strategyId: string) => void;
  onParamChange: (key: string, value: any) => void;
  onDaysChange: (days: number) => void;
  onIncludeCostsChange: (include: boolean) => void;
  onSymbolAdd: (symbol: string) => void;
  onSymbolRemove: (symbol: string) => void;
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
        w={100}
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
      w={80}
    />
  );
}

export function BacktestConfig({
  strategies,
  selectedStrategy,
  params,
  selectedSymbols,
  days,
  includeCosts,
  isRunning,
  onStrategyChange,
  onParamChange,
  onDaysChange,
  onIncludeCostsChange,
  onSymbolAdd,
  onSymbolRemove,
  onReset,
  onRun,
}: BacktestConfigProps) {
  const [newSymbol, setNewSymbol] = useState("");

  const strategy = strategies.find((s) => s.id === selectedStrategy);

  const handleAddSymbol = useCallback(() => {
    const symbol = newSymbol.trim().toUpperCase();
    if (symbol && !selectedSymbols.includes(symbol)) {
      onSymbolAdd(symbol);
      setNewSymbol("");
    }
  }, [newSymbol, selectedSymbols, onSymbolAdd]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddSymbol();
      }
    },
    [handleAddSymbol],
  );

  return (
    <Group gap="md" align="flex-end" wrap="wrap" data-testid="strategy-config">
      <Group gap="xs" align="center">
        <Text size="xs" c="dimmed">
          Strategy
        </Text>
        <Select
          data-testid="strategy-select"
          value={selectedStrategy}
          onChange={(v) => v && onStrategyChange(v)}
          data={strategies.map((s) => ({ value: s.id, label: s.name }))}
          size="xs"
          w={150}
        />
      </Group>

      {strategy?.params.map((param) => (
        <Group key={param.key} gap="xs" align="center">
          <Text size="xs" c="dimmed">
            {param.label}
          </Text>
          {renderParamInput(param, params[param.key], (value) => onParamChange(param.key, value))}
        </Group>
      ))}

      <Group gap="xs" align="center">
        <Text size="xs" c="dimmed">
          Stocks
        </Text>
        <Group gap={4} align="center" data-testid="symbols-input">
          {selectedSymbols.map((symbol) => (
            <Badge
              key={symbol}
              size="sm"
              variant="light"
              pr={4}
              data-testid={`symbol-tag-${symbol}`}
              rightSection={
                <ActionIcon
                  size={14}
                  radius="xl"
                  variant="transparent"
                  onClick={() => onSymbolRemove(symbol)}
                  data-testid={`remove-symbol-${symbol}`}
                >
                  <IconX size={10} />
                </ActionIcon>
              }
            >
              {symbol}
            </Badge>
          ))}
          <TextInput
            placeholder="+ Add"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            size="xs"
            w={80}
            data-testid="add-symbol-input"
          />
        </Group>
      </Group>

      <Group gap="xs" align="center">
        <Text size="xs" c="dimmed">
          Days
        </Text>
        <NumberInput
          data-testid="days-input"
          value={days}
          onChange={(v) => onDaysChange(Number(v) || 30)}
          min={30}
          max={365}
          step={30}
          size="xs"
          w={80}
        />
      </Group>

      <Checkbox
        data-testid="include-costs-checkbox"
        label="Costs"
        checked={includeCosts}
        onChange={(e) => onIncludeCostsChange(e.currentTarget.checked)}
        size="xs"
      />

      <Group gap="xs">
        <Button
          variant="light"
          size="xs"
          onClick={onReset}
          data-testid="reset-btn"
          leftSection={<IconRefresh size={14} />}
        >
          Reset
        </Button>
        <Button
          variant="filled"
          size="xs"
          onClick={onRun}
          disabled={isRunning || selectedSymbols.length === 0}
          loading={isRunning}
          data-testid="run-backtest-btn"
          leftSection={!isRunning && <IconPlayerPlay size={14} />}
        >
          {isRunning ? "Running..." : "Run"}
        </Button>
      </Group>
    </Group>
  );
}
