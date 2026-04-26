import { Stack, Group, NumberInput, Tabs } from "@mantine/core";
import type { StrategyFormData } from "./types";

interface RunnerPanelProps {
  initialValues: StrategyFormData;
  isOrb: boolean;
}

export function RunnerPanel({ initialValues, isOrb }: RunnerPanelProps) {
  return (
    <Tabs.Panel
      value="runner"
      className="strategy-form-tab-panel"
      data-testid="strategy-panel-runner"
    >
      <Stack gap="sm" mt="sm">
        <Group grow>
          <NumberInput
            label="Min Trade Value"
            name="min_trade_value"
            defaultValue={initialValues.min_trade_value}
            min={1000}
            max={100000}
            step={1000}
            prefix="₹"
            data-testid="strategy-min-trade-value-input"
          />
          <NumberInput
            label="Max Trade Value"
            name="max_trade_value"
            defaultValue={initialValues.max_trade_value}
            min={5000}
            max={500000}
            step={5000}
            prefix="₹"
            data-testid="strategy-max-trade-value-input"
          />
        </Group>
        {isOrb && (
          <NumberInput
            label="Max Distance from OR %"
            name="max_distance_from_or_pct"
            defaultValue={initialValues.max_distance_from_or_pct}
            min={0.1}
            max={10}
            step={0.1}
            suffix="%"
            data-testid="strategy-max-distance-input"
          />
        )}
      </Stack>
    </Tabs.Panel>
  );
}
