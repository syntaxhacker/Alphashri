import { createMemo, createEffect, For, Show, onCleanup, type JSX } from "solid-js";
import { Select, NumberInput, Checkbox, Button, Text, Box } from "@/ui";
import { Menu } from "../paper-trading/localOverlays";
import { IconPlayerPlay, IconChevronDown, IconRefresh } from "@/components/common/Icons";
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

function Field(props: { label?: string; span?: boolean; children?: JSX.Element }) {
  return (
    <Box
      className="flex flex-col gap-0.25 min-w-0"
      style={{ gridColumn: props.span ? "1 / -1" : undefined, display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}
    >
      <Show when={props.label}>
        <Text size="xs" c="dimmed" fw={700} style={{ letterSpacing: 0.5, textTransform: "uppercase", fontSize: "10px", lineHeight: 1.2 }}>
          {props.label}
        </Text>
      </Show>
      {props.children}
    </Box>
  );
}

export function BacktestConfig(props: BacktestConfigProps) {
  const strategy = createMemo(() => props.strategies.find((s) => s.id === props.selectedStrategy));
  const selectedVariationData = createMemo(() => props.variations.find((v) => v.id === props.selectedVariation));

  createEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (!props.isRunning && props.selectedSymbols.length > 0) {
          props.onRun();
        }
      }
    };
    document.addEventListener("keydown", handler);
    onCleanup(() => document.removeEventListener("keydown", handler));
  });

  // Only variations whose strategy the backtest engine can actually run. The bot
  // strategies list is broader (e.g. adx_trend), and selecting an unsupported one
  // previously produced a 200 with a null payload.
  const supportedIds = createMemo(() => new Set(props.strategies.map((s) => s.id.toLowerCase())));
  const runnableVariations = createMemo(() =>
    props.variations.filter((v) => supportedIds().has((v.strategy_type || "").toLowerCase())),
  );

  // Every backtestable strategy must be selectable — including ones with no saved
  // variation (e.g. `smc`). Those get a synthetic "run with defaults" option.
  const coveredStrategyIds = createMemo(
    () => new Set(runnableVariations().map((v) => (v.strategy_type || "").toLowerCase())),
  );
  const strategyOptions = createMemo(() =>
    props.strategies
      .filter((s) => !coveredStrategyIds().has(s.id.toLowerCase()))
      .map((s) => ({ value: `strategy:${s.id}`, label: `${s.name} (strategy)` })),
  );

  const selectData = createMemo(() => [
    ...runnableVariations()
      .filter((v) => v.is_template)
      .map((v) => ({ value: v.id, label: `${v.name} (${v.strategy_type})` })),
    ...runnableVariations()
      .filter((v) => !v.is_template)
      .map((v) => ({ value: v.id, label: v.name })),
    ...strategyOptions(),
    // Keep a label (instead of a raw UUID) if a persisted selection is no longer runnable.
    ...(props.selectedVariation && !runnableVariations().some((v) => v.id === props.selectedVariation)
      ? [{
          value: props.selectedVariation,
          label: `${selectedVariationData()?.name ?? selectedVariationData()?.strategy_type ?? "Selection"} (unsupported)`,
        }]
      : []),
  ]);

  const selectValue = createMemo(() =>
    props.selectedVariation
      ?? (strategyOptions().some((o) => o.value === `strategy:${props.selectedStrategy}`)
        ? `strategy:${props.selectedStrategy}`
        : undefined),
  );

  const handleVariationChange = (value: string | null) => {
    if (value && value.startsWith("strategy:")) {
      props.onStrategyChange(value.slice("strategy:".length));
      return;
    }
    props.onVariationChange(value);
  };

  const handleRunAndSave = () => {
    props.onSaveToHistoryChange(true);
    props.onRunAndSave();
  };

  const hasParams = () => Boolean(strategy() && strategy()!.params.length > 0);

  return (
    <Box
      id="config-form"
      data-testid="strategy-config"
      className="p-1.5 grid grid-cols-2 gap-1.5 items-start"
      style={{ padding: "6px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", alignItems: "start" }}
    >
      <Field label="Strategy" span>
        <Select
          id="variation-select"
          className="config-variation-select"
          data-testid="variation-select"
          placeholder="Select strategy or template"
          value={selectValue()}
          onChange={(v) => handleVariationChange(v)}
          data={selectData()}
          size="sm"
          clearable
          searchable
          w="100%"
        />
        <Show when={selectedVariationData()?.description}>
          <Text size="xs" c="dimmed" style={{ marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {selectedVariationData()?.description}
          </Text>
        </Show>
      </Field>

      <Field label="Symbols" span>
        <SymbolChips selectedSymbols={props.selectedSymbols} onSymbolsChange={props.onSymbolsChange} />
      </Field>

      <Show
        when={hasParams()}
        fallback={
          <Text size="xs" c="dimmed" style={{ gridColumn: "1 / -1" }}>
            Select a strategy to configure parameters
          </Text>
        }
      >
        <For each={strategy()!.params}>{(param) => (
          <Field label={param.label}>
            <ParamInput
              param={param}
              value={props.params[param.key]}
              onChange={(value) => props.onParamChange(param.key, value)}
            />
          </Field>
        )}</For>
      </Show>

      <Field label="Days">
        <NumberInput
          data-testid="days-input"
          value={props.days}
          onChange={(v) => props.onDaysChange(Number(v) || 30)}
          min={30}
          max={365}
          step={30}
          size="sm"
          w="100%"
        />
      </Field>

      <Field label="Options">
        <Box className="flex items-center" style={{ display: "flex", alignItems: "center", minHeight: "32px" }}>
          <Checkbox
            data-testid="include-costs-checkbox"
            label="Include Costs"
            checked={props.includeCosts}
            onChange={(e) => props.onIncludeCostsChange(e.currentTarget.checked)}
            size="sm"
          />
        </Box>
      </Field>

      <Box className="flex justify-end gap-2" style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: "4px" }}>
        <Button
          variant="filled"
          size="sm"
          onClick={props.onRun}
          disabled={props.isRunning || props.selectedSymbols.length === 0}
          loading={props.isRunning}
          data-testid="run-backtest-btn"
          leftSection={props.isRunning ? undefined : <IconPlayerPlay size={12} />}
        >
          {props.isRunning ? null : "Run"}
        </Button>
        <Menu>
          <Menu.Target>
            <Button
              variant="filled"
              size="sm"
              disabled={props.isRunning || props.selectedSymbols.length === 0}
              p={0}
              w={28}
              data-testid="run-menu-btn"
              className="flex items-center justify-center"
            >
              <IconChevronDown size={12} />
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              onClick={props.onRun}
              disabled={props.isRunning || props.selectedSymbols.length === 0}
              leftSection={<IconPlayerPlay size={14} />}
              data-testid="menu-run-backtest"
            >
              Run Backtest
            </Menu.Item>
            <Menu.Item
              onClick={handleRunAndSave}
              disabled={props.isRunning || props.selectedSymbols.length === 0}
              leftSection={<IconPlayerPlay size={14} />}
              data-testid="menu-run-save"
            >
              Run & Save to History
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              onClick={props.onReset}
              color="secondary"
              leftSection={<IconRefresh size={14} />}
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
