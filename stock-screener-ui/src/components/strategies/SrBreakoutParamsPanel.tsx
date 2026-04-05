import { Stack, Select, NumberInput, Tabs } from "@mantine/core";
import type { StrategyFormData } from "./types";
import { SlTpRow } from "./SlTpRow";

interface SrBreakoutParamsPanelProps {
  initialValues: StrategyFormData;
  isSwing: boolean;
}

export function SrBreakoutParamsPanel({
  initialValues,
  isSwing,
}: SrBreakoutParamsPanelProps) {
  return (
    <Tabs.Panel
      value="sr"
      className="strategy-form-tab-panel"
      data-testid="strategy-panel-sr"
    >
      <Stack gap="sm" mt="sm">
        <SlTpRow
          slDefault={initialValues.sl_pct}
          tpDefault={initialValues.tp_pct}
          isSwing={isSwing}
        />
        <Select
          label="Pivot Type"
          name="pivot_type"
          data={[
            { value: "classic", label: "Classic" },
            { value: "fibonacci", label: "Fibonacci" },
            { value: "camarilla", label: "Camarilla" },
          ]}
          defaultValue={initialValues.pivot_type}
          required
          data-testid="strategy-pivot-type-input"
        />
        <NumberInput
          label="Breakout Buffer %"
          name="breakout_buffer_pct"
          defaultValue={initialValues.breakout_buffer_pct}
          min={0}
          max={1}
          step={0.05}
          suffix="%"
          data-testid="strategy-breakout-buffer-input"
        />
      </Stack>
    </Tabs.Panel>
  );
}
