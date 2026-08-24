import {
  Paper,
  Stack,
  Group,
  Select,
  Checkbox,
  Button,
  Text,
  TextInput,
  Divider,
  NumberInput,
  Badge,
  Box,
  ActionIcon,
  Tooltip,
} from "@/ui";
import { IconPlus, IconX, IconPlayerPlay, IconRotate } from "@tabler/icons-react";
import type { StrategyParam, SweepParam } from "../../types/experiments";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  getExperimentState,
  subscribe,
  setConfig,
  setFixedParam,
  setSweep,
  addSweepParam,
  removeSweepParam,
  resetConfig,
  startExperiment,
} from "../../state/experiments";
import { getSweepGridSize } from "../../api/experiments";
import { SymbolChips } from "../backtest/SymbolChips";

const TIMEFRAMES = [
  { value: "5", label: "5m" },
  { value: "10", label: "10m" },
  { value: "15", label: "15m" },
  { value: "60", label: "60m" },
];

function ParamValueInput({
  param,
  value,
  testId,
  onChange,
}: {
  param: StrategyParam;
  value: any;
  testId: string;
  onChange: (value: number | string | boolean) => void;
}) {
  if (param.type === "select") {
    return (
      <Select
        data-testid={testId}
        value={String(value ?? param.default)}
        onChange={(v) => v != null && onChange(v)}
        data={(param.options || []).map((opt) => ({ value: opt, label: opt }))}
        size="sm"
        sx={{ width: 90 }}
      />
    );
  }

  if (param.type === "boolean") {
    return (
      <Checkbox
        data-testid={testId}
        checked={Boolean(value ?? param.default)}
        onChange={(e) => onChange(e.currentTarget.checked)}
        size="sm"
      />
    );
  }

  return (
    <NumberInput
      data-testid={testId}
      value={Number(value ?? param.default)}
      onChange={(v) => onChange(Number(v))}
      min={param.min}
      max={param.max}
      step={param.step ?? 1}
      size="sm"
      sx={{ width: 70 }}
    />
  );
}

function nextSweepValue(
  param: StrategyParam,
  sweep: SweepParam | undefined,
): number | string | boolean {
  if (param.type === "number" && param.step) {
    const last = sweep?.values[sweep.values.length - 1];
    if (typeof last === "number") {
      return Math.round((last + param.step) * 100) / 100;
    }
  }
  return param.default;
}

