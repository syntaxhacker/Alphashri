import {
  Paper,
  Stack,
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
import { IconPlus, IconX, IconPlayerPlay, IconRotate } from "../common/Icons";
import { For, Show, createMemo } from "solid-js";
import type { StrategyParam, SweepParam } from "../../types/experiments";
import {
  setConfig,
  setFixedParam,
  setSweep,
  addSweepParam,
  removeSweepParam,
  resetConfig,
  startExperiment,
} from "../../state/experiments";
import { useExperimentState } from "./useExperimentState";
import { getSweepGridSize } from "../../api/experiments";
import { SymbolChips } from "../backtest/SymbolChips";

const TIMEFRAMES = [
  { value: "5", label: "5m" },
  { value: "10", label: "10m" },
  { value: "15", label: "15m" },
  { value: "60", label: "60m" },
];

function ParamValueInput(props: {
  param: StrategyParam;
  value: number | string | boolean | undefined;
  testId: string;
  onChange: (value: number | string | boolean) => void;
}) {
  const value = () => props.value ?? props.param.default;
  if (props.param.type === "select") {
    return (
      <Select
        data-testid={props.testId}
        value={String(value())}
        onChange={(v) => v != null && props.onChange(v)}
        data={(props.param.options || []).map((opt) => ({ value: opt, label: opt }))}
        size="sm"
        w={90}
      />
    );
  }

  if (props.param.type === "boolean") {
    return (
      <Checkbox
        data-testid={props.testId}
        checked={Boolean(value())}
        onChange={(e) => props.onChange((e.currentTarget as HTMLInputElement).checked)}
        size="sm"
      />
    );
  }

  return (
    <NumberInput
      data-testid={props.testId}
      value={Number(value())}
      onChange={(v) => props.onChange(Number(v))}
      min={props.param.min}
      max={props.param.max}
      step={props.param.step ?? 1}
      size="sm"
      w={70}
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
  const state = useExperimentState();
  const strategies = createMemo(() => state().strategies);
  const config = createMemo(() => state().config);
  const fixedParams = createMemo(() => state().fixedParams);
  const sweeps = createMemo(() => state().sweeps);
  const expState = createMemo(() => state().state);

  const strategy = createMemo(() => strategies().find((st) => st.key === config().strategy));
  const running = () => expState()?.status === "running";
  const hasSymbols = () => config().symbols.length > 0;
  const hasSweepValues = () => sweeps().some((sw) => sw.values.length > 0);

  const grid = createMemo(() => getSweepGridSize(sweeps()));
  const candidates = createMemo(() => grid() * config().symbols.length);
  const tooLarge = () => candidates() > 500;

  const updateSweepValue = (key: string, index: number, value: number | string | boolean) => {
    const sweep = sweeps().find((sw) => sw.key === key);
    if (!sweep) return;
    setSweep(key, sweep.values.map((v, i) => (i === index ? value : v)));
  };

  const removeSweepValue = (key: string, index: number) => {
    const sweep = sweeps().find((sw) => sw.key === key);
    if (!sweep) return;
    setSweep(key, sweep.values.filter((_, i) => i !== index));
  };

  const addSweepValue = (param: StrategyParam, sweep: SweepParam) => {
    setSweep(param.key, [...sweep.values, nextSweepValue(param, sweep)]);
  };

  return (
    <Paper elevation={0} p="sm" className="flex flex-col gap-2 w-full items-stretch" data-testid="experiments-config">
      <Stack gap={1} className="w-full items-stretch">
        <Box className="flex items-center justify-start gap-2">
          <Box className="w-[110px] shrink-0">
            <Text size="sm" fw={500}>
              Strategy
            </Text>
          </Box>
          <Box className="flex-1 flex items-center">
            <Select
              data-testid="experiments-strategy-select"
              value={config().strategy}
              onChange={(v) => v && setConfig({ strategy: v })}
              data={strategies().map((st) => ({ value: st.key, label: st.key }))}
              size="sm"
              searchable
            />
          </Box>
        </Box>

        <Divider />

        <Box className="flex items-center justify-start gap-2 flex-wrap">
          <Box className="w-[110px] shrink-0">
            <Text size="sm" fw={500}>
              Symbols
            </Text>
          </Box>
          <Box className="flex-1 flex items-center" data-testid="experiments-symbol-chips">
            <SymbolChips
              selectedSymbols={config().symbols}
              onSymbolsChange={(symbols) => setConfig({ symbols })}
            />
          </Box>
        </Box>

        <Divider />

        <Box className="flex items-center justify-start gap-2 flex-wrap">
          <Tooltip label="Timeframe in minutes" withArrow>
            <Box className="flex items-center gap-2">
              <Text size="xs" c="dimmed">
                TF
              </Text>
              <Select
                data-testid="experiments-tf-select"
                value={String(config().tf)}
                onChange={(v) => v && setConfig({ tf: Number(v) })}
                data={TIMEFRAMES}
                size="sm"
                w={70}
              />
            </Box>
          </Tooltip>
          <TextInput
            data-testid="experiments-date-start"
            label="From"
            type="date"
            size="sm"
            w={150}
            value={config().dateStart}
            onChange={(v) => setConfig({ dateStart: v })}
          />
          <TextInput
            data-testid="experiments-date-end"
            label="To"
            type="date"
            size="sm"
            w={150}
            value={config().dateEnd}
            onChange={(v) => setConfig({ dateEnd: v })}
          />
          <Checkbox
            data-testid="experiments-costs-checkbox"
            label="Include costs"
            checked={config().includeCosts}
            onChange={(e) => setConfig({ includeCosts: e.currentTarget.checked })}
            size="sm"
          />
        </Box>

        <TextInput
          data-testid="experiments-description"
          placeholder="Experiment description (optional)"
          size="sm"
          value={config().description}
          onChange={(v) => setConfig({ description: v })}
        />

        <Divider />

        <Box className="w-full">
          <Box className="flex items-center justify-start">
            <Text size="sm" fw={500}>
              Sweep space
            </Text>
          </Box>
          <Show when={strategy() && strategy()!.params.length > 0}
            fallback={
              <Box className="flex items-center justify-center p-2">
                <Text size="sm" c="dimmed">
                  Select a strategy to configure sweep parameters
                </Text>
              </Box>
            }
          >
            <Stack gap={1} className="items-stretch">
              <For each={strategy()!.params}>{(param) => {
                const sweep = () => sweeps().find((sw) => sw.key === param.key);
                return (
                  <Box
                    className="flex items-center justify-start gap-2 flex-wrap"
                    data-testid={`sweep-param-${param.key}`}
                  >
                    <Box className="w-[140px] shrink-0">
                      <Text size="xs" c="dimmed">
                        {param.label}
                      </Text>
                    </Box>
                    <Show
                      when={sweep()}
                      fallback={
                        <ParamValueInput
                          param={param}
                          value={fixedParams()[param.key] ?? param.default}
                          testId={`fixed-param-${param.key}`}
                          onChange={(v) => setFixedParam(param.key, v)}
                        />
                      }
                    >
                      {(sweepValue) => (
                      <Box className="flex items-center justify-start gap-2 flex-wrap">
                        <For each={sweepValue().values}>{(value, idx) => (
                          <Box className="flex items-center gap-2">
                            <ParamValueInput
                              param={param}
                              value={value}
                              testId={`sweep-value-${param.key}-${idx()}`}
                              onChange={(v) => updateSweepValue(param.key, idx(), v)}
                            />
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              color="secondary"
                              data-testid={`sweep-value-remove-${param.key}-${idx()}`}
                              onClick={() => removeSweepValue(param.key, idx())}
                            >
                              <IconX size={12} />
                            </ActionIcon>
                          </Box>
                        )}</For>
                        <Button
                          size="xs"
                          variant="outline"
                          data-testid={`sweep-value-add-${param.key}`}
                          leftSection={<IconPlus size={12} />}
                          onClick={() => addSweepValue(param, sweep()!)}
                        >
                          Add
                        </Button>
                      </Box>
                      )}
                    </Show>
                    <Show when={sweep()} fallback={
                      <Button
                        size="xs"
                        variant="outline"
                        data-testid={`sweep-add-${param.key}`}
                        onClick={() => addSweepParam(param.key)}
                      >
                        Add to sweep
                      </Button>
                    }>
                      <Button
                        size="xs"
                        variant="light"
                        color="info"
                        data-testid={`sweep-remove-${param.key}`}
                        onClick={() => removeSweepParam(param.key)}
                      >
                        Sweep on
                      </Button>
                    </Show>
                  </Box>
                );
                }}</For>
            </Stack>
          </Show>
        </Box>

        <Divider />

        <Box className="flex items-center justify-between gap-2 flex-wrap">
          <Box className="flex items-center gap-2">
            <Text size="sm" data-testid="experiments-candidates-count">
              candidates = {grid()} x {config().symbols.length} symbols = {candidates()}
            </Text>
            <Show when={tooLarge()}>
              <Badge
                color="error"
                size="sm"
                variant="outline"
                data-testid="experiments-candidates-warning"
              >
                {candidates()} &gt; 500 — large grid
              </Badge>
            </Show>
          </Box>
          <Box className="flex items-center gap-2">
            <Button
              variant="filled"
              size="sm"
              data-testid="experiments-start-btn"
              leftSection={<IconPlayerPlay size={12} />}
              disabled={!hasSymbols() || !hasSweepValues() || running() || tooLarge()}
              loading={running()}
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
