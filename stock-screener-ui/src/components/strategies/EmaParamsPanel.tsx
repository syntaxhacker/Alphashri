import { Stack, Group, NumberInput, Tabs } from "@/ui";
import type { StrategyFormData } from "./types";
import { SlTpRow } from "./SlTpRow";

interface EmaParamsPanelProps {
  initialValues: StrategyFormData;
  isSwing: boolean;
}

export function EmaParamsPanel({ initialValues, isSwing }: EmaParamsPanelProps) {
  return (
    <Tabs.Panel value="ema" className="strategy-form-tab-panel" data-testid="strategy-panel-ema">
      <Stack gap="sm" mt="sm">
        <Group grow>
          <NumberInput
            label="Fast EMA Period"
            name="ema_fast_period"
            defaultValue={initialValues.ema_fast_period}
            min={3}
            max={50}
            required
            data-testid="strategy-ema-fast-period-input"
          />
          <NumberInput
            label="Slow EMA Period"
            name="ema_slow_period"
            defaultValue={initialValues.ema_slow_period}
            min={10}
            max={200}
            required
            data-testid="strategy-ema-slow-period-input"
          />
        </Group>
        <SlTpRow
          slDefault={initialValues.sl_pct}
          tpDefault={initialValues.tp_pct}
          isSwing={isSwing}
        />
      </Stack>
    </Tabs.Panel>
  );
}
