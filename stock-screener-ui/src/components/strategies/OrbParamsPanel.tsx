import { Stack, Group, NumberInput, Tabs } from "@mantine/core";
import type { StrategyFormData } from "./types";
import { SlTpRow } from "./SlTpRow";

interface OrbParamsPanelProps {
  initialValues: StrategyFormData;
  isSwing: boolean;
}

export function OrbParamsPanel({ initialValues, isSwing }: OrbParamsPanelProps) {
  return (
    <Tabs.Panel
      value="orb"
      className="strategy-form-tab-panel"
      data-testid="strategy-panel-orb"
    >
      <Stack gap="sm" mt="sm">
        <Group grow>
          <NumberInput
            label="OR Minutes"
            name="or_minutes"
            defaultValue={initialValues.or_minutes}
            min={1}
            max={60}
            suffix=" min"
            required
            data-testid="strategy-or-minutes-input"
          />
          <NumberInput
            label="Min OR Range %"
            name="min_or_range_pct"
            defaultValue={initialValues.min_or_range_pct}
            min={0.1}
            max={5}
            step={0.1}
            suffix="%"
            data-testid="strategy-min-or-range-input"
          />
        </Group>
        <SlTpRow
          slDefault={initialValues.sl_pct}
          tpDefault={initialValues.tp_pct}
          isSwing={isSwing}
        />
        <NumberInput
          label="Max OR Range %"
          name="max_or_range_pct"
          defaultValue={initialValues.max_or_range_pct}
          min={0.1}
          max={10}
          step={0.1}
          suffix="%"
          data-testid="strategy-max-or-range-input"
        />
      </Stack>
    </Tabs.Panel>
  );
}