export function ExperimentsConfig() {
  useStoreSubscription(subscribe);
  const s = getExperimentState();
  const { strategies, config, fixedParams, sweeps, state: expState } = s;

  const strategy = strategies.find((st) => st.key === config.strategy);
  const running = expState?.status === "running";
  const hasSymbols = config.symbols.length > 0;
  const hasSweepValues = sweeps.some((sw) => sw.values.length > 0);

  const grid = getSweepGridSize(sweeps);
  const candidates = grid * config.symbols.length;
  const tooLarge = candidates > 500;

  const updateSweepValue = (key: string, index: number, value: number | string | boolean) => {
    const sweep = sweeps.find((sw) => sw.key === key);
    if (!sweep) return;
    setSweep(key, sweep.values.map((v, i) => (i === index ? value : v)));
  };

  const removeSweepValue = (key: string, index: number) => {
    const sweep = sweeps.find((sw) => sw.key === key);
    if (!sweep) return;
    setSweep(key, sweep.values.filter((_, i) => i !== index));
  };

  const addSweepValue = (param: StrategyParam, sweep: SweepParam) => {
    setSweep(param.key, [...sweep.values, nextSweepValue(param, sweep)]);
  };

  return (
    <Paper elevation={0} sx={{ p: 1, display: "flex", flexDirection: "column", gap: 1, width: "100%", alignItems: "center" }} data-testid="experiments-config">
      <Stack gap={1} sx={{ width: "100%", alignItems: "stretch" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
          <Box sx={{ width: 90, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Text size="sm" fw={500}>
              Strategy
            </Text>
          </Box>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <Select
              data-testid="experiments-strategy-select"
              value={config.strategy}
              onChange={(v) => v && setConfig({ strategy: v })}
              data={strategies.map((st) => ({ value: st.key, label: st.key }))}
              size="sm"
              searchable
            />
          </Box>
        </Box>

        <Divider />

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, flexWrap: "wrap" }}>
          <Box sx={{ width: 90, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Text size="sm" fw={500}>
              Symbols
            </Text>
          </Box>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }} data-testid="experiments-symbol-chips">
            <SymbolChips
              selectedSymbols={config.symbols}
              onSymbolsChange={(symbols) => setConfig({ symbols })}
            />
          </Box>
        </Box>

        <Divider />

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, flexWrap: "wrap" }}>
          <Tooltip label="Timeframe in minutes" withArrow>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
              <Text size="xs" c="dimmed">
                TF
              </Text>
              <Select
                data-testid="experiments-tf-select"
                value={String(config.tf)}
                onChange={(v) => v && setConfig({ tf: Number(v) })}
                data={TIMEFRAMES}
                size="sm"
                sx={{ width: 70 }}
              />
            </Box>
          </Tooltip>
          <TextInput
            data-testid="experiments-date-start"
            label="From"
            type="date"
            size="sm"
            value={config.dateStart}
            onChange={(v) => setConfig({ dateStart: v })}
          />
          <TextInput
            data-testid="experiments-date-end"
            label="To"
            type="date"
            size="sm"
            value={config.dateEnd}
            onChange={(v) => setConfig({ dateEnd: v })}
          />
          <Checkbox
            data-testid="experiments-costs-checkbox"
            label="Include costs"
            checked={config.includeCosts}
            onChange={(e) => setConfig({ includeCosts: e.currentTarget.checked })}
            size="sm"
          />
        </Box>

        <TextInput
          data-testid="experiments-description"
          placeholder="Experiment description (optional)"
          size="sm"
          value={config.description}
          onChange={(v) => setConfig({ description: v })}
        />

        <Divider />

        <Box sx={{ p: 1, width: "100%" }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
            <Text size="sm" fw={500}>
              Sweep space
            </Text>
          </Box>
          {strategy && strategy.params.length > 0 ? (
            <Stack gap={1} sx={{ alignItems: "stretch" }}>
              {strategy.params.map((param) => {
                const sweep = sweeps.find((sw) => sw.key === param.key);
                return (
                  <Box
                    key={param.key}
                    sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, flexWrap: "wrap", p: 1 }}
                    data-testid={`sweep-param-${param.key}`}
                  >
                    <Box sx={{ width: 110, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Text size="xs" c="dimmed">
                        {param.label}
                      </Text>
                    </Box>
                    {sweep ? (
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, flexWrap: "wrap" }}>
                        {sweep.values.map((value, idx) => (
                          <Box key={idx} sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
                            <ParamValueInput
                              param={param}
                              value={value}
                              testId={`sweep-value-${param.key}-${idx}`}
                              onChange={(v) => updateSweepValue(param.key, idx, v)}
                            />
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              color="gray"
                              data-testid={`sweep-value-remove-${param.key}-${idx}`}
                              onClick={() => removeSweepValue(param.key, idx)}
                            >
                              <IconX size={12} />
                            </ActionIcon>
                          </Box>
                        ))}
                        <Button
                          size="xs"
                          variant="outline"
                          data-testid={`sweep-value-add-${param.key}`}
                          leftSection={<IconPlus size={12} />}
                          onClick={() => addSweepValue(param, sweep)}
                        >
                          Add
                        </Button>
                      </Box>
                    ) : (
                      <ParamValueInput
                        param={param}
                        value={fixedParams[param.key] ?? param.default}
                        testId={`fixed-param-${param.key}`}
                        onChange={(v) => setFixedParam(param.key, v)}
                      />
                    )}
                    {sweep ? (
                      <Button
                        size="xs"
                        variant="light"
                        color="teal"
                        data-testid={`sweep-remove-${param.key}`}
                        onClick={() => removeSweepParam(param.key)}
                      >
                        Sweep on
                      </Button>
                    ) : (
                      <Button
                        size="xs"
                        variant="outline"
                        data-testid={`sweep-add-${param.key}`}
                        onClick={() => addSweepParam(param.key)}
                      >
                        Add to sweep
                      </Button>
                    )}
                  </Box>
                );
              })}
            </Stack>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
              <Text size="sm" c="dimmed">
                Select a strategy to configure sweep parameters
              </Text>
            </Box>
          )}
        </Box>

        <Divider />

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap", p: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
            <Text size="sm" data-testid="experiments-candidates-count">
              candidates = {grid} x {config.symbols.length} symbols = {candidates}
            </Text>
            {tooLarge && (
              <Badge
                color="red"
                size="sm"
                variant="outline"
                data-testid="experiments-candidates-warning"
              >
                {candidates} &gt; 500 — large grid
              </Badge>
            )}
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
            <Button
              variant="filled"
              size="sm"
              data-testid="experiments-start-btn"
              leftSection={<IconPlayerPlay size={12} />}
              disabled={!hasSymbols || !hasSweepValues || running || tooLarge}
              loading={running}
              onClick={() => void startExperiment()}
            >
              Start
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="experiments-reset-btn"
              leftSection={<IconRotate size={12} />}
              onClick={() => resetConfig()}
            >
              Reset
            </Button>
          </Box>
        </Box>
      </Stack>
    </Paper>
  );
}
