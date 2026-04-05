import { Stack, Group, NumberInput, Switch, Tabs } from "@mantine/core";
import type { StrategyFormData } from "./types";
import { SlTpRow } from "./SlTpRow";

interface SwingParamsPanelProps {
  initialValues: StrategyFormData;
  isSwing: boolean;
  is52wChaser: boolean;
}

export function SwingParamsPanel({ initialValues, isSwing, is52wChaser }: SwingParamsPanelProps) {
  return (
    <Tabs.Panel value="52w" className="strategy-form-tab-panel" data-testid="strategy-panel-52w">
      <Stack gap="sm" mt="sm">
        <Group grow>
          <NumberInput
            label="Entry Threshold %"
            name="entry_threshold_pct"
            defaultValue={initialValues.entry_threshold_pct}
            min={0.5}
            max={10}
            step={0.5}
            suffix="%"
            required
            data-testid="strategy-entry-threshold-input"
          />
        </Group>
        <SlTpRow
          slDefault={initialValues.sl_pct}
          tpDefault={initialValues.tp_pct}
          isSwing={isSwing}
        />
        <Group grow>
          <NumberInput
            label="Trailing Stop %"
            name="trailing_stop_pct"
            defaultValue={initialValues.trailing_stop_pct}
            min={0.1}
            max={10}
            step={0.1}
            suffix="%"
            data-testid="strategy-trailing-stop-input"
          />
        </Group>
        <Group grow>
          <NumberInput
            label="Max Holding Days"
            name="max_holding_days"
            defaultValue={initialValues.max_holding_days}
            min={1}
            max={90}
            suffix=" days"
            data-testid="strategy-max-holding-input"
          />
          <NumberInput
            label="Cooldown Days"
            name="cooldown_days"
            defaultValue={initialValues.cooldown_days}
            min={1}
            max={90}
            suffix=" days"
            data-testid="strategy-cooldown-days-input"
          />
        </Group>
        {is52wChaser && (
          <>
            <Group grow>
              <Switch
                label="Enable Trailing Stop"
                name="enable_trailing_stop"
                defaultChecked={initialValues.enable_trailing_stop}
                data-testid="strategy-enable-trailing-input"
              />
              <Switch
                label="Enable Filters (ADX/RSI/Volume/MA)"
                name="enable_filters"
                defaultChecked={initialValues.enable_filters}
                data-testid="strategy-enable-filters-input"
              />
            </Group>
            <NumberInput
              label="Trailing Activation %"
              name="trailing_activation_pct"
              defaultValue={initialValues.trailing_activation_pct}
              min={0.1}
              max={10}
              step={0.1}
              suffix="%"
              data-testid="strategy-trailing-activation-input"
            />
          </>
        )}
      </Stack>
    </Tabs.Panel>
  );
}
